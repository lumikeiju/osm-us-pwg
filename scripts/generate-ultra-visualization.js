#!/usr/bin/env node
/** @format */

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SCHEMA_PATH,
  entriesForTier,
  expandEntryKeys,
  getActiveValueSpec,
  getFeatureElements,
  getTierIndex,
  loadSchema,
  schemaLicenseNotice,
  valueMatchesSpec,
} = require("./pwg-schema");
const { parseOptions } = require("./parse-options");

const DEFAULT_MODE = "tier";
const DEFAULT_READINESS_TIER = "silver";
const DEFAULT_PROVIDER = "postpass";
const SUPPORTED_PROVIDERS = new Set(["postpass", "overpass"]);
const VISUALIZATIONS_DIR = path.resolve(__dirname, "..", "visualizations");
const POSTPASS_TYPES = { node: "N", way: "W", relation: "R" };
const VALIDATED_VALUES_PROPERTY = "@pwg:valid";

const TIER_COLORS = {
  bronze: "#e58139",
  silver: "#cccccc",
  gold: "#e5c839",
  diamond: "#39c8e5",
};

const READINESS_NOT_READY_COLOR = "#ff1744";
const BELOW_SCHEMA_COLOR = "#ff1744";
const READINESS_READY_SIZE_SCALE = 0.5;
const READINESS_READY_OPACITY = 0.55;

const TIER_GLOW = {
  gold: {
    color: TIER_COLORS.gold,
    opacity: 0.5,
    lineBlur: 8,
    linePad: 7,
    circleBlur: 0.65,
    circlePad: 7,
  },
  diamond: {
    color: TIER_COLORS.diamond,
    opacity: 0.45,
    lineBlur: 6,
    linePad: 5,
    circleBlur: 0.55,
    circlePad: 5,
  },
};

const SHINE_COLOR = "#ffffff";
const SHINE_OPACITY = 0.85;
const SHINE_RADIUS_PAD = 1.1;
const SHINE_OFFSET = [-1.1, -1.1];

const LINE_WIDTHS = {
  default: {
    stops: [
      [13, 2],
      [17, 6],
    ],
  },
  roadway: {
    stops: [
      [13, 0.8],
      [17, 2],
    ],
  },
};

const FEATURE_DASHES = {
  crossing_way: [1.2, 1.2],
  traffic_island: [4, 2],
  access_aisle: [0.6, 1.3],
  roadway: [3, 2],
};

function flow(value) {
  return JSON.stringify(value);
}

function lowerFirst(value) {
  return value.length > 0
    ? `${value[0].toLowerCase()}${value.slice(1)}`
    : value;
}

function allExpression(parts) {
  if (parts.some((part) => part === false)) {
    return false;
  }

  const expressions = parts.filter(
    (part) => part !== true && part !== undefined && part !== null
  );
  if (expressions.length === 0) {
    return true;
  }
  if (expressions.length === 1) {
    return expressions[0];
  }
  return ["all", ...expressions];
}

function anyExpression(parts) {
  if (parts.some((part) => part === true)) {
    return true;
  }

  const expressions = parts.filter(
    (part) => part !== false && part !== undefined && part !== null
  );
  if (expressions.length === 0) {
    return false;
  }
  if (expressions.length === 1) {
    return expressions[0];
  }
  return ["any", ...expressions];
}

function clauseExpression(clause) {
  if (clause.allOf) {
    return allExpression(clause.allOf.map(clauseExpression));
  }
  if (clause.noneOf) {
    return allExpression(
      clause.noneOf.map((part) => ["!", clauseExpression(part)])
    );
  }
  if (clause.oneOf && !clause.key) {
    return anyExpression(clause.oneOf.map(clauseExpression));
  }
  if (!clause.key) {
    return true;
  }
  return allExpression([
    clause.value !== undefined
      ? ["==", ["get", clause.key], String(clause.value)]
      : true,
    clause.oneOf
      ? anyExpression(
          clause.oneOf.map((value) => [
            "==",
            ["get", clause.key],
            String(value),
          ])
        )
      : true,
    clause.value === undefined && !clause.oneOf ? ["has", clause.key] : true,
  ]);
}

function predicateExpression(predicate) {
  if (!predicate) {
    return true;
  }

  return allExpression([
    predicate.allOf
      ? allExpression(predicate.allOf.map(clauseExpression))
      : true,
    predicate.oneOf
      ? anyExpression(predicate.oneOf.map(clauseExpression))
      : true,
    predicate.noneOf
      ? allExpression(
          predicate.noneOf.map((clause) => ["!", clauseExpression(clause)])
        )
      : true,
  ]);
}

function keyValueExpression(valueChecks, key, spec) {
  const check = flow([key, spec]);
  if (!valueChecks.has(check)) {
    valueChecks.set(check, valueChecks.size);
  }
  return [
    "in",
    `,${valueChecks.get(check)},`,
    ["to-string", ["get", VALIDATED_VALUES_PROPERTY]],
  ];
}

function entryExpression({ schema, valueChecks }, entry, tier) {
  if (entry.requirement === "conditional" && entry.condition) {
    return null;
  }

  const spec = getActiveValueSpec(schema, entry, tier);
  const checkKey = (key) => keyValueExpression(valueChecks, key, spec);
  let expression;

  if (entry.keySet?.mode === "oneOf") {
    expression = anyExpression(
      entry.keySet.sets.map((set) => allExpression(set.map(checkKey)))
    );
  } else {
    expression = allExpression(expandEntryKeys(entry).map(checkKey));
  }

  if (entry.requirement === "conditional" && entry.appliesWhen) {
    return anyExpression([
      ["!", predicateExpression(entry.appliesWhen)],
      expression,
    ]);
  }

  return expression;
}

function tierExpression(rules, feature, tier) {
  const expressions = [predicateExpression(feature.identifier)];
  for (const entry of entriesForTier(rules.schema, feature, tier)) {
    expressions.push(entryExpression(rules, entry, tier));
  }
  return allExpression(expressions);
}

function validateFeatureValues(data, checks, provider, matchesValue, property) {
  for (const feature of data.features) {
    let tags = feature.properties ?? {};
    let properties = { ...tags };
    if (provider === "postpass") {
      const { tags: nestedTags, ...metadata } = properties;
      tags = nestedTags ?? {};
      properties = { ...tags, ...metadata };
    }

    // Keep the derived values in one scalar property for MapLibre's GeoJSON tiles.
    const passed = [];
    for (const [index, [key, spec]] of checks.entries()) {
      if (Object.hasOwn(tags, key) && matchesValue(String(tags[key]), spec)) {
        passed.push(index);
      }
    }
    properties[property] = `,${passed.join(",")},`;
    feature.properties = properties;
  }
  return data;
}

function valueTransform(valueChecks, provider) {
  const checks = [...valueChecks.keys()].map((check) => JSON.parse(check));
  const source = [
    valueMatchesSpec.toString(),
    validateFeatureValues.toString(),
    `const checks = ${flow(checks)};`,
    "export default function (data) {",
    `  return validateFeatureValues(data, checks, ${flow(provider)}, valueMatchesSpec, ${flow(VALIDATED_VALUES_PROPERTY)});`,
    "}",
  ].join("\n");
  // Ultra encodes the module with btoa(), which cannot handle arbitrary Unicode.
  const ascii = source.replace(
    /[^\x00-\x7f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  return [
    "# Validate OSM tag values once per rule using the shared PWG evaluator.",
    "transform: |",
    ...ascii.split(/\r?\n/).map((line) => (line ? `  ${line}` : "")),
  ];
}

function popupTemplate(provider) {
  const postpass = provider === "postpass";
  const skipValidation = `{% if tag[0] == ${flow(VALIDATED_VALUES_PROPERTY)} %}{% continue %}{% endif %}`;
  const lines = [
    ...(postpass
      ? [
          "{% assign id = osm_id %}",
          "{% assign typeLabel = osm_type %}",
          "{% case osm_type %}",
          ...Object.entries(POSTPASS_TYPES).map(
            ([type, code]) =>
              `  {% when ${flow(code)} %}{% assign type = ${flow(type)} %}`
          ),
          "  {% else %}{% assign type = osm_type %}",
          "{% endcase %}",
        ]
      : []),
    "{% if type and id %}",
    '  <h2>{{ typeLabel | escape }} <a href="https://www.openstreetmap.org/{{ type | escape }}/{{ id | escape }}" target="_blank">{{ id | escape }}</a> <a href="https://www.openstreetmap.org/edit?{{ type | escape }}={{ id | escape }}" target="_blank">Edit</a></h2>',
    "{% endif %}",
    `{% for tag in ${postpass ? "properties" : "tags"} %}`,
    ...(postpass
      ? [
          `  ${skipValidation}`,
          "  <code>{{ tag[0] | escape }} = {{ tag[1] | json | escape }}</code><br>",
        ]
      : [
          "  {% if forloop.first %}<h3>Tags</h3>{% endif %}",
          '  <code>{{ tag[0] | escape }} = {% if tag[0] contains "website" %}',
          '    <a href="{{ tag[1] | escape }}" target="_blank">{{ tag[1] | escape }}</a>',
          '  {% elsif tag[0] contains "wikidata" %}',
          '    <a href="https://www.wikidata.org/wiki/{{ tag[1] | escape }}" target="_blank">{{ tag[1] | escape }}</a>',
          '  {% elsif tag[0] contains "wikipedia" %}',
          '    {% assign lang = tag[1] | split: ":" | first %}',
          '    <a href="https://{{ lang | escape }}.wikipedia.org/wiki/{{ tag[1] | replace_first: lang, "" | replace_first: ":", "" | escape }}" target="_blank">{{ tag[1] | escape }}</a>',
          "  {% else %}{{ tag[1] | escape }}{% endif %}</code><br>",
        ]),
    "{% endfor %}",
    ...(!postpass
      ? [
          "{% assign showMeta = true %}",
          "{% for tag in meta %}",
          `  ${skipValidation}`,
          "  {% if showMeta %}<h3>Meta</h3>{% assign showMeta = false %}{% endif %}",
          '  <code>{{ tag[0] | escape }} = {% if tag[0] == "changeset" or tag[0] == "user" %}',
          '    <a href="https://www.openstreetmap.org/{{ tag[0] }}/{{ tag[1] | escape }}" target="_blank">{{ tag[1] | escape }}</a>',
          "  {% else %}{{ tag[1] | escape }}{% endif %}</code><br>",
          "{% endfor %}",
          "{% if coordinates %}",
          '  <h3>Coordinates</h3><a href="geo:{{ coordinates[1] }},{{ coordinates[0] }}">{{ coordinates[1] | round: 6 }} / {{ coordinates[0] | round: 6 }}</a> <small>(lat/lon)</small>',
          "{% endif %}",
        ]
      : []),
  ];
  return ["popupTemplate: |", ...lines.map((line) => `  ${line}`)];
}

function featureFilter(feature, geometryType) {
  return allExpression([
    ["==", ["geometry-type"], geometryType],
    predicateExpression(feature.identifier),
  ]);
}

function tierColorExpression(rules, feature) {
  const { schema } = rules;
  const parts = ["case"];
  for (const tier of [...schema.$usage.tierOrder].reverse()) {
    if (
      getTierIndex(schema, tier) <
      getTierIndex(schema, feature.identifier.minTier)
    ) {
      continue;
    }
    parts.push(tierExpression(rules, feature, tier), TIER_COLORS[tier]);
  }
  parts.push(BELOW_SCHEMA_COLOR);
  return parts;
}

function readinessColorExpression(rules, feature, targetTier) {
  return [
    "case",
    tierExpression(rules, feature, targetTier),
    TIER_COLORS[targetTier],
    READINESS_NOT_READY_COLOR,
  ];
}

function layerColorExpression(rules, mode, feature, targetTier) {
  if (mode === "readiness") {
    return readinessColorExpression(rules, feature, targetTier);
  }

  return tierColorExpression(rules, feature);
}

function readinessSizeExpression(rules, feature, targetTier, stops) {
  const ready = tierExpression(rules, feature, targetTier);
  const interp = ["interpolate", ["linear"], ["zoom"]];
  for (const [zoom, size] of stops) {
    interp.push(zoom, [
      "case",
      ready,
      Number((size * READINESS_READY_SIZE_SCALE).toFixed(3)),
      size,
    ]);
  }
  return interp;
}

function readinessOpacityExpression(rules, feature, targetTier, baseOpacity) {
  return [
    "case",
    tierExpression(rules, feature, targetTier),
    READINESS_READY_OPACITY,
    baseOpacity,
  ];
}

function lineLayer(rules, mode, targetTier, featureId, feature) {
  const filter = featureFilter(feature, "LineString");
  if (filter === false) {
    return [];
  }

  const width = LINE_WIDTHS[featureId] ?? LINE_WIDTHS.default;
  const baseOpacity = 0.9;

  const lines = [
    `    - id: ${mode}-${featureId}`,
    "      type: line",
    `      filter: ${flow(filter)}`,
    "      paint:",
    `        line-color: ${flow(layerColorExpression(rules, mode, feature, targetTier))}`,
  ];

  if (mode === "readiness") {
    lines.push(
      `        line-width: ${flow(readinessSizeExpression(rules, feature, targetTier, width.stops))}`
    );
    lines.push(
      `        line-opacity: ${flow(readinessOpacityExpression(rules, feature, targetTier, baseOpacity))}`
    );
  } else {
    lines.push(
      "        line-width:",
      `          stops: ${flow(width.stops)}`,
      `        line-opacity: ${baseOpacity}`
    );
  }

  if (FEATURE_DASHES[featureId]) {
    lines.push(`        line-dasharray: ${flow(FEATURE_DASHES[featureId])}`);
  }

  return lines;
}

function circleLayer(rules, mode, targetTier, featureId, feature) {
  const filter = featureFilter(feature, "Point");
  if (filter === false) {
    return [];
  }

  const radiusStops = [
    [13, 3],
    [17, 9],
  ];
  const baseOpacity = 0.95;
  const baseStrokeWidth = 1.4;

  const lines = [
    `    - id: ${mode}-${featureId}`,
    "      type: circle",
    `      filter: ${flow(filter)}`,
    "      paint:",
    `        circle-color: ${flow(layerColorExpression(rules, mode, feature, targetTier))}`,
  ];

  if (mode === "readiness") {
    lines.push(
      `        circle-radius: ${flow(readinessSizeExpression(rules, feature, targetTier, radiusStops))}`,
      '        circle-stroke-color: "#202020"',
      `        circle-stroke-width: ${flow(["case", tierExpression(rules, feature, targetTier), Number((baseStrokeWidth * READINESS_READY_SIZE_SCALE).toFixed(3)), baseStrokeWidth])}`,
      `        circle-opacity: ${flow(readinessOpacityExpression(rules, feature, targetTier, baseOpacity))}`
    );
  } else {
    lines.push(
      "        circle-radius:",
      `          stops: ${flow(radiusStops)}`,
      '        circle-stroke-color: "#202020"',
      `        circle-stroke-width: ${baseStrokeWidth}`,
      `        circle-opacity: ${baseOpacity}`
    );
  }

  return lines;
}

function fillLayer(rules, mode, targetTier, featureId, feature) {
  const filter = featureFilter(
    feature,
    feature.visualization?.geometryType || "Polygon"
  );
  if (filter === false) {
    return [];
  }

  return [
    `    - id: ${mode}-${featureId}`,
    "      type: fill",
    `      filter: ${flow(filter)}`,
    "      paint:",
    `        fill-color: ${flow(layerColorExpression(rules, mode, feature, targetTier))}`,
    `        fill-opacity: ${feature.visualization?.opacity ?? 0.25}`,
    '        fill-outline-color: "#ffffff"',
  ];
}

function tierGlowFilter(rules, feature, geometryType, tier) {
  const { schema } = rules;
  if (
    getTierIndex(schema, feature.identifier.minTier) >
    getTierIndex(schema, tier)
  ) {
    return false;
  }
  return allExpression([
    featureFilter(feature, geometryType),
    tierExpression(rules, feature, tier),
  ]);
}

function lineGlowLayers(rules, mode, featureId, feature) {
  if (mode !== "tier") {
    return [];
  }
  const width = LINE_WIDTHS[featureId] ?? LINE_WIDTHS.default;
  const lines = [];
  for (const tier of ["gold", "diamond"]) {
    const filter = tierGlowFilter(rules, feature, "LineString", tier);
    if (filter === false) {
      continue;
    }
    const cfg = TIER_GLOW[tier];
    const glowStops = width.stops.map(([zoom, size]) => [
      zoom,
      Number((size + cfg.linePad).toFixed(3)),
    ]);
    lines.push(
      `    - id: ${mode}-${featureId}-glow-${tier}`,
      "      type: line",
      `      filter: ${flow(filter)}`,
      "      paint:",
      `        line-color: "${cfg.color}"`,
      "        line-width:",
      `          stops: ${flow(glowStops)}`,
      `        line-opacity: ${cfg.opacity}`,
      `        line-blur: ${cfg.lineBlur}`
    );
  }
  return lines;
}

function circleGlowLayers(rules, mode, featureId, feature) {
  if (mode !== "tier") {
    return [];
  }
  const lines = [];
  for (const tier of ["gold", "diamond"]) {
    const filter = tierGlowFilter(rules, feature, "Point", tier);
    if (filter === false) {
      continue;
    }
    const cfg = TIER_GLOW[tier];
    const radiusStops = [
      [13, 3 + cfg.circlePad],
      [17, 9 + cfg.circlePad],
    ];
    lines.push(
      `    - id: ${mode}-${featureId}-glow-${tier}`,
      "      type: circle",
      `      filter: ${flow(filter)}`,
      "      paint:",
      `        circle-color: "${cfg.color}"`,
      "        circle-radius:",
      `          stops: ${flow(radiusStops)}`,
      `        circle-opacity: ${cfg.opacity}`,
      `        circle-blur: ${cfg.circleBlur}`,
      "        circle-stroke-width: 0"
    );
  }
  return lines;
}

function circleShineLayer(rules, mode, featureId, feature) {
  if (mode !== "tier") {
    return [];
  }
  // Shine appears for any tier that has a glow (gold or diamond).
  const filter = tierGlowFilter(rules, feature, "Point", "gold");
  if (filter === false) {
    return [];
  }
  const radiusStops = [
    [13, 3 + SHINE_RADIUS_PAD],
    [17, 9 + SHINE_RADIUS_PAD],
  ];
  return [
    `    - id: ${mode}-${featureId}-shine`,
    "      type: circle",
    `      filter: ${flow(filter)}`,
    "      paint:",
    `        circle-color: "${SHINE_COLOR}"`,
    "        circle-radius:",
    `          stops: ${flow(radiusStops)}`,
    `        circle-opacity: ${SHINE_OPACITY}`,
    `        circle-translate: ${flow(SHINE_OFFSET)}`,
    "        circle-stroke-width: 0",
  ];
}

// Overpass expresses OR as a union and AND as adjacent tag filters.
function selectorAlternatives(expression, negated = false) {
  if (typeof expression === "boolean") {
    return expression !== negated ? [[]] : [];
  }
  const [operator, ...args] = expression;
  switch (operator) {
    case "!":
      return selectorAlternatives(args[0], !negated);
    case "all":
    case "any": {
      const branches = args.map((arg) => selectorAlternatives(arg, negated));
      if ((operator === "any") !== negated) {
        return branches.flat();
      }
      return branches.reduce(
        (left, right) => left.flatMap((a) => right.map((b) => [...a, ...b])),
        [[]]
      );
    }
    case "has":
      return [[{ key: args[0], negated }]];
    case "==":
      return [[{ key: args[0][1], value: args[1], negated }]];
    default:
      throw new Error(`Unsupported selector operator: ${operator}`);
  }
}

function querySelectors(features) {
  return features.flatMap(([, feature]) => {
    const alternatives = selectorAlternatives(
      predicateExpression(feature.identifier)
    );
    return getFeatureElements(feature).flatMap((element) =>
      alternatives.map((tags) => ({ element, tags }))
    );
  });
}

function overpassTagFilter({ key, value, negated }) {
  const quotedKey = flow(key);
  if (value === undefined) {
    return `[${negated ? "!" : ""}${quotedKey}]`;
  }
  return `[${quotedKey}${negated ? "!=" : "="}${flow(value)}]`;
}

function overpassQuery(selectors) {
  const statements = new Set(
    selectors.map(
      ({ element, tags }) =>
        `  ${element}${tags.map(overpassTagFilter).join("")};`
    )
  );
  return [
    "[bbox:{{bbox}}];",
    ...(statements.size ? ["(", ...statements, ");"] : []),
    "out geom;",
  ];
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function postpassTagFilter({ key, value, negated }) {
  if (value === undefined) {
    const has = `tags ? ${sqlString(key)}`;
    return negated ? `NOT (${has})` : has;
  }
  // Negating equality also matches features where the tag is absent.
  return `tags->>${sqlString(key)} ${negated ? "IS DISTINCT FROM" : "="} ${sqlString(value)}`;
}

// Postpass wraps this in a subquery, so no trailing semicolon.
function postpassQuery(selectors) {
  const conditions = new Set(
    selectors.map(({ element, tags }) =>
      [
        `osm_type = ${sqlString(POSTPASS_TYPES[element])}`,
        ...tags.map(postpassTagFilter),
      ].join(" AND ")
    )
  );
  return [
    "SELECT osm_type, osm_id, tags, geom",
    "FROM postpass_pointlinepolygon",
    "WHERE geom && ST_MakeEnvelope({{wsen}}, 4326)",
    ...(conditions.size
      ? [
          "  AND (",
          ...[...conditions].map(
            (condition, index) => `    ${index ? "OR " : ""}(${condition})`
          ),
          "  )",
        ]
      : ["  AND FALSE"]),
  ];
}

function viewTitle(schema, mode, targetTier) {
  if (mode === "readiness") {
    return `PWG Schema ${schema.tiers[targetTier].name} Readiness View`;
  }

  return "PWG Schema Tier View";
}

function viewDescription(schema, mode, targetTier) {
  if (mode === "readiness") {
    const readyColor =
      targetTier === "silver" ? "#cccccc gray/silver" : TIER_COLORS[targetTier];
    return `Schema-generated ${schema.tiers[targetTier].name} readiness visualization. ${readyColor} features satisfy ${schema.tiers[targetTier].name} tier requirements for ${lowerFirst(schema.tiers[targetTier].useCases)}; #ff1744 red features match a PWG feature identifier but are not yet ${schema.tiers[targetTier].name}-ready. Features introduced above ${schema.tiers[targetTier].name} are omitted.`;
  }

  return "Schema-generated PWG tier visualization. Colors indicate the highest automatically satisfied PWG tier. Red features match a feature identifier but do not yet satisfy its minimum-tier requirements and need review.";
}

function defaultOutputPath(mode, targetTier, provider) {
  const view = mode === "readiness" ? `${targetTier}_readiness` : "tiers";
  const suffix = provider === DEFAULT_PROVIDER ? "" : `_${provider}`;
  return path.resolve(VISUALIZATIONS_DIR, `pwg_schema_${view}${suffix}.ultra`);
}

function generateUltra(schema, options = {}) {
  const mode = options.mode || DEFAULT_MODE;
  const targetTier = options.targetTier || DEFAULT_READINESS_TIER;
  const provider = options.provider || DEFAULT_PROVIDER;
  const supportedModes = new Set(["tier", "readiness"]);

  if (!supportedModes.has(mode)) {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(
      `Unsupported provider: ${provider}. Expected one of: ${[...SUPPORTED_PROVIDERS].join(", ")}`
    );
  }

  const maxTierIndex =
    mode === "readiness" ? getTierIndex(schema, targetTier) : Infinity;
  const features = Object.entries(schema.features).filter(
    ([, feature]) =>
      getTierIndex(schema, feature.identifier.minTier) <= maxTierIndex
  );
  const rules = { schema, valueChecks: new Map() };
  const layers = [];
  for (const [featureId, feature] of features) {
    const elements = getFeatureElements(feature);
    if (feature.visualization?.layerType === "fill") {
      layers.push(...fillLayer(rules, mode, targetTier, featureId, feature));
    } else if (elements.includes("way")) {
      layers.push(...lineGlowLayers(rules, mode, featureId, feature));
      layers.push(...lineLayer(rules, mode, targetTier, featureId, feature));
    }
    if (elements.includes("node")) {
      layers.push(...circleGlowLayers(rules, mode, featureId, feature));
      layers.push(...circleShineLayer(rules, mode, featureId, feature));
      layers.push(...circleLayer(rules, mode, targetTier, featureId, feature));
    }
  }

  const selectors = querySelectors(features);
  const query =
    provider === "postpass"
      ? postpassQuery(selectors)
      : overpassQuery(selectors);
  return [
    "---",
    ...schemaLicenseNotice(schema).map((line) => (line ? `# ${line}` : "#")),
    `title: ${viewTitle(schema, mode, targetTier)}`,
    `description: ${viewDescription(schema, mode, targetTier)}`,
    `type: ${provider}`,
    ...popupTemplate(provider),
    ...valueTransform(rules.valueChecks, provider),
    "style:",
    "  extends: https://styles.trailsta.sh/protomaps-black.json",
    ...(layers.length ? ["  layers:", ...layers] : ["  layers: []"]),
    "---",
    ...query,
    "",
  ].join("\n");
}

function main() {
  const args = parseOptions(process.argv.slice(2), {
    valueOptions: ["schema", "output", "mode", "targetTier", "provider"],
  });
  const schemaPath = path.resolve(args.schema || DEFAULT_SCHEMA_PATH);
  const mode = args.mode || DEFAULT_MODE;
  const targetTier = args.targetTier || DEFAULT_READINESS_TIER;
  const provider = args.provider || DEFAULT_PROVIDER;
  const outputPath = path.resolve(
    args.output || defaultOutputPath(mode, targetTier, provider)
  );
  const schema = loadSchema(schemaPath);

  fs.writeFileSync(
    outputPath,
    generateUltra(schema, { mode, targetTier, provider }).replaceAll(
      "\n",
      "\r\n"
    ),
    "utf8"
  );
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { generateUltra };
