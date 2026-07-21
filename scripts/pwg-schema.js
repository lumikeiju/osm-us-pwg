/** @format */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SCHEMA_PATH = path.resolve(
  __dirname,
  "..",
  "schema",
  "1.0.1.json"
);

function loadSchema(schemaPath = DEFAULT_SCHEMA_PATH) {
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function getTierOrder(schema) {
  return (
    schema.$usage?.tierOrder ??
    Object.keys(schema.tiers).sort(
      (left, right) => schema.tiers[left].order - schema.tiers[right].order
    )
  );
}

function getTierIndex(schema, tier) {
  const index = getTierOrder(schema).indexOf(tier);
  if (index === -1) {
    throw new Error(`Unknown tier: ${tier}`);
  }
  return index;
}

function tierIsAtLeast(schema, tier, minimumTier) {
  return getTierIndex(schema, tier) >= getTierIndex(schema, minimumTier);
}

function hasTag(tags, key) {
  return Object.prototype.hasOwnProperty.call(tags, key);
}

function tagValue(tags, key) {
  return hasTag(tags, key) ? String(tags[key]) : undefined;
}

function clauseMatches(clause, tags) {
  if (clause.allOf) {
    return clause.allOf.every((part) => clauseMatches(part, tags));
  }

  if (clause.noneOf) {
    return clause.noneOf.every((part) => !clauseMatches(part, tags));
  }

  if (clause.oneOf && !clause.key) {
    return clause.oneOf.some((part) => clauseMatches(part, tags));
  }

  if (!clause.key) {
    return true;
  }

  if (!hasTag(tags, clause.key)) {
    return false;
  }

  const value = tagValue(tags, clause.key);
  if (clause.value !== undefined && value !== String(clause.value)) {
    return false;
  }

  if (clause.oneOf && !clause.oneOf.map(String).includes(value)) {
    return false;
  }

  return true;
}

function predicateMatches(predicate, tags) {
  if (!predicate) {
    return true;
  }

  if (
    predicate.allOf &&
    !predicate.allOf.every((clause) => clauseMatches(clause, tags))
  ) {
    return false;
  }

  if (
    predicate.oneOf &&
    !predicate.oneOf.some((clause) => clauseMatches(clause, tags))
  ) {
    return false;
  }

  if (
    predicate.noneOf &&
    predicate.noneOf.some((clause) => clauseMatches(clause, tags))
  ) {
    return false;
  }

  return true;
}

function getFeatureElements(feature) {
  if (Array.isArray(feature.elements)) {
    return feature.elements;
  }

  return feature.element ? [feature.element] : [];
}

function featureMatchesElement(feature, element) {
  return !element || getFeatureElements(feature).includes(element);
}

function identifyFeatures(schema, element, tags) {
  return Object.entries(schema.features)
    .filter(([, feature]) => featureMatchesElement(feature, element))
    .filter(([, feature]) => predicateMatches(feature.identifier, tags))
    .map(([featureId, feature]) => ({ featureId, feature }));
}

function getActiveValueSpec(schema, entry, tier) {
  if (entry.valueSpecByTier) {
    const tierOrder = getTierOrder(schema);
    const targetIndex = getTierIndex(schema, tier);
    for (let index = targetIndex; index >= 0; index -= 1) {
      const candidateTier = tierOrder[index];
      if (entry.valueSpecByTier[candidateTier]) {
        return entry.valueSpecByTier[candidateTier];
      }
    }
  }

  return entry.valueSpec;
}

function expandEntryKeys(entry) {
  if (!entry.keyTemplate) {
    return [entry.key];
  }

  const variableNames = Object.keys(entry.keyTemplate.variables ?? {});
  const expanded = [];

  function visit(index, valuesByName) {
    if (index === variableNames.length) {
      let key = entry.keyTemplate.pattern;
      for (const [name, value] of Object.entries(valuesByName)) {
        key = key.replaceAll(`{${name}}`, value);
      }
      expanded.push(key);
      return;
    }

    const variableName = variableNames[index];
    const values = entry.keyTemplate.variables[variableName].values ?? [];
    for (const value of values) {
      visit(index + 1, { ...valuesByName, [variableName]: value });
    }
  }

  visit(0, {});
  return expanded;
}

function summarizeKeySet(keySet) {
  if (!keySet) {
    return undefined;
  }

  return keySet.sets.map((set) => set.join(" + ")).join(" OR ");
}

function valueMatchesSpec(value, spec) {
  if (value === undefined) {
    return false;
  }

  const stringValue = String(value).trim();
  if (spec?.notValues?.map(String).includes(stringValue)) {
    return false;
  }

  if (!spec) {
    return stringValue.length > 0;
  }

  switch (spec.type) {
    case "enum":
      return (spec.values ?? []).map(String).includes(stringValue);
    case "openEnum":
    case "free":
      return stringValue.length > 0;
    case "boolean":
      return ["yes", "no"].includes(stringValue);
    case "numeric":
      return stringValue !== "" && Number.isFinite(Number(stringValue));
    case "length":
      return /^-?\d+(?:\.\d+)?(?:\s*(?:mm|cm|m|km|in|ft|yd|mi))?$/i.test(
        stringValue
      );
    case "percent":
      return /^-?\d+(?:\.\d+)?%$/.test(stringValue);
    case "incline":
      return /^(?:up|down|[+-]?\d+(?:\.\d+)?(?:%|°))$/.test(stringValue);
    default:
      return stringValue.length > 0;
  }
}

function valueSpecLabel(spec) {
  if (!spec) {
    return "present";
  }

  if (spec.type === "enum") {
    return `one of ${spec.values.join("|")}`;
  }

  if (spec.type === "openEnum") {
    const examples = spec.values?.length
      ? `examples: ${spec.values.join("|")}`
      : "open value";
    const excluded = spec.notValues?.length
      ? `; not ${spec.notValues.join("|")}`
      : "";
    return `${examples}${excluded}`;
  }

  if (spec.type === "incline") {
    return "up/down or number%/number°";
  }

  return spec.type;
}

function evaluateEntry(schema, entry, tier, tags) {
  const spec = getActiveValueSpec(schema, entry, tier);

  if (entry.requirement === "conditional") {
    if (entry.appliesWhen && !predicateMatches(entry.appliesWhen, tags)) {
      return {
        status: "skipped",
        key: entry.key,
        reason: "precondition not met",
      };
    }

    if (entry.condition) {
      return {
        status: "manualReview",
        key: entry.key,
        keys: expandEntryKeys(entry),
        condition: entry.condition,
        valueSpec: spec,
      };
    }
  }

  if (entry.keySet?.mode === "oneOf") {
    const passingSet = entry.keySet.sets.find((keySet) =>
      keySet.every((key) => valueMatchesSpec(tagValue(tags, key), spec))
    );
    if (passingSet) {
      return {
        status: "pass",
        key: entry.key,
        keys: passingSet,
        valueSpec: spec,
      };
    }

    return {
      status: "fail",
      key: entry.key,
      keys: expandEntryKeys(entry),
      keySet: entry.keySet,
      issue: "missing-or-invalid-key-set",
      expected: summarizeKeySet(entry.keySet),
      valueSpec: spec,
    };
  }

  const issues = [];
  for (const key of expandEntryKeys(entry)) {
    if (!hasTag(tags, key)) {
      issues.push({ key, issue: "missing", expected: valueSpecLabel(spec) });
      continue;
    }

    if (!valueMatchesSpec(tagValue(tags, key), spec)) {
      issues.push({
        key,
        issue: "value-mismatch",
        actual: tagValue(tags, key),
        expected: valueSpecLabel(spec),
      });
    }
  }

  if (issues.length > 0) {
    return {
      status: "fail",
      key: entry.key,
      keys: expandEntryKeys(entry),
      issues,
      valueSpec: spec,
    };
  }

  return {
    status: "pass",
    key: entry.key,
    keys: expandEntryKeys(entry),
    valueSpec: spec,
  };
}

function entriesForTier(schema, feature, tier) {
  return feature.tags.filter((entry) =>
    tierIsAtLeast(schema, tier, entry.minTier)
  );
}

function identifierIssues(identifier, tags) {
  const issues = [];

  for (const clause of identifier.allOf ?? []) {
    if (!clause.key || clauseMatches(clause, tags)) {
      continue;
    }

    if (!hasTag(tags, clause.key)) {
      issues.push({
        key: clause.key,
        issue: "missing-identifier-tag",
        expected:
          clause.value !== undefined
            ? String(clause.value)
            : (clause.oneOf?.map(String).join("|") ?? "present"),
      });
      continue;
    }

    issues.push({
      key: clause.key,
      issue: "identifier-value-mismatch",
      actual: tagValue(tags, clause.key),
      expected:
        clause.value !== undefined
          ? String(clause.value)
          : (clause.oneOf?.map(String).join("|") ?? "matching identifier"),
    });
  }

  for (const clause of identifier.noneOf ?? []) {
    if (!clause.key || !clauseMatches(clause, tags)) {
      continue;
    }

    issues.push({
      key: clause.key,
      issue: "forbidden-identifier-tag",
      actual: tagValue(tags, clause.key),
      expected: "not present",
    });
  }

  if (issues.length === 0 && !predicateMatches(identifier, tags)) {
    issues.push({
      issue: "identifier-mismatch",
      expected: "matching feature identifier",
    });
  }

  return issues;
}

function evaluateFeatureAtTier(schema, featureId, feature, tier, tags) {
  if (!tierIsAtLeast(schema, tier, feature.identifier.minTier)) {
    return {
      featureId,
      tier,
      passes: false,
      blockers: [
        {
          issue: "feature-not-defined-at-tier",
          minTier: feature.identifier.minTier,
        },
      ],
      manualReviews: [],
    };
  }

  const blockers = [];
  const manualReviews = [];
  const passes = [];
  const skipped = [];

  const featureIdentifierIssues = identifierIssues(feature.identifier, tags);
  if (featureIdentifierIssues.length > 0) {
    blockers.push({
      status: "fail",
      key: "identifier",
      issue: "identifier-mismatch",
      issues: featureIdentifierIssues,
    });
  }

  for (const entry of entriesForTier(schema, feature, tier)) {
    const result = evaluateEntry(schema, entry, tier, tags);
    if (result.status === "fail") {
      blockers.push(result);
    } else if (result.status === "manualReview") {
      manualReviews.push(result);
    } else if (result.status === "skipped") {
      skipped.push(result);
    } else {
      passes.push(result);
    }
  }

  return {
    featureId,
    tier,
    passes: blockers.length === 0,
    blockers,
    manualReviews,
    passedEntries: passes,
    skippedEntries: skipped,
  };
}

function tierOfFeature(schema, featureId, feature, tags) {
  const tierOrder = getTierOrder(schema);
  const evaluations = {};
  let highestTier = null;

  for (const tier of tierOrder.slice(
    getTierIndex(schema, feature.identifier.minTier)
  )) {
    const evaluation = evaluateFeatureAtTier(
      schema,
      featureId,
      feature,
      tier,
      tags
    );
    evaluations[tier] = evaluation;
    if (evaluation.passes) {
      highestTier = tier;
    }
  }

  return {
    featureId,
    featureName: feature.name,
    tier: highestTier,
    minTier: feature.identifier.minTier,
    evaluations,
  };
}

function tierOf(schema, element, tags) {
  return identifyFeatures(schema, element, tags).map(({ featureId, feature }) =>
    tierOfFeature(schema, featureId, feature, tags)
  );
}

function tagsForTier(schema, featureId, tier) {
  const feature = schema.features[featureId];
  if (!feature) {
    throw new Error(`Unknown feature: ${featureId}`);
  }

  getTierIndex(schema, tier);
  if (!tierIsAtLeast(schema, tier, feature.identifier.minTier)) {
    throw new Error(
      `Feature ${featureId} is not defined at tier ${tier}; it starts at ${feature.identifier.minTier}`
    );
  }

  const identifier = feature.identifier.allOf ?? [];
  const entries = entriesForTier(schema, feature, tier).map((entry) => ({
    key: entry.key,
    keys: expandEntryKeys(entry),
    keySet: entry.keySet,
    minTier: entry.minTier,
    requirement: entry.requirement,
    appliesWhen: entry.appliesWhen,
    condition: entry.condition,
    valueSpec: getActiveValueSpec(schema, entry, tier),
  }));

  return {
    featureId,
    featureName: feature.name,
    tier,
    elements: getFeatureElements(feature),
    featureMinTier: feature.identifier.minTier,
    identifier,
    entries,
  };
}

function gapToTier(schema, featureId, tier, tags) {
  const feature = schema.features[featureId];
  if (!feature) {
    throw new Error(`Unknown feature: ${featureId}`);
  }

  return evaluateFeatureAtTier(schema, featureId, feature, tier, tags);
}

function parseTagString(tagString) {
  if (!tagString) {
    return {};
  }

  const trimmed = tagString.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  return Object.fromEntries(
    trimmed
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const equalsIndex = pair.indexOf("=");
        if (equalsIndex === -1) {
          return [pair, ""];
        }
        return [pair.slice(0, equalsIndex), pair.slice(equalsIndex + 1)];
      })
  );
}

module.exports = {
  DEFAULT_SCHEMA_PATH,
  loadSchema,
  getTierOrder,
  getTierIndex,
  tierIsAtLeast,
  hasTag,
  tagValue,
  clauseMatches,
  predicateMatches,
  getFeatureElements,
  identifyFeatures,
  getActiveValueSpec,
  expandEntryKeys,
  valueMatchesSpec,
  valueSpecLabel,
  evaluateEntry,
  entriesForTier,
  identifierIssues,
  evaluateFeatureAtTier,
  tierOfFeature,
  tierOf,
  tagsForTier,
  gapToTier,
  parseTagString,
};
