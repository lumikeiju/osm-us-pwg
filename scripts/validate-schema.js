#!/usr/bin/env node
/** @format */

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SCHEMA_PATH,
  expandEntryKeys,
  gapToTier,
  getActiveValueSpec,
  isSchemaVersion,
  loadSchema,
  parseTagString,
  tagsForTier,
  tierOf,
} = require("./pwg-schema");
const { parseOptions } = require("./parse-options");

const DEFAULT_EXAMPLES_PATH = path.resolve(
  __dirname,
  "..",
  "examples",
  "schema-queries.json"
);

const VALUE_SPEC_TYPES = new Set([
  "enum",
  "openEnum",
  "free",
  "numeric",
  "length",
  "percent",
  "incline",
  "boolean",
]);
const REQUIREMENTS = new Set(["required", "conditional"]);
const OSM_ELEMENTS = new Set(["node", "way", "relation"]);
const PREDICATE_GROUPS = new Set(["allOf", "oneOf", "noneOf"]);
const CLAUSE_FIELDS = new Set(["allOf", "noneOf", "oneOf", "key", "value"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCondition(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function validateValueSpec(spec, context, errors) {
  if (!isRecord(spec)) {
    errors.push(`${context}: missing valueSpec`);
    return;
  }

  assertCondition(
    VALUE_SPEC_TYPES.has(spec.type),
    `${context}: unknown valueSpec type ${spec.type}`,
    errors
  );
  if (["enum", "openEnum"].includes(spec.type)) {
    assertCondition(
      Array.isArray(spec.values) &&
        spec.values.length > 0 &&
        spec.values.every((value) => typeof value === "string"),
      `${context}: ${spec.type} requires a non-empty string values[]`,
      errors
    );
  }
  if (spec.notValues !== undefined) {
    assertCondition(
      Array.isArray(spec.notValues) &&
        spec.notValues.every((value) => typeof value === "string"),
      `${context}: notValues must be an array of strings`,
      errors
    );
  }
}

function validateClause(clause, context, errors) {
  if (!isRecord(clause)) {
    errors.push(`${context}: predicate clauses must be objects`);
    return;
  }

  for (const key of Object.keys(clause)) {
    assertCondition(
      CLAUSE_FIELDS.has(key),
      `${context}: unknown predicate clause field ${key}`,
      errors
    );
  }

  const isKeylessOneOf =
    Object.hasOwn(clause, "oneOf") && !Object.hasOwn(clause, "key");
  const groups = [
    "allOf",
    "noneOf",
    ...(isKeylessOneOf ? ["oneOf"] : []),
  ].filter((key) => Object.hasOwn(clause, key));
  if (groups.length > 0) {
    assertCondition(
      groups.length === 1,
      `${context}: predicate clause must use exactly one group`,
      errors
    );
    assertCondition(
      Object.keys(clause).length === 1,
      `${context}: grouped predicate clauses cannot also define a key or value`,
      errors
    );
    const group = groups[0];
    if (!Array.isArray(clause[group]) || clause[group].length === 0) {
      errors.push(`${context}.${group} must be a non-empty array`);
      return;
    }
    for (const [index, child] of clause[group].entries()) {
      validateClause(child, `${context}.${group}[${index}]`, errors);
    }
    return;
  }

  assertCondition(
    typeof clause.key === "string" && clause.key.trim().length > 0,
    `${context}: predicate clauses must name a non-empty key`,
    errors
  );
  if (Object.hasOwn(clause, "value")) {
    assertCondition(
      ["string", "number", "boolean"].includes(typeof clause.value),
      `${context}.value must be a string, number, or boolean`,
      errors
    );
  }
  if (Object.hasOwn(clause, "oneOf")) {
    assertCondition(
      Array.isArray(clause.oneOf) &&
        clause.oneOf.length > 0 &&
        clause.oneOf.every((value) =>
          ["string", "number", "boolean"].includes(typeof value)
        ),
      `${context}.oneOf must be a non-empty array of scalar values`,
      errors
    );
  }
}

function validatePredicate(predicate, context, errors, allowMinTier = false) {
  if (!isRecord(predicate)) {
    errors.push(`${context} must be an object`);
    return;
  }

  const allowedFields = allowMinTier
    ? new Set([...PREDICATE_GROUPS, "minTier"])
    : PREDICATE_GROUPS;
  for (const key of Object.keys(predicate)) {
    assertCondition(
      allowedFields.has(key),
      `${context}: unknown predicate field ${key}`,
      errors
    );
  }

  const groups = [...PREDICATE_GROUPS].filter((key) =>
    Object.hasOwn(predicate, key)
  );
  if (groups.length === 0) {
    errors.push(`${context} must define at least one predicate group`);
    return;
  }
  for (const group of groups) {
    if (!Array.isArray(predicate[group]) || predicate[group].length === 0) {
      errors.push(`${context}.${group} must be a non-empty array`);
      continue;
    }
    for (const [index, clause] of predicate[group].entries()) {
      validateClause(clause, `${context}.${group}[${index}]`, errors);
    }
  }
}

function validKeyTemplate(template) {
  return (
    isRecord(template) &&
    typeof template.pattern === "string" &&
    template.pattern.length > 0 &&
    isRecord(template.variables) &&
    Object.keys(template.variables).length > 0 &&
    Object.entries(template.variables).every(
      ([name, variable]) =>
        name.length > 0 &&
        template.pattern.includes(`{${name}}`) &&
        isRecord(variable) &&
        Array.isArray(variable.values) &&
        variable.values.length > 0 &&
        variable.values.every(
          (value) => typeof value === "string" && value.length > 0
        )
    )
  );
}

function validateKeySet(keySet, expandedKeys, context, errors) {
  if (!isRecord(keySet)) {
    errors.push(`${context} must be an object`);
    return;
  }
  assertCondition(
    keySet.mode === "oneOf",
    `${context}.mode must be oneOf`,
    errors
  );
  if (keySet.description !== undefined) {
    assertCondition(
      typeof keySet.description === "string",
      `${context}.description must be a string`,
      errors
    );
  }
  if (!Array.isArray(keySet.sets) || keySet.sets.length === 0) {
    errors.push(`${context}.sets must be a non-empty array`);
    return;
  }
  for (const [setIndex, set] of keySet.sets.entries()) {
    if (!Array.isArray(set) || set.length === 0) {
      errors.push(`${context}.sets[${setIndex}] must be a non-empty array`);
      continue;
    }
    if (new Set(set).size !== set.length) {
      errors.push(`${context}.sets[${setIndex}] contains duplicate keys`);
    }
    for (const [keyIndex, key] of set.entries()) {
      if (typeof key !== "string" || key.length === 0) {
        errors.push(`${context}.sets[${setIndex}][${keyIndex}] must be a key`);
      } else if (!expandedKeys.includes(key)) {
        errors.push(`${context}: keySet references non-expanded key ${key}`);
      }
    }
  }
}

function validateSchemaShape(schema) {
  const errors = [];
  if (!isRecord(schema)) {
    return ["schema must be an object"];
  }
  assertCondition(
    isSchemaVersion(schema.version),
    "schema.version must be a valid semantic version",
    errors
  );
  assertCondition(
    typeof schema.sourceDocument === "string" &&
      schema.sourceDocument.length > 0,
    "schema.sourceDocument must be a non-empty path",
    errors
  );
  if (!isRecord(schema.$usage)) {
    return [...errors, "schema.$usage must be an object"];
  }
  if (
    !Array.isArray(schema.$usage.tierOrder) ||
    schema.$usage.tierOrder.length === 0
  ) {
    return [...errors, "schema.$usage.tierOrder must be a non-empty array"];
  }
  if (!isRecord(schema.tiers)) {
    return [...errors, "schema.tiers must be an object"];
  }
  if (!isRecord(schema.features)) {
    return [...errors, "schema.features must be an object"];
  }

  const tierOrder = schema.$usage.tierOrder;
  const tierSet = new Set(tierOrder);
  assertCondition(
    tierOrder.every((tier) => typeof tier === "string" && tier.length > 0),
    "schema.$usage.tierOrder entries must be non-empty strings",
    errors
  );
  assertCondition(
    tierSet.size === tierOrder.length,
    "schema.$usage.tierOrder contains duplicate tiers",
    errors
  );

  let previousOrder = -Infinity;
  for (const tier of tierOrder) {
    const tierInfo = schema.tiers[tier];
    if (!isRecord(tierInfo)) {
      errors.push(`tierOrder references missing or invalid tier ${tier}`);
      continue;
    }
    assertCondition(
      typeof tierInfo.name === "string" && tierInfo.name.length > 0,
      `tiers.${tier}.name must be a non-empty string`,
      errors
    );
    for (const field of ["shortDescription", "useCases", "requiredResources"]) {
      assertCondition(
        typeof tierInfo[field] === "string" &&
          tierInfo[field].trim().length > 0,
        `tiers.${tier}.${field} must be a non-empty string`,
        errors
      );
    }
    assertCondition(
      Number.isFinite(tierInfo.order) && tierInfo.order > previousOrder,
      `tiers.${tier}.order must be a number increasing with tierOrder`,
      errors
    );
    if (Number.isFinite(tierInfo.order)) {
      previousOrder = tierInfo.order;
    }
  }
  for (const tier of Object.keys(schema.tiers)) {
    assertCondition(
      tierSet.has(tier),
      `tiers.${tier} is missing from tierOrder`,
      errors
    );
  }

  for (const [featureId, feature] of Object.entries(schema.features)) {
    const context = `features.${featureId}`;
    assertCondition(
      featureId.length > 0,
      "feature identifiers must be non-empty",
      errors
    );
    if (!isRecord(feature)) {
      errors.push(`${context} must be an object`);
      continue;
    }
    assertCondition(
      typeof feature.name === "string" && feature.name.trim().length > 0,
      `${context}.name must be a non-empty string`,
      errors
    );
    if (!Array.isArray(feature.elements) || feature.elements.length === 0) {
      errors.push(`${context}.elements must be a non-empty array`);
    } else {
      assertCondition(
        feature.elements.every((element) => OSM_ELEMENTS.has(element)),
        `${context}.elements must contain only node, way, or relation`,
        errors
      );
      assertCondition(
        new Set(feature.elements).size === feature.elements.length,
        `${context}.elements contains duplicates`,
        errors
      );
    }
    if (!isRecord(feature.identifier)) {
      errors.push(`${context}.identifier must be an object`);
      continue;
    }
    assertCondition(
      typeof feature.identifier.minTier === "string" &&
        tierSet.has(feature.identifier.minTier),
      `${context}: unknown identifier.minTier ${feature.identifier.minTier}`,
      errors
    );
    validatePredicate(
      feature.identifier,
      `${context}.identifier`,
      errors,
      true
    );
    if (!Array.isArray(feature.tags)) {
      errors.push(`${context}.tags must be an array`);
      continue;
    }

    for (const [entryIndex, entry] of feature.tags.entries()) {
      const entryContext = `${context}.tags[${entryIndex}]`;
      if (!isRecord(entry)) {
        errors.push(`${entryContext} must be an object`);
        continue;
      }
      assertCondition(
        typeof entry.key === "string" && entry.key.length > 0,
        `${entryContext}.key must be a non-empty string`,
        errors
      );
      assertCondition(
        typeof entry.minTier === "string" && tierSet.has(entry.minTier),
        `${entryContext}: unknown minTier ${entry.minTier}`,
        errors
      );
      assertCondition(
        REQUIREMENTS.has(entry.requirement),
        `${entryContext}: unknown requirement ${entry.requirement}`,
        errors
      );
      if (entry.requirement === "conditional") {
        assertCondition(
          Boolean(entry.appliesWhen || entry.condition),
          `${entryContext}: conditional entries need appliesWhen or condition`,
          errors
        );
      }
      if (entry.appliesWhen !== undefined) {
        assertCondition(
          entry.requirement === "conditional",
          `${entryContext}.appliesWhen is only valid for conditional entries`,
          errors
        );
        validatePredicate(
          entry.appliesWhen,
          `${entryContext}.appliesWhen`,
          errors
        );
      }
      if (entry.condition !== undefined) {
        assertCondition(
          entry.requirement === "conditional",
          `${entryContext}.condition is only valid for conditional entries`,
          errors
        );
        assertCondition(
          typeof entry.condition === "string" &&
            entry.condition.trim().length > 0,
          `${entryContext}.condition must be a non-empty string`,
          errors
        );
      }

      let expandedKeys = [entry.key];
      if (entry.keyTemplate !== undefined) {
        assertCondition(
          validKeyTemplate(entry.keyTemplate),
          `${entryContext}.keyTemplate must define a pattern and non-empty string values`,
          errors
        );
        if (!validKeyTemplate(entry.keyTemplate)) {
          continue;
        }
        expandedKeys = expandEntryKeys(entry);
        assertCondition(
          expandedKeys.length > 0,
          `${entryContext}: keyTemplate expands to no keys`,
          errors
        );
        assertCondition(
          new Set(expandedKeys).size === expandedKeys.length,
          `${entryContext}: keyTemplate expands duplicate keys`,
          errors
        );
        assertCondition(
          expandedKeys.every((key) => !/[{}]/.test(key)),
          `${entryContext}: keyTemplate contains unresolved placeholders`,
          errors
        );
      }
      if (entry.keySet !== undefined) {
        validateKeySet(
          entry.keySet,
          expandedKeys,
          `${entryContext}.keySet`,
          errors
        );
      }

      if (entry.valueSpec !== undefined) {
        validateValueSpec(entry.valueSpec, `${entryContext}.valueSpec`, errors);
      }

      if (entry.valueSpecByTier !== undefined) {
        if (!isRecord(entry.valueSpecByTier)) {
          errors.push(`${entryContext}.valueSpecByTier must be an object`);
          continue;
        }
        assertCondition(
          Object.keys(entry.valueSpecByTier).length > 0,
          `${entryContext}.valueSpecByTier must not be empty`,
          errors
        );
        for (const [tier, spec] of Object.entries(entry.valueSpecByTier)) {
          assertCondition(
            tierSet.has(tier),
            `${entryContext}: valueSpecByTier references unknown tier ${tier}`,
            errors
          );
          validateValueSpec(
            spec,
            `${entryContext}.valueSpecByTier.${tier}`,
            errors
          );
        }
      }

      if (!tierSet.has(entry.minTier)) {
        continue;
      }
      for (const tier of tierOrder.slice(tierOrder.indexOf(entry.minTier))) {
        const activeSpec = getActiveValueSpec(schema, entry, tier);
        validateValueSpec(
          activeSpec,
          `${entryContext}.activeAt.${tier}`,
          errors
        );
      }
    }
  }

  return errors;
}

function collectBlockerKeys(gapResult) {
  const keys = [];
  for (const blocker of gapResult.blockers ?? []) {
    if (blocker.issues) {
      keys.push(...blocker.issues.map((issue) => issue.key));
    } else if (blocker.keys) {
      keys.push(...blocker.keys);
    } else if (blocker.key) {
      keys.push(blocker.key);
    }
  }
  return keys;
}

function validateExamples(schema, examplesPath) {
  const errors = [];
  const examples = JSON.parse(fs.readFileSync(examplesPath, "utf8"));

  for (const example of examples.examples) {
    if (example.query === "tierOf") {
      const result = tierOf(schema, example.element, example.tags);
      const match = result.find(
        (candidate) => candidate.featureId === example.expected.featureId
      );
      assertCondition(
        Boolean(match),
        `${example.name}: expected feature ${example.expected.featureId}`,
        errors
      );
      if (match) {
        assertCondition(
          match.tier === example.expected.tier,
          `${example.name}: expected tier ${example.expected.tier}, got ${match.tier}`,
          errors
        );
        const manualKeys = new Set(
          Object.values(match.evaluations).flatMap((evaluation) =>
            evaluation.manualReviews.map((review) => review.key)
          )
        );
        for (const key of example.expected.manualReviewKeys ?? []) {
          assertCondition(
            manualKeys.has(key),
            `${example.name}: expected manual review key ${key}`,
            errors
          );
        }
      }
    } else if (example.query === "tagsForTier") {
      let result;
      try {
        result = tagsForTier(schema, example.featureId, example.tier);
      } catch (error) {
        if (
          example.expected.errorIncludes &&
          error.message.includes(example.expected.errorIncludes)
        ) {
          continue;
        }
        errors.push(`${example.name}: ${error.message}`);
        continue;
      }
      if (example.expected.errorIncludes) {
        errors.push(
          `${example.name}: expected error containing ${example.expected.errorIncludes}`
        );
        continue;
      }
      const keys = new Set(result.entries.flatMap((entry) => entry.keys));
      for (const key of example.expected.includesKeys ?? []) {
        assertCondition(
          keys.has(key),
          `${example.name}: expected tagsForTier key ${key}`,
          errors
        );
      }
    } else if (example.query === "gapToTier") {
      const result = gapToTier(
        schema,
        example.featureId,
        example.tier,
        example.tags ?? parseTagString(example.tagsString)
      );
      if (example.expected.passes !== undefined) {
        assertCondition(
          result.passes === example.expected.passes,
          `${example.name}: expected passes=${example.expected.passes}, got ${result.passes}`,
          errors
        );
      }

      const blockerKeys = new Set(collectBlockerKeys(result));
      for (const key of example.expected.missingOrInvalidKeys ?? []) {
        assertCondition(
          blockerKeys.has(key),
          `${example.name}: expected missing/invalid key ${key}`,
          errors
        );
      }

      if (example.expected.satisfiedKeySet) {
        const satisfied = result.passedEntries.some(
          (entry) =>
            JSON.stringify(entry.keys) ===
            JSON.stringify(example.expected.satisfiedKeySet)
        );
        assertCondition(
          satisfied,
          `${example.name}: expected satisfied key set ${example.expected.satisfiedKeySet.join(" + ")}`,
          errors
        );
      }
    } else {
      errors.push(`${example.name}: unknown query ${example.query}`);
    }
  }

  return errors;
}

function main() {
  const args = parseOptions(process.argv.slice(2), {
    valueOptions: ["schema", "examples"],
  });
  const schemaPath = path.resolve(args.schema || DEFAULT_SCHEMA_PATH);
  const examplesPath = path.resolve(args.examples || DEFAULT_EXAMPLES_PATH);
  const schema = loadSchema(schemaPath);
  const errors = validateSchemaShape(schema);
  if (errors.length === 0) {
    errors.push(...validateExamples(schema, examplesPath));
  }

  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log("schema validation ok");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { validateSchemaShape };
