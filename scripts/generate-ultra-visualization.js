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
} = require("./pwg-schema");

const DEFAULT_MODE = "tier";
const DEFAULT_READINESS_TIER = "silver";
const VISUALIZATIONS_DIR = path.resolve(__dirname, "..", "visualizations");

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
const INVALID_NUMBER = -9007199254740991;

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
  if (clause.value !== undefined) {
    return ["==", ["get", clause.key], String(clause.value)];
  }
  if (clause.oneOf) {
    return anyExpression(
      clause.oneOf.map((value) => ["==", ["get", clause.key], String(value)])
    );
  }
  return ["has", clause.key];
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

function numericStringExpression(valueExpression) {
  return ["!=", ["to-number", valueExpression, INVALID_NUMBER], INVALID_NUMBER];
}

function valueWithNumberSuffixExpression(valueExpression, suffix) {
  const suffixStart = ["-", ["length", valueExpression], suffix.length];
  return allExpression([
    [">", ["length", valueExpression], suffix.length],
    ["==", ["slice", valueExpression, suffixStart], suffix],
    numericStringExpression(["slice", valueExpression, 0, suffixStart]),
  ]);
}

function keyValueExpression(key, spec) {
  if (!spec) {
    return ["has", key];
  }

  const valueExpression = ["to-string", ["get", key]];
  const nonEmpty = [">", ["length", valueExpression], 0];

  if (spec.type === "enum") {
    return anyExpression(
      (spec.values ?? []).map((value) => ["==", ["get", key], String(value)])
    );
  }

  if (spec.type === "boolean") {
    return anyExpression(
      ["yes", "no"].map((value) => ["==", ["get", key], value])
    );
  }

  if (spec.type === "numeric") {
    return allExpression([nonEmpty, numericStringExpression(valueExpression)]);
  }

  if (spec.type === "length") {
    return allExpression([
      nonEmpty,
      anyExpression([
        numericStringExpression(valueExpression),
        ...["mm", "cm", "km", "in", "ft", "yd", "mi", "m"].map((unit) =>
          valueWithNumberSuffixExpression(valueExpression, unit)
        ),
      ]),
    ]);
  }

  if (spec.type === "percent") {
    return allExpression([
      nonEmpty,
      valueWithNumberSuffixExpression(valueExpression, "%"),
    ]);
  }

  if (spec.type === "incline") {
    return anyExpression([
      ["==", valueExpression, "up"],
      ["==", valueExpression, "down"],
      valueWithNumberSuffixExpression(valueExpression, "%"),
      valueWithNumberSuffixExpression(valueExpression, "°"),
    ]);
  }

  const checks = [nonEmpty];
  for (const value of spec.notValues ?? []) {
    checks.push(["!=", valueExpression, String(value)]);
  }
  return allExpression(checks);
}

function entryExpression(schema, entry, tier) {
  if (
    entry.requirement === "conditional" &&
    entry.condition &&
    !entry.appliesWhen
  ) {
    return null;
  }

  const spec = getActiveValueSpec(schema, entry, tier);
  let expression;

  if (entry.keySet?.mode === "oneOf") {
    expression = anyExpression(
      entry.keySet.sets.map((set) =>
        allExpression(set.map((key) => keyValueExpression(key, spec)))
      )
    );
  } else {
    expression = allExpression(
      expandEntryKeys(entry).map((key) => keyValueExpression(key, spec))
    );
  }

  if (entry.requirement === "conditional" && entry.appliesWhen) {
    return anyExpression([
      ["!", predicateExpression(entry.appliesWhen)],
      expression,
    ]);
  }

  return expression;
}

function tierExpression(schema, feature, tier) {
  const expressions = [predicateExpression(feature.identifier)];
  for (const entry of entriesForTier(schema, feature, tier)) {
    expressions.push(entryExpression(schema, entry, tier));
  }
  return allExpression(expressions);
}

function featureFilter(feature, geometryType) {
  return allExpression([
    ["==", ["geometry-type"], geometryType],
    predicateExpression(feature.identifier),
  ]);
}

function tierColorExpression(schema, feature) {
  const parts = ["case"];
  for (const tier of [...schema.$usage.tierOrder].reverse()) {
    if (
      getTierIndex(schema, tier) <
      getTierIndex(schema, feature.identifier.minTier)
    ) {
      continue;
    }
    parts.push(tierExpression(schema, feature, tier), TIER_COLORS[tier]);
  }
  parts.push(BELOW_SCHEMA_COLOR);
  return parts;
}

function readinessColorExpression(schema, feature, targetTier) {
  return [
    "case",
    tierExpression(schema, feature, targetTier),
    TIER_COLORS[targetTier],
    READINESS_NOT_READY_COLOR,
  ];
}

function layerColorExpression(schema, mode, feature, targetTier) {
  if (mode === "readiness") {
    return readinessColorExpression(schema, feature, targetTier);
  }

  return tierColorExpression(schema, feature);
}

function layerFilter(schema, mode, feature, geometryType, targetTier) {
  const filter = featureFilter(feature, geometryType);
  if (mode !== "readiness") {
    return filter;
  }

  if (
    getTierIndex(schema, feature.identifier.minTier) >
    getTierIndex(schema, targetTier)
  ) {
    return false;
  }

  return filter;
}

function readinessSizeExpression(schema, feature, targetTier, stops) {
  const ready = tierExpression(schema, feature, targetTier);
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

function readinessOpacityExpression(schema, feature, targetTier, baseOpacity) {
  return [
    "case",
    tierExpression(schema, feature, targetTier),
    READINESS_READY_OPACITY,
    baseOpacity,
  ];
}

function lineLayer(schema, mode, targetTier, featureId, feature) {
  const filter = layerFilter(schema, mode, feature, "LineString", targetTier);
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
    `        line-color: ${flow(layerColorExpression(schema, mode, feature, targetTier))}`,
  ];

  if (mode === "readiness") {
    lines.push(
      `        line-width: ${flow(readinessSizeExpression(schema, feature, targetTier, width.stops))}`
    );
    lines.push(
      `        line-opacity: ${flow(readinessOpacityExpression(schema, feature, targetTier, baseOpacity))}`
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

function circleLayer(schema, mode, targetTier, featureId, feature) {
  const filter = layerFilter(schema, mode, feature, "Point", targetTier);
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
    `        circle-color: ${flow(layerColorExpression(schema, mode, feature, targetTier))}`,
  ];

  if (mode === "readiness") {
    lines.push(
      `        circle-radius: ${flow(readinessSizeExpression(schema, feature, targetTier, radiusStops))}`,
      '        circle-stroke-color: "#202020"',
      `        circle-stroke-width: ${flow(["case", tierExpression(schema, feature, targetTier), Number((baseStrokeWidth * READINESS_READY_SIZE_SCALE).toFixed(3)), baseStrokeWidth])}`,
      `        circle-opacity: ${flow(readinessOpacityExpression(schema, feature, targetTier, baseOpacity))}`
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

function fillLayer(schema, mode, targetTier, featureId, feature) {
  const filter = layerFilter(
    schema,
    mode,
    feature,
    feature.visualization?.geometryType || "Polygon",
    targetTier
  );
  if (filter === false) {
    return [];
  }

  return [
    `    - id: ${mode}-${featureId}`,
    "      type: fill",
    `      filter: ${flow(filter)}`,
    "      paint:",
    `        fill-color: ${flow(layerColorExpression(schema, mode, feature, targetTier))}`,
    `        fill-opacity: ${feature.visualization?.opacity ?? 0.25}`,
    '        fill-outline-color: "#ffffff"',
  ];
}

function tierGlowFilter(schema, feature, geometryType, tier) {
  if (
    getTierIndex(schema, feature.identifier.minTier) >
    getTierIndex(schema, tier)
  ) {
    return false;
  }
  return allExpression([
    featureFilter(feature, geometryType),
    tierExpression(schema, feature, tier),
  ]);
}

function lineGlowLayers(schema, mode, featureId, feature) {
  if (mode !== "tier") {
    return [];
  }
  const width = LINE_WIDTHS[featureId] ?? LINE_WIDTHS.default;
  const lines = [];
  for (const tier of ["gold", "diamond"]) {
    const filter = tierGlowFilter(schema, feature, "LineString", tier);
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

function circleGlowLayers(schema, mode, featureId, feature) {
  if (mode !== "tier") {
    return [];
  }
  const lines = [];
  for (const tier of ["gold", "diamond"]) {
    const filter = tierGlowFilter(schema, feature, "Point", tier);
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

function circleShineLayer(schema, mode, featureId, feature) {
  if (mode !== "tier") {
    return [];
  }
  // Shine appears for any tier that has a glow (gold or diamond).
  const filter = tierGlowFilter(schema, feature, "Point", "gold");
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

function overpassQuery() {
  return [
    "[bbox:{{bbox}}];",
    "(",
    '  way[highway=footway][footway~"^(sidewalk|crossing|traffic_island|access_aisle)$"];',
    '  way["area:highway"=footway];',
    '  relation["area:highway"=footway];',
    "  node[highway=crossing];",
    "  node[barrier=kerb];",
    "  way[highway][!footway];",
    ");",
    "out geom;",
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

function defaultOutputPath(mode, targetTier) {
  if (mode === "readiness") {
    return path.resolve(
      VISUALIZATIONS_DIR,
      `pwg_schema_${targetTier}_readiness.ultra`
    );
  }

  return path.resolve(VISUALIZATIONS_DIR, "pwg_schema_tiers.ultra");
}

function generateUltra(schema, options = {}) {
  const mode = options.mode || DEFAULT_MODE;
  const targetTier = options.targetTier || DEFAULT_READINESS_TIER;
  const supportedModes = new Set(["tier", "readiness"]);

  if (!supportedModes.has(mode)) {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  if (mode === "readiness") {
    getTierIndex(schema, targetTier);
  }

  const lines = [
    "---",
    `title: ${viewTitle(schema, mode, targetTier)}`,
    `description: ${viewDescription(schema, mode, targetTier)}`,
    "style:",
    "  extends: https://styles.trailsta.sh/protomaps-black.json",
    "  layers:",
  ];

  for (const [featureId, feature] of Object.entries(schema.features)) {
    const elements = getFeatureElements(feature);
    if (feature.visualization?.layerType === "fill") {
      lines.push(...fillLayer(schema, mode, targetTier, featureId, feature));
    } else if (elements.includes("way")) {
      lines.push(...lineGlowLayers(schema, mode, featureId, feature));
      lines.push(...lineLayer(schema, mode, targetTier, featureId, feature));
    }

    if (elements.includes("node")) {
      lines.push(...circleGlowLayers(schema, mode, featureId, feature));
      lines.push(...circleShineLayer(schema, mode, featureId, feature));
      lines.push(...circleLayer(schema, mode, targetTier, featureId, feature));
    }
  }

  lines.push("---", ...overpassQuery(), "");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = path.resolve(args.schema || DEFAULT_SCHEMA_PATH);
  const mode = args.mode || DEFAULT_MODE;
  const targetTier = args.targetTier || DEFAULT_READINESS_TIER;
  const outputPath = path.resolve(
    args.output || defaultOutputPath(mode, targetTier)
  );
  const schema = loadSchema(schemaPath);

  fs.writeFileSync(
    outputPath,
    generateUltra(schema, { mode, targetTier }).replaceAll("\n", "\r\n"),
    "utf8"
  );
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
