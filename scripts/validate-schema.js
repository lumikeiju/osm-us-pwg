#!/usr/bin/env node
/** @format */

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SCHEMA_PATH,
  expandEntryKeys,
  gapToTier,
  getActiveValueSpec,
  getFeatureElements,
  getTierIndex,
  loadSchema,
  parseTagString,
  tagsForTier,
  tierOf,
} = require("./pwg-schema");

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

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    args[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

function assertCondition(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function validateValueSpec(spec, context, errors) {
  if (!spec) {
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
      Array.isArray(spec.values),
      `${context}: ${spec.type} requires values[]`,
      errors
    );
  }
  if (spec.notValues) {
    assertCondition(
      Array.isArray(spec.notValues),
      `${context}: notValues must be an array`,
      errors
    );
  }
}

function validateSchemaShape(schema) {
  const errors = [];
  const tierSet = new Set(schema.$usage.tierOrder);

  for (const tier of schema.$usage.tierOrder) {
    assertCondition(
      Boolean(schema.tiers[tier]),
      `tierOrder references missing tier ${tier}`,
      errors
    );
  }

  for (const [featureId, feature] of Object.entries(schema.features)) {
    const context = `features.${featureId}`;
    assertCondition(
      getFeatureElements(feature).length > 0,
      `${context}: elements[] is required`,
      errors
    );
    assertCondition(
      tierSet.has(feature.identifier.minTier),
      `${context}: unknown identifier.minTier ${feature.identifier.minTier}`,
      errors
    );

    for (const [entryIndex, entry] of feature.tags.entries()) {
      const entryContext = `${context}.tags[${entryIndex}] (${entry.key})`;
      assertCondition(
        tierSet.has(entry.minTier),
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

      if (entry.keyTemplate) {
        const expandedKeys = expandEntryKeys(entry);
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
        if (entry.keySet) {
          const expandedKeySet = new Set(expandedKeys);
          for (const keySet of entry.keySet.sets ?? []) {
            for (const key of keySet) {
              assertCondition(
                expandedKeySet.has(key),
                `${entryContext}: keySet references non-expanded key ${key}`,
                errors
              );
            }
          }
        }
      }

      if (entry.valueSpec) {
        validateValueSpec(entry.valueSpec, `${entryContext}.valueSpec`, errors);
      }

      if (entry.valueSpecByTier) {
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

      for (const tier of schema.$usage.tierOrder.slice(
        getTierIndex(schema, entry.minTier)
      )) {
        validateValueSpec(
          getActiveValueSpec(schema, entry, tier),
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
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = path.resolve(args.schema || DEFAULT_SCHEMA_PATH);
  const examplesPath = path.resolve(args.examples || DEFAULT_EXAMPLES_PATH);
  const schema = loadSchema(schemaPath);
  const errors = [
    ...validateSchemaShape(schema),
    ...validateExamples(schema, examplesPath),
  ];

  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log("schema validation ok");
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
