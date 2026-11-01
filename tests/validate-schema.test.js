/** @format */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { DEFAULT_SCHEMA_PATH, loadSchema } = require("../scripts/pwg-schema");
const { validateSchemaShape } = require("../scripts/validate-schema");

function copySchema() {
  return structuredClone(loadSchema(DEFAULT_SCHEMA_PATH));
}

function expectError(schema, pattern) {
  const errors = validateSchemaShape(schema);
  assert.ok(
    errors.some((error) => pattern.test(error)),
    errors.join("\n")
  );
}

test("accepts the current schema structure", () => {
  assert.deepEqual(validateSchemaShape(copySchema()), []);
});

test("rejects malformed top-level schema structures", () => {
  assert.match(validateSchemaShape(null)[0], /schema must be an object/);

  const schema = copySchema();
  schema.$usage.tierOrder = [];
  expectError(schema, /tierOrder must be a non-empty array/);
});

test("rejects unsupported elements and malformed recursive predicates", () => {
  const elementsSchema = copySchema();
  elementsSchema.features.sidewalk.elements = ["area"];
  expectError(
    elementsSchema,
    /elements must contain only node, way, or relation/
  );

  const predicateSchema = copySchema();
  predicateSchema.features.sidewalk.identifier.allOf[0].unknown = true;
  expectError(predicateSchema, /unknown predicate clause field unknown/);
});

test("requires tier ordering to agree and preserves nearest-earlier value rules", () => {
  const orderSchema = copySchema();
  orderSchema.tiers.silver.order = 1;
  expectError(orderSchema, /tiers\.silver\.order must be a number increasing/);

  const specSchema = copySchema();
  const entry = specSchema.features.crossing_way.tags[0];
  entry.minTier = "silver";
  assert.deepEqual(validateSchemaShape(specSchema), []);
});

test("rejects malformed key templates and key-set references", () => {
  const templateSchema = copySchema();
  templateSchema.features.roadway.tags[0].keyTemplate.variables.side.values =
    [];
  expectError(templateSchema, /keyTemplate must define a pattern/);

  const keySetSchema = copySchema();
  keySetSchema.features.roadway.tags[0].keySet.sets[0] = ["sidewalk:middle"];
  expectError(
    keySetSchema,
    /keySet references non-expanded key sidewalk:middle/
  );
});

test("rejects missing active value rules, including tier-only coverage gaps", () => {
  const missing = copySchema();
  delete missing.features.sidewalk.tags[0].valueSpec;
  expectError(missing, /activeAt\.silver: missing valueSpec/);

  const gap = copySchema();
  const entry = gap.features.crossing_way.tags[0];
  delete entry.valueSpecByTier.bronze;
  expectError(gap, /activeAt\.bronze: missing valueSpec/);
});

test("rejects unresolved and unused template variables", () => {
  const unresolved = copySchema();
  unresolved.features.roadway.tags[0].keyTemplate.pattern =
    "sidewalk:{side}:{missing}";
  expectError(unresolved, /keyTemplate contains unresolved placeholders/);

  const unused = copySchema();
  unused.features.roadway.tags[0].keyTemplate.variables.extra = {
    values: ["unused"],
  };
  expectError(unused, /keyTemplate must define a pattern/);
});

test("rejects malformed groups, value exclusions, and version metadata", () => {
  for (const clause of [
    { allOf: [{ key: "access" }], oneOf: ["yes"] },
    { oneOf: "yes" },
    { key: "access", oneOf: [null] },
    { allOf: [] },
  ]) {
    const malformed = copySchema();
    malformed.features.sidewalk.identifier.allOf = [clause];
    assert.notDeepEqual(
      validateSchemaShape(malformed),
      [],
      JSON.stringify(clause)
    );
  }
  for (const notValues of [null, false, "no", [null]]) {
    const malformed = copySchema();
    malformed.features.sidewalk.tags[0].valueSpec.notValues = notValues;
    expectError(malformed, /notValues must be an array of strings/);
  }
  for (const version of [
    "01.0.1",
    "1.0.1-01",
    "1.0.1-",
    "1.0.1\n",
    "../escaped",
  ]) {
    const malformed = copySchema();
    malformed.version = version;
    expectError(malformed, /version must be a valid semantic version/);
  }
});

test("requires generator metadata to have the expected types", () => {
  const tier = copySchema();
  tier.tiers.silver.useCases = null;
  expectError(tier, /tiers\.silver\.useCases must be a non-empty string/);
  const feature = copySchema();
  delete feature.features.sidewalk.name;
  expectError(feature, /features\.sidewalk\.name must be a non-empty string/);
  const keySet = copySchema();
  keySet.features.roadway.tags[0].keySet.description = true;
  expectError(keySet, /keySet\.description must be a string/);
});
