#!/usr/bin/env node
/** @format */

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SCHEMA_PATH,
  entriesForTier,
  expandEntryKeys,
  getActiveValueSpec,
  loadSchema,
} = require("./pwg-schema");
const { parseOptions } = require("./parse-options");

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  "..",
  "styles",
  "pwg_schema.mapcss"
);

const TIER_COLORS = {
  bronze: "#e58139",
  silver: "#cccccc",
  gold: "#e5c839",
  diamond: "#39c8e5",
};
const BELOW_SCHEMA_COLOR = "#ff1744";

const FEATURE_STYLES = {
  sidewalk: { width: 4 },
  crossing_way: { width: 4, dashes: "list(5, 5)" },
  crossing_node: { symbol: true },
  curb: { symbol: true },
  traffic_island: { width: 4, dashes: "list(10, 5)" },
  access_aisle: { width: 4, dashes: "list(3, 6)" },
  footway_area: { area: true },
  roadway: { width: 2, dashes: "list(8, 5)" },
};

function quote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function condition(kind, key, value) {
  return { kind, key, value };
}

function present(key) {
  return condition("present", key);
}

function absent(key) {
  return condition("absent", key);
}

function equal(key, value) {
  return condition("equal", key, String(value));
}

function notEqual(key, value) {
  return condition("notEqual", key, String(value));
}

function matches(key, expression) {
  return condition("matches", key, expression);
}

function notMatches(key, expression) {
  return condition("notMatches", key, expression);
}

function renderCondition(part) {
  const key = quote(part.key);
  if (part.kind === "present") {
    return `[${key}]`;
  }
  if (part.kind === "absent") {
    return `[!${key}]`;
  }
  if (part.kind === "equal") {
    return `[${key}=${quote(part.value)}]`;
  }
  if (part.kind === "notEqual") {
    return `[${key}!=${quote(part.value)}]`;
  }
  if (part.kind === "notMatches") {
    return `[${key}!~/${part.value}/]`;
  }
  return `[${key}=~/${part.value}/]`;
}

function cartesian(left, right) {
  const result = [];
  for (const leftPart of left) {
    for (const rightPart of right) {
      result.push([...leftPart, ...rightPart]);
    }
  }
  return result;
}

function mergeSelectorParts(parts) {
  const byKey = new Map();
  for (const part of parts) {
    if (!byKey.has(part.key)) {
      byKey.set(part.key, []);
    }
    byKey.get(part.key).push(part);
  }

  const merged = [];
  for (const keyParts of byKey.values()) {
    const exactValues = new Set(
      keyParts.filter((part) => part.kind === "equal").map((part) => part.value)
    );
    if (exactValues.size > 1) {
      return null;
    }

    const hasAbsent = keyParts.some((part) => part.kind === "absent");
    const needsPresence = keyParts.some((part) => part.kind !== "absent");
    if (hasAbsent && needsPresence) {
      return null;
    }
    if (hasAbsent) {
      merged.push(keyParts.find((part) => part.kind === "absent"));
      continue;
    }

    const exactValue = [...exactValues][0];
    const forbidden = new Set(
      keyParts
        .filter((part) => part.kind === "notEqual")
        .map((part) => part.value)
    );
    if (exactValue !== undefined && forbidden.has(exactValue)) {
      return null;
    }

    const regexes = keyParts.filter((part) => part.kind === "matches");
    const excludedRegexes = keyParts.filter(
      (part) => part.kind === "notMatches"
    );
    if (
      exactValue !== undefined &&
      regexes.some((part) => !new RegExp(part.value).test(exactValue))
    ) {
      return null;
    }

    if (exactValue !== undefined) {
      if (
        excludedRegexes.some((part) => new RegExp(part.value).test(exactValue))
      ) {
        return null;
      }
      merged.push(equal(keyParts[0].key, exactValue));
      continue;
    }

    if (keyParts.some((part) => part.kind === "present")) {
      merged.push(present(keyParts[0].key));
    }
    merged.push(...regexes);
    merged.push(...excludedRegexes);
    for (const value of forbidden) {
      merged.push(notEqual(keyParts[0].key, value));
    }
  }

  return merged.sort((left, right) =>
    renderCondition(left).localeCompare(renderCondition(right))
  );
}

function normalizeDnf(dnf) {
  const unique = new Map();
  for (const parts of dnf) {
    const merged = mergeSelectorParts(parts);
    if (!merged) {
      continue;
    }
    const key = merged.map(renderCondition).join("");
    unique.set(key, merged);
  }
  return [...unique.values()];
}

function andDnf(...dnfs) {
  return dnfs.reduce(
    (result, dnf) => normalizeDnf(cartesian(result, dnf)),
    [[]]
  );
}

function orDnf(...dnfs) {
  return normalizeDnf(dnfs.flat());
}

function clauseDnf(clause) {
  if (clause.allOf) {
    return andDnf(...clause.allOf.map(clauseDnf));
  }
  if (clause.noneOf) {
    return andDnf(...clause.noneOf.map(negatedClauseDnf));
  }
  if (clause.oneOf && !clause.key) {
    return orDnf(...clause.oneOf.map(clauseDnf));
  }
  if (!clause.key) {
    return [[]];
  }
  const parts = [];
  if (clause.value !== undefined) {
    parts.push(equal(clause.key, clause.value));
  }
  if (clause.oneOf) {
    parts.push(matches(clause.key, enumExpression(clause.oneOf)));
  }
  if (parts.length === 0) {
    parts.push(present(clause.key));
  }
  return normalizeDnf([parts]);
}

function negatedClauseDnf(clause) {
  if (clause.allOf) {
    return orDnf(...clause.allOf.map(negatedClauseDnf));
  }
  if (clause.noneOf) {
    return orDnf(...clause.noneOf.map(clauseDnf));
  }
  if (clause.oneOf && !clause.key) {
    return andDnf(...clause.oneOf.map(negatedClauseDnf));
  }
  if (!clause.key) {
    return [];
  }
  const alternatives = [[absent(clause.key)]];
  if (clause.value !== undefined) {
    alternatives.push([notEqual(clause.key, clause.value)]);
  }
  if (clause.oneOf) {
    alternatives.push([notMatches(clause.key, enumExpression(clause.oneOf))]);
  }
  return normalizeDnf(alternatives);
}

function predicateDnf(predicate) {
  if (!predicate) {
    return [[]];
  }
  return andDnf(
    ...(predicate.allOf ?? []).map(clauseDnf),
    ...(predicate.oneOf ? [orDnf(...predicate.oneOf.map(clauseDnf))] : []),
    ...(predicate.noneOf ?? []).map(negatedClauseDnf)
  );
}

function negatedPredicateDnf(predicate) {
  if (!predicate) {
    return [];
  }
  return orDnf(
    ...(predicate.allOf ?? []).map(negatedClauseDnf),
    ...(predicate.oneOf
      ? [andDnf(...predicate.oneOf.map(negatedClauseDnf))]
      : []),
    ...(predicate.noneOf ?? []).map(clauseDnf)
  );
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enumExpression(values) {
  return `^(?:${values.map(regexEscape).join("|")})$`;
}

function valueDnf(key, spec) {
  if (!spec || spec.type === "free") {
    return [[matches(key, "^.*\\S.*$")]];
  }

  if (spec.type === "enum") {
    return [[matches(key, enumExpression(spec.values ?? []))]];
  }

  if (spec.type === "openEnum") {
    const excluded = spec.notValues?.length
      ? `(?!${spec.notValues.map(regexEscape).join("|")}$)`
      : "";
    return [[matches(key, `^${excluded}.*\\S.*$`)]];
  }

  if (spec.type === "boolean") {
    return [[matches(key, "^(?:yes|no)$")]];
  }

  if (spec.type === "numeric") {
    return [[matches(key, "^\\s*-?\\d+(?:\\.\\d+)?\\s*$")]];
  }

  if (spec.type === "length") {
    const units = ["mm", "cm", "km", "in", "ft", "yd", "mi", "m"].map((unit) =>
      unit.replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`)
    );
    return [
      [
        matches(
          key,
          `^\\s*-?\\d+(?:\\.\\d+)?(?:\\s*(?:${units.join("|")}))?\\s*$`
        ),
      ],
    ];
  }

  if (spec.type === "percent") {
    return [[matches(key, "^\\s*-?\\d+(?:\\.\\d+)?%\\s*$")]];
  }

  if (spec.type === "incline") {
    return [
      [matches(key, "^\\s*(?:up|down|[+-]?\\d+(?:\\.\\d+)?(?:%|°))\\s*$")],
    ];
  }

  return [[matches(key, "^.*\\S.*$")]];
}

function entryDnf(schema, entry, tier) {
  const spec = getActiveValueSpec(schema, entry, tier);
  if (entry.keySet?.mode === "oneOf") {
    return orDnf(
      ...entry.keySet.sets.map((keySet) =>
        andDnf(...keySet.map((key) => valueDnf(key, spec)))
      )
    );
  }
  return andDnf(...expandEntryKeys(entry).map((key) => valueDnf(key, spec)));
}

function tierDnf(schema, feature, tier) {
  const alwaysRequired = [];
  const conditionalGroups = new Map();

  for (const entry of entriesForTier(schema, feature, tier)) {
    if (entry.requirement !== "conditional") {
      alwaysRequired.push(entry);
      continue;
    }
    if (!entry.appliesWhen || entry.condition) {
      // A free-text real-world condition cannot be determined from OSM tags.
      continue;
    }
    const key = JSON.stringify(entry.appliesWhen);
    if (!conditionalGroups.has(key)) {
      conditionalGroups.set(key, {
        predicate: entry.appliesWhen,
        entries: [],
      });
    }
    conditionalGroups.get(key).entries.push(entry);
  }

  const requirements = [predicateDnf(feature.identifier)];
  if (alwaysRequired.length) {
    requirements.push(
      andDnf(...alwaysRequired.map((entry) => entryDnf(schema, entry, tier)))
    );
  }

  for (const { predicate, entries } of conditionalGroups.values()) {
    requirements.push(
      orDnf(
        negatedPredicateDnf(predicate),
        andDnf(
          predicateDnf(predicate),
          ...entries.map((entry) => entryDnf(schema, entry, tier))
        )
      )
    );
  }

  return andDnf(...requirements);
}

function featureSelectors(feature) {
  if (feature.visualization?.layerType === "fill") {
    return (feature.elements ?? [feature.element]).map((element) =>
      element === "way" ? "way:closed" : element
    );
  }
  return [...new Set(feature.elements ?? [feature.element])];
}

function declarations(featureId, color) {
  const style = FEATURE_STYLES[featureId] ?? { width: 4 };
  if (style.area) {
    return [
      `  fill-color: ${color};`,
      "  fill-opacity: 0.35;",
      `  color: ${color};`,
      "  width: 2;",
    ];
  }
  if (style.symbol) {
    return [
      "  symbol-shape: circle;",
      "  symbol-size: 12;",
      `  symbol-fill-color: ${color};`,
      "  symbol-fill-opacity: 0.95;",
      "  symbol-stroke-color: #202020;",
      "  symbol-stroke-width: 1.4;",
    ];
  }
  return [
    `  color: ${color};`,
    `  width: ${style.width};`,
    "  opacity: 0.9;",
    "  casing-color: #202020;",
    "  casing-width: 1;",
    ...(style.dashes ? [`  dashes: ${style.dashes};`] : []),
  ];
}

function rulesForDnf(selectors, dnf, declarationLines) {
  if (dnf.length === 0) {
    return [];
  }
  const rules = [];
  for (const parts of dnf) {
    const suffix = parts.map(renderCondition).join("");
    for (const selector of selectors) {
      rules.push(selector + suffix);
    }
  }
  return [rules.join(",\n"), "{", ...declarationLines, "}"];
}

function generateMapCss(schema) {
  const lines = [
    "/*",
    ` * Generated from ${schema.sourceDocument} and schema/${schema.version}.json by scripts/generate-josm-mapcss.js.`,
    " * Colors show the highest automatically satisfied PWG tier; red needs review.",
    " * Conditional requirements with real-world conditions remain manual review.",
    " */",
    "",
    "meta {",
    `  title: ${quote(`PWG Schema v${schema.version} Tiers`)};`,
    `  version: ${quote(schema.version)};`,
    `  description: ${quote("Colors PWG features by their highest automatically satisfied schema tier.")};`,
    `  link: ${quote("https://github.com/lumikeiju/osm-us-pwg")};`,
    "}",
    "",
  ];

  for (const [featureId, feature] of Object.entries(schema.features)) {
    const selectors = featureSelectors(feature);
    lines.push(
      `/* ${feature.name}: below ${schema.tiers[feature.identifier.minTier].name} tier */`
    );
    lines.push(
      ...rulesForDnf(
        selectors,
        predicateDnf(feature.identifier),
        declarations(featureId, BELOW_SCHEMA_COLOR)
      ),
      ""
    );

    for (const tier of schema.$usage.tierOrder) {
      if (
        schema.tiers[tier].order <
        schema.tiers[feature.identifier.minTier].order
      ) {
        continue;
      }
      const dnf = tierDnf(schema, feature, tier);
      lines.push(`/* ${feature.name}: ${schema.tiers[tier].name} tier */`);
      lines.push(
        ...rulesForDnf(
          selectors,
          dnf,
          declarations(featureId, TIER_COLORS[tier])
        ),
        ""
      );
    }
  }

  return lines.join("\n");
}

function main() {
  const args = parseOptions(process.argv.slice(2), {
    valueOptions: ["schema", "output"],
  });
  const schemaPath = path.resolve(args.schema || DEFAULT_SCHEMA_PATH);
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT_PATH);
  const schema = loadSchema(schemaPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    generateMapCss(schema).replaceAll("\n", "\r\n"),
    "utf8"
  );
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { generateMapCss, tierDnf };
