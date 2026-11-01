/** @format */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  DEFAULT_SCHEMA_PATH,
  getTierIndex,
  loadSchema,
  tierOf,
} = require("../scripts/pwg-schema");
const { generateMapCss, tierDnf } = require("../scripts/generate-josm-mapcss");
const { generateUltra } = require("../scripts/generate-ultra-visualization");

const schema = loadSchema(DEFAULT_SCHEMA_PATH);
const MAPCSS_TIER_COLORS = {
  bronze: "#e58139",
  silver: "#cccccc",
  gold: "#e5c839",
  diamond: "#39c8e5",
};
const BELOW_SCHEMA_COLOR = "#ff1744";

const crossingTags = (overrides = {}) => ({
  highway: "footway",
  footway: "crossing",
  "crossing:markings": "zebra",
  "crossing:signals": "no",
  surface: "asphalt",
  "crossing:island": "yes",
  "crossing:signed": "yes",
  width: "3 m",
  ...overrides,
});

const sidewalkTags = (overrides = {}) => ({
  highway: "footway",
  footway: "sidewalk",
  surface: "concrete",
  lit: "yes",
  width: "1.5 m",
  incline: "up",
  ...overrides,
});

const fixtures = [
  {
    name: "feature starts at Bronze",
    featureId: "sidewalk",
    element: "way",
    tags: { highway: "footway", footway: "sidewalk" },
    tier: "bronze",
  },
  {
    name: "feature advances to Silver when its new requirement is met",
    featureId: "sidewalk",
    element: "way",
    tags: { highway: "footway", footway: "sidewalk", surface: "asphalt" },
    tier: "silver",
  },
  {
    name: "conditional crossing fields are skipped when the predicate is false",
    featureId: "crossing_way",
    element: "way",
    tags: crossingTags(),
    tier: "gold",
  },
  {
    name: "conditional crossing fields block when the predicate is true",
    featureId: "crossing_way",
    element: "way",
    tags: crossingTags({ "crossing:signals": "yes" }),
    tier: "silver",
  },
  {
    name: "conditional crossing fields pass when the predicate and fields match",
    featureId: "crossing_way",
    element: "way",
    tags: crossingTags({
      "crossing:signals": "yes",
      button_operated: "yes",
      "traffic_signals:arrow": "yes",
      "traffic_signals:vibration": "yes",
      "traffic_signals:sound": "yes",
    }),
    tier: "gold",
  },
  {
    name: "a tag's Silver open-enum value rule replaces its Bronze rule",
    featureId: "crossing_way",
    element: "way",
    tags: crossingTags({ "crossing:markings": "zebra" }),
    tier: "gold",
  },
  {
    name: "an invalidated Silver enum value remains Bronze",
    featureId: "crossing_way",
    element: "way",
    tags: crossingTags({ "crossing:markings": "yes" }),
    tier: "bronze",
  },
  {
    name: "roadway accepts the sidewalk:both alternative",
    featureId: "roadway",
    element: "way",
    tags: { highway: "residential", "sidewalk:both": "separate" },
    tier: "silver",
  },
  {
    name: "roadway accepts the paired left and right alternative",
    featureId: "roadway",
    element: "way",
    tags: {
      highway: "residential",
      "sidewalk:left": "separate",
      "sidewalk:right": "no",
    },
    tier: "silver",
  },
  {
    name: "roadway rejects an incomplete left and right alternative",
    featureId: "roadway",
    element: "way",
    tags: { highway: "residential", "sidewalk:left": "separate" },
    tier: null,
  },
  {
    name: "sidewalk accepts case-insensitive length units",
    featureId: "sidewalk",
    element: "way",
    tags: sidewalkTags({
      width: "5 FT",
      incline: "up",
      "incline:across": "-3%",
      tactile_paving: "yes",
      "tactile_paving:colour": "yellow",
    }),
    tier: "diamond",
  },
  {
    name: "sidewalk accepts signed percentage incline values",
    featureId: "sidewalk",
    element: "way",
    tags: sidewalkTags({
      "incline:across": "-3%",
      tactile_paving: "yes",
      "tactile_paving:colour": "yellow",
    }),
    tier: "diamond",
  },
  {
    name: "sidewalk rejects malformed incline values",
    featureId: "sidewalk",
    element: "way",
    tags: sidewalkTags({
      "incline:across": "3 degrees",
      tactile_paving: "yes",
      "tactile_paving:colour": "yellow",
    }),
    tier: "gold",
  },
  ...["mm", "cm", "m", "km", "in", "ft", "yd", "mi"].flatMap((unit) =>
    [unit, unit.toUpperCase()].map((suffix) => ({
      name: `length unit ${suffix} remains supported`,
      featureId: "sidewalk",
      element: "way",
      tags: sidewalkTags({ width: `5 ${suffix}` }),
      tier: "gold",
    }))
  ),
  {
    name: "node features start at their own minimum tier",
    featureId: "curb",
    element: "node",
    tags: { barrier: "kerb", kerb: "raised", tactile_paving: "no" },
    tier: "silver",
  },
  {
    name: "area features can enter the schema without tag additions",
    featureId: "footway_area",
    element: "way",
    tags: { "area:highway": "footway" },
    tier: "diamond",
  },
];

function matchesCondition(part, tags) {
  const present = Object.prototype.hasOwnProperty.call(tags, part.key);
  const value = present ? String(tags[part.key]) : undefined;

  switch (part.kind) {
    case "present":
      return present;
    case "absent":
      return !present;
    case "equal":
      return present && value === part.value;
    case "notEqual":
      return present && value !== part.value;
    case "matches":
      return present && new RegExp(part.value).test(value);
    case "notMatches":
      return present && !new RegExp(part.value).test(value);
    default:
      throw new Error(`Unknown MapCSS condition: ${part.kind}`);
  }
}

function matchesDnf(dnf, tags) {
  return dnf.some((parts) =>
    parts.every((part) => matchesCondition(part, tags))
  );
}

function mapCssTier(selectedSchema, feature, tags) {
  let matchedTier = null;
  for (const tier of selectedSchema.$usage.tierOrder.slice(
    getTierIndex(selectedSchema, feature.identifier.minTier)
  )) {
    if (matchesDnf(tierDnf(selectedSchema, feature, tier), tags)) {
      matchedTier = tier;
    }
  }
  return matchedTier;
}

function serializedMapCssTier(css, feature, element, tags) {
  let color;
  const groups = css.matchAll(
    /\/\* ([^*\n]+) \*\/\n([\s\S]*?)\n\{\n([\s\S]*?)\n\}/g
  );
  for (const [, label, selectors, declarations] of groups) {
    if (!label.startsWith(`${feature.name}: `)) {
      continue;
    }
    const matches = selectors.split(",\n").some((selector) => {
      const type = /^(node|way|relation)(?::closed)?/.exec(selector);
      assert.ok(type, `Unsupported generated selector: ${selector}`);
      if (type[1] !== element) {
        return false;
      }
      let suffix = selector.slice(type[0].length);
      while (suffix.length) {
        const part =
          /^\[(!?)("(?:\\.|[^"\\])*")(?:(!=|=~|!~|=)("(?:\\.|[^"\\])*"|\/(?:\\.|[^/\\])*\/))?\]/.exec(
            suffix
          );
        assert.ok(part, `Unsupported generated condition: ${suffix}`);
        const key = JSON.parse(part[2]);
        const operator = part[3];
        const kind = operator
          ? {
              "=": "equal",
              "!=": "notEqual",
              "=~": "matches",
              "!~": "notMatches",
            }[operator]
          : part[1]
            ? "absent"
            : "present";
        const value = operator
          ? part[4].startsWith('"')
            ? JSON.parse(part[4])
            : part[4].slice(1, -1)
          : undefined;
        if (!matchesCondition({ kind, key, value }, tags)) {
          return false;
        }
        suffix = suffix.slice(part[0].length);
      }
      return true;
    });
    if (matches) {
      const declaration =
        /(?:^|\n)\s*(?:symbol-fill-color|fill-color|color): (#[0-9a-f]+);/.exec(
          declarations
        );
      assert.ok(declaration, `Missing generated color for ${label}`);
      color = declaration[1];
    }
  }
  return (
    Object.entries(MAPCSS_TIER_COLORS).find(
      ([, tierColor]) => tierColor === color
    )?.[0] ?? null
  );
}

function evaluateMapLibre(expression, tags) {
  if (!Array.isArray(expression)) {
    return expression;
  }

  const [operator, ...args] = expression;
  switch (operator) {
    case "has":
      return Object.prototype.hasOwnProperty.call(tags, args[0]);
    case "get":
      return tags[args[0]] ?? null;
    case "all":
      return args.every((arg) => Boolean(evaluateMapLibre(arg, tags)));
    case "any":
      return args.some((arg) => Boolean(evaluateMapLibre(arg, tags)));
    case "!":
      return !evaluateMapLibre(args[0], tags);
    case "==":
      return (
        evaluateMapLibre(args[0], tags) === evaluateMapLibre(args[1], tags)
      );
    case "!=":
      return (
        evaluateMapLibre(args[0], tags) !== evaluateMapLibre(args[1], tags)
      );
    case ">":
      return evaluateMapLibre(args[0], tags) > evaluateMapLibre(args[1], tags);
    case "-": {
      const values = args.map((arg) => Number(evaluateMapLibre(arg, tags)));
      return values.length === 1
        ? -values[0]
        : values.slice(1).reduce((total, value) => total - value, values[0]);
    }
    case "length":
      return String(evaluateMapLibre(args[0], tags) ?? "").length;
    case "to-string":
      return String(evaluateMapLibre(args[0], tags) ?? "");
    case "to-number": {
      for (const arg of args) {
        const value = evaluateMapLibre(arg, tags);
        const number = Number(value);
        if (!Number.isNaN(number)) {
          return number;
        }
      }
      throw new Error("Could not convert value to number");
    }
    case "slice": {
      const value = String(evaluateMapLibre(args[0], tags) ?? "");
      const start = evaluateMapLibre(args[1], tags);
      const end = args.length > 2 ? evaluateMapLibre(args[2], tags) : undefined;
      return value.slice(start, end);
    }
    case "downcase":
      return String(evaluateMapLibre(args[0], tags) ?? "").toLowerCase();
    case "case":
      for (let index = 0; index < args.length - 1; index += 2) {
        if (evaluateMapLibre(args[index], tags)) {
          return evaluateMapLibre(args[index + 1], tags);
        }
      }
      return evaluateMapLibre(args[args.length - 1], tags);
    default:
      throw new Error(`Unsupported MapLibre expression: ${operator}`);
  }
}

function ultraColor(featureId, ultraStyle, tags, mode = "tier") {
  const layerId = `    - id: ${mode}-${featureId}`;
  const lines = ultraStyle.split(/\r?\n/);
  const start = lines.indexOf(layerId);
  assert.notEqual(start, -1, `Missing Ultra layer ${featureId}`);
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("    - id:")
  );
  const layerLines = lines.slice(start, end === -1 ? undefined : end);
  const colorLine = layerLines.find((line) =>
    /^\s+(?:line|circle|fill)-color: /.test(line)
  );
  assert.ok(colorLine, `Missing color expression for ${featureId}`);
  const expression = JSON.parse(colorLine.slice(colorLine.indexOf(": ") + 2));
  return evaluateMapLibre(expression, tags);
}

function ultraTier(featureId, ultraStyle, tags) {
  const color = ultraColor(featureId, ultraStyle, tags);
  return (
    Object.entries(MAPCSS_TIER_COLORS).find(
      ([, tierColor]) => tierColor === color
    )?.[0] ?? null
  );
}

function assertMapCssColor(css, feature, tier) {
  const tierName = tier
    ? schema.tiers[tier].name
    : `below ${schema.tiers[feature.identifier.minTier].name} tier`;
  const marker = `/* ${feature.name}: ${tierName}${tier ? " tier" : ""} */`;
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `Missing MapCSS rule group: ${marker}`);
  const next = css.indexOf("\n/* ", start + marker.length);
  const ruleGroup = css.slice(start, next === -1 ? undefined : next);
  const color = tier ? MAPCSS_TIER_COLORS[tier] : BELOW_SCHEMA_COLOR;
  assert.ok(ruleGroup.includes(color), `${marker} does not use ${color}`);
}

test("query, Ultra, and JOSM PaintStyle classify shared schema fixtures consistently", () => {
  const mapCss = generateMapCss(schema);
  const ultra = generateUltra(schema);

  for (const fixture of fixtures) {
    const feature = schema.features[fixture.featureId];
    const queryResult = tierOf(schema, fixture.element, fixture.tags).find(
      (candidate) => candidate.featureId === fixture.featureId
    );
    assert.ok(queryResult, `${fixture.name}: query did not identify feature`);
    assert.equal(
      queryResult.tier,
      fixture.tier,
      `${fixture.name}: query result`
    );
    assert.equal(
      mapCssTier(schema, feature, fixture.tags),
      fixture.tier,
      `${fixture.name}: JOSM PaintStyle rules`
    );
    assert.equal(
      serializedMapCssTier(mapCss, feature, fixture.element, fixture.tags),
      fixture.tier,
      `${fixture.name}: serialized JOSM PaintStyle`
    );
    assert.equal(
      ultraTier(fixture.featureId, ultra, fixture.tags),
      fixture.tier,
      `${fixture.name}: Ultra styling`
    );
    assertMapCssColor(mapCss, feature, fixture.tier);
  }
});

test("readiness views use the same requirements and omit later-introduced features", () => {
  for (const targetTier of schema.$usage.tierOrder) {
    const ultra = generateUltra(schema, { mode: "readiness", targetTier });
    for (const fixture of fixtures) {
      const feature = schema.features[fixture.featureId];
      if (
        getTierIndex(schema, feature.identifier.minTier) >
        getTierIndex(schema, targetTier)
      ) {
        assert.ok(
          !ultra.includes(`    - id: readiness-${fixture.featureId}\n`)
        );
        continue;
      }
      const result = tierOf(schema, fixture.element, fixture.tags).find(
        (candidate) => candidate.featureId === fixture.featureId
      );
      const ready = result.evaluations[targetTier].passes;
      assert.equal(
        ultraColor(fixture.featureId, ultra, fixture.tags, "readiness"),
        ready ? MAPCSS_TIER_COLORS[targetTier] : BELOW_SCHEMA_COLOR,
        `${fixture.name}: ${targetTier} readiness`
      );
    }
  }
});

test("compound predicates and manual-review conditionals agree across consumers", () => {
  const selectedSchema = structuredClone(schema);
  const feature = selectedSchema.features.sidewalk;
  const entry = feature.tags.find((tag) => tag.key === "tactile_paving:colour");
  const tags = sidewalkTags({ "incline:across": "-3%", tactile_paving: "yes" });
  const predicates = [
    {
      oneOf: [
        { key: "surface", value: "concrete" },
        { key: "surface", value: "asphalt" },
      ],
    },
    {
      allOf: [
        {
          oneOf: [
            { key: "surface", value: "concrete" },
            { noneOf: [{ key: "surface", value: "concrete" }] },
          ],
        },
      ],
    },
    { allOf: [{ key: "tactile_paving", value: "yes", oneOf: ["no"] }] },
    { noneOf: [{ key: "surface", value: "concrete", oneOf: ["asphalt"] }] },
  ];
  for (const predicate of predicates) {
    entry.appliesWhen = predicate;
    const ultra = generateUltra(selectedSchema);
    for (const candidateTags of [
      tags,
      { ...tags, surface: "gravel" },
      { ...tags, "tactile_paving:colour": "yellow" },
    ]) {
      const expected = tierOf(selectedSchema, "way", candidateTags).find(
        (candidate) => candidate.featureId === "sidewalk"
      ).tier;
      assert.equal(
        mapCssTier(selectedSchema, feature, candidateTags),
        expected,
        JSON.stringify(predicate)
      );
      assert.equal(
        ultraTier("sidewalk", ultra, candidateTags),
        expected,
        JSON.stringify(predicate)
      );
    }
  }
  entry.condition = "verify on site";
  entry.appliesWhen = { allOf: [{ key: "tactile_paving", value: "yes" }] };
  const expected = tierOf(selectedSchema, "way", tags).find(
    (candidate) => candidate.featureId === "sidewalk"
  ).tier;
  assert.equal(expected, "diamond");
  assert.equal(mapCssTier(selectedSchema, feature, tags), expected);
  assert.equal(
    ultraTier("sidewalk", generateUltra(selectedSchema), tags),
    expected
  );
});

test("impossible predicates do not produce selectorless MapCSS blocks", () => {
  const selectedSchema = structuredClone(schema);
  selectedSchema.features.sidewalk.identifier.allOf.push({
    key: "highway",
    value: "residential",
  });
  const css = generateMapCss(selectedSchema);
  assert.doesNotMatch(css, /\*\/\n\n?\{\n/);
});

test("shared fixtures exercise every value-spec type in the current schema", () => {
  const coveredTypes = new Set();
  for (const fixture of fixtures) {
    const result = tierOf(schema, fixture.element, fixture.tags).find(
      (candidate) => candidate.featureId === fixture.featureId
    );
    for (const evaluation of Object.values(result.evaluations)) {
      for (const entry of [
        ...evaluation.passedEntries,
        ...evaluation.blockers,
      ]) {
        const spec = entry.valueSpec;
        if (spec) {
          coveredTypes.add(spec.type);
        }
      }
    }
  }

  const schemaTypes = new Set(
    Object.values(schema.features)
      .flatMap((feature) =>
        feature.tags.flatMap((entry) => [
          entry.valueSpec?.type,
          ...Object.values(entry.valueSpecByTier ?? {}).map(
            (spec) => spec.type
          ),
        ])
      )
      .filter(Boolean)
  );
  for (const type of schemaTypes) {
    assert.ok(coveredTypes.has(type), `No shared fixture covers ${type}`);
  }
});
