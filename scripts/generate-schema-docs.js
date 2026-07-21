#!/usr/bin/env node
/** @format */

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SCHEMA_PATH,
  expandEntryKeys,
  getActiveValueSpec,
  getFeatureElements,
  loadSchema,
} = require("./pwg-schema");

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  "..",
  "docs",
  "schema-1.0.1.md"
);

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

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function formatIdentifier(feature) {
  const parts = [];
  for (const clause of feature.identifier.allOf ?? []) {
    if (clause.value !== undefined) {
      parts.push(`${clause.key}=${clause.value}`);
    } else if (clause.key) {
      parts.push(`${clause.key}=*`);
    }
  }
  for (const clause of feature.identifier.noneOf ?? []) {
    if (clause.key) {
      parts.push(`not ${clause.key}`);
    }
  }
  return parts.join(" + ");
}

function formatSpec(spec) {
  if (!spec) {
    return "present";
  }

  if (["enum", "openEnum"].includes(spec.type)) {
    const values = spec.values?.length ? spec.values.join("/") : "any value";
    const prefix = spec.type === "openEnum" ? "examples " : "";
    const exclusions = spec.notValues?.length
      ? `; not ${spec.notValues.join("/")}`
      : "";
    return `${prefix}${values}${exclusions}`;
  }

  if (spec.type === "incline") {
    return "up/down or number%/number°";
  }

  return spec.type;
}

function formatRequirement(entry) {
  if (entry.requirement === "required") {
    return "required";
  }
  if (entry.condition) {
    return `manual review: ${entry.condition}`;
  }
  return "conditional";
}

function formatEntry(schema, entry, tier) {
  const keys = expandEntryKeys(entry).join(", ");
  const spec = formatSpec(getActiveValueSpec(schema, entry, tier));
  const requirement = formatRequirement(entry);
  const keySet = entry.keySet
    ? `; ${entry.keySet.mode}: ${entry.keySet.sets.map((set) => set.join(" + ")).join(" OR ")}`
    : "";
  return `${keys} (${requirement}; ${spec}${keySet})`;
}

function formatTierCell(schema, feature, tier) {
  const entries = feature.tags.filter((entry) => entry.minTier === tier);
  const items = [];
  if (feature.identifier.minTier === tier) {
    items.push(`identifier: ${formatIdentifier(feature)}`);
  }
  items.push(...entries.map((entry) => formatEntry(schema, entry, tier)));
  return items.length ? items.map(markdownEscape).join("<br>") : "";
}

function generateDocs(schema) {
  const tierOrder = schema.$usage.tierOrder;
  const lines = [
    "# PWG Machine-Readable Schema 1.0.1",
    "",
    "This document is generated from `schema/1.0.1.json` by `scripts/generate-schema-docs.js`. It summarizes the schema contract used by query examples, the JOSM preset generator, and Ultra tier styling.",
    "",
    "## Tier Contract",
    "",
    "| Tier | Use cases | Required resources |",
    "| --- | --- | --- |",
  ];

  for (const tier of tierOrder) {
    const tierInfo = schema.tiers[tier];
    lines.push(
      `| ${tierInfo.name} | ${markdownEscape(tierInfo.useCases)} | ${markdownEscape(tierInfo.requiredResources)} |`
    );
  }

  lines.push("", "## Feature Matrix", "");
  lines.push(
    `| Feature | Elements | Identifier | Min tier | ${tierOrder.map((tier) => schema.tiers[tier].name).join(" | ")} |`
  );
  lines.push(
    `| --- | --- | --- | --- | ${tierOrder.map(() => "---").join(" | ")} |`
  );

  for (const [, feature] of Object.entries(schema.features)) {
    const cells = tierOrder.map((tier) =>
      formatTierCell(schema, feature, tier)
    );
    lines.push(
      `| ${markdownEscape(feature.name)} | ${getFeatureElements(feature).join(", ")} | ${markdownEscape(formatIdentifier(feature))} | ${feature.identifier.minTier} | ${cells.join(" | ")} |`
    );
  }

  lines.push(
    "",
    "## Example Query Commands",
    "",
    "```powershell",
    "node scripts/query-schema.js tier-of --element way --tags highway=footway,footway=sidewalk,surface=concrete,lit=yes,width=1.5",
    "node scripts/query-schema.js tags-for-tier --feature crossing_way --tier diamond",
    "node scripts/query-schema.js gap-to-tier --feature curb --tier diamond --tags barrier=kerb,kerb=raised,tactile_paving=yes",
    "node scripts/validate-schema.js",
    "node scripts/generate-josm-preset.js",
    "node scripts/generate-ultra-visualization.js",
    "node scripts/generate-ultra-visualization.js --mode readiness --targetTier silver",
    "node scripts/generate-schema-visualizations.js",
    "```",
    "",
    "Machine-readable examples live in `examples/schema-queries.json`.",
    "",
    "## Consumer Notes",
    "",
    "JOSM preset generation uses one item per feature, `elements` for item type, identifier tags as fixed keys where possible, and one field per expanded schema key. Conditional fields are surfaced in labels because JOSM presets cannot enforce every PWG precondition.",
    "",
    "Ultra tier coloring should evaluate tiers from Diamond down to Bronze. Required tags block tier coloring. `appliesWhen` conditionals block only when their precondition is true. Free-text `condition` entries are manual-review checks and should not block automated coloring.",
    "",
    "Schema-driven example visualizations live in `visualizations/pwg_schema_tiers.ultra` and `visualizations/pwg_schema_silver_readiness.ultra`. Both are generated from the same schema JSON and can be copied directly into Ultra.",
    "",
    "Schema-structure visualizations are generated in two families: `docs/schema-structure.*` for feature/tier hierarchy, and `docs/schema-tier-relationships.*` for tag dependencies and tier progression. Each family is emitted in Markdown, Mermaid, and graph/data formats for different ways of thinking about the schema.",
    "",
    "Roadway sidewalk tagging uses `keySet.mode = oneOf`: `sidewalk:both` is sufficient, or both `sidewalk:left` and `sidewalk:right` must be present. The preset can expose all three fields, but quality evaluation should use the key-set rule.",
    ""
  );

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = path.resolve(args.schema || DEFAULT_SCHEMA_PATH);
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT_PATH);
  const schema = loadSchema(schemaPath);
  fs.writeFileSync(
    outputPath,
    generateDocs(schema).replaceAll("\n", "\r\n"),
    "utf8"
  );
  console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
