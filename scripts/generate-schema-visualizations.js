#!/usr/bin/env node
/** @format */

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SCHEMA_PATH,
  expandEntryKeys,
  getActiveValueSpec,
  getFeatureElements,
  getTierOrder,
  loadSchema,
} = require("./pwg-schema");

const DOCS_DIR = path.resolve(__dirname, "..", "docs");

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

function mermaidLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', "'");
}

function dotLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function idFor(...parts) {
  return parts
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function dependencySummary(entry) {
  const keys = collectPredicateKeys(entry.appliesWhen);
  const pieces = [];
  if (keys.length > 0) {
    pieces.push(`requires ${keys.join(", ")}`);
  }
  if (entry.condition) {
    pieces.push(entry.condition);
  }
  if (entry.keySet) {
    pieces.push(entry.keySet.sets.map((set) => set.join(" + ")).join(" OR "));
  }
  return pieces.join("; ");
}

function collectPredicateKeys(predicate) {
  const keys = [];

  function visit(clause) {
    if (!clause) {
      return;
    }
    if (clause.key) {
      keys.push(clause.key);
    }
    for (const child of clause.allOf ?? []) {
      visit(child);
    }
    for (const child of clause.oneOf ?? []) {
      if (typeof child === "object") {
        visit(child);
      }
    }
    for (const child of clause.noneOf ?? []) {
      visit(child);
    }
  }

  visit(predicate);
  return [...new Set(keys)];
}

function tagRows(schema) {
  const rows = [];
  for (const [featureId, feature] of Object.entries(schema.features)) {
    rows.push({
      featureId,
      featureName: feature.name,
      keys: [formatIdentifier(feature)],
      tier: feature.identifier.minTier,
      requirement: "identifier",
      valueSpec: "identity",
      dependency: "",
    });

    for (const entry of feature.tags) {
      rows.push({
        featureId,
        featureName: feature.name,
        keys: expandEntryKeys(entry),
        tier: entry.minTier,
        requirement: formatRequirement(entry),
        valueSpec: formatSpec(getActiveValueSpec(schema, entry, entry.minTier)),
        dependency: dependencySummary(entry),
      });
    }
  }
  return rows;
}

function generateStructureMarkdown(schema) {
  const lines = [
    "# PWG Schema Structure",
    "",
    "Generated from `schema/1.0.1.json` by `scripts/generate-schema-visualizations.js`.",
    "",
    "This view is for table-first thinking: features are the primary objects, tiers describe when they enter the schema, and tag rows show how detail accumulates.",
    "",
    "| Feature | Elements | Identifier | Starts at | Tags by tier |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const [, feature] of Object.entries(schema.features)) {
    const tagsByTier = getTierOrder(schema)
      .map((tier) => {
        const tags = feature.tags
          .filter((entry) => entry.minTier === tier)
          .flatMap(expandEntryKeys);
        return tags.length
          ? `${schema.tiers[tier].name}: ${tags.join(", ")}`
          : "";
      })
      .filter(Boolean)
      .join("<br>");

    lines.push(
      `| ${markdownEscape(feature.name)} | ${getFeatureElements(feature).join(", ")} | ${markdownEscape(formatIdentifier(feature))} | ${schema.tiers[feature.identifier.minTier].name} | ${markdownEscape(tagsByTier || "identifier only")} |`
    );
  }

  lines.push(
    "",
    "## Tier Summary",
    "",
    "| Tier | Features introduced | Tags introduced |",
    "| --- | --- | --- |"
  );
  for (const tier of getTierOrder(schema)) {
    const featureCount = Object.values(schema.features).filter(
      (feature) => feature.identifier.minTier === tier
    ).length;
    const tagCount = Object.values(schema.features).reduce(
      (count, feature) =>
        count + feature.tags.filter((entry) => entry.minTier === tier).length,
      0
    );
    lines.push(
      `| ${schema.tiers[tier].name} | ${featureCount} | ${tagCount} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

function generateStructureMermaid(schema) {
  const lines = [
    "flowchart LR",
    `  schema["PWG Schema ${schema.version}"]`,
    '  schema --> tiers["Tiers"]',
    '  schema --> features["Features"]',
  ];

  for (const tier of getTierOrder(schema)) {
    lines.push(
      `  tiers --> tier_${tier}["${mermaidLabel(schema.tiers[tier].name)}"]`
    );
  }

  for (const [featureId, feature] of Object.entries(schema.features)) {
    const featureNode = idFor("feature", featureId);
    lines.push(
      `  features --> ${featureNode}["${mermaidLabel(feature.name)}\\n${getFeatureElements(feature).join(", ")}\\nstarts: ${schema.tiers[feature.identifier.minTier].name}"]`
    );
    lines.push(
      `  ${featureNode} --> ${idFor(featureId, "identifier")}["identifier\\n${mermaidLabel(formatIdentifier(feature))}"]`
    );
    lines.push(
      `  ${featureNode} -. starts at .-> tier_${feature.identifier.minTier}`
    );

    for (const entry of feature.tags) {
      const tagNode = idFor("tag", featureId, entry.key);
      lines.push(
        `  ${featureNode} --> ${tagNode}["${mermaidLabel(expandEntryKeys(entry).join(", "))}\\n${schema.tiers[entry.minTier].name}"]`
      );
      lines.push(`  ${tagNode} -. introduced at .-> tier_${entry.minTier}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function generateStructureGraphJson(schema) {
  const nodes = [
    { id: "schema", type: "schema", label: `PWG Schema ${schema.version}` },
  ];
  const edges = [];

  for (const tier of getTierOrder(schema)) {
    nodes.push({
      id: `tier:${tier}`,
      type: "tier",
      label: schema.tiers[tier].name,
      order: schema.tiers[tier].order,
    });
    edges.push({
      source: "schema",
      target: `tier:${tier}`,
      type: "defines-tier",
    });
  }

  for (const [featureId, feature] of Object.entries(schema.features)) {
    const featureNode = `feature:${featureId}`;
    nodes.push({
      id: featureNode,
      type: "feature",
      label: feature.name,
      elements: getFeatureElements(feature),
      minTier: feature.identifier.minTier,
    });
    edges.push({
      source: "schema",
      target: featureNode,
      type: "defines-feature",
    });
    edges.push({
      source: featureNode,
      target: `tier:${feature.identifier.minTier}`,
      type: "starts-at",
    });

    for (const entry of feature.tags) {
      const tagNode = `tag:${featureId}:${entry.key}`;
      nodes.push({
        id: tagNode,
        type: "tag",
        label: entry.key,
        keys: expandEntryKeys(entry),
        minTier: entry.minTier,
        requirement: entry.requirement,
      });
      edges.push({ source: featureNode, target: tagNode, type: "has-tag" });
      edges.push({
        source: tagNode,
        target: `tier:${entry.minTier}`,
        type: "introduced-at",
      });
    }
  }

  return `${JSON.stringify({ nodes, edges }, null, 2)}\n`;
}

function generateTierRelationshipsMarkdown(schema) {
  const lines = [
    "# PWG Tag Tier Relationships",
    "",
    "Generated from `schema/1.0.1.json` by `scripts/generate-schema-visualizations.js`.",
    "",
    "This view is for dependency-first thinking: each row is a tag requirement, the tier where it enters, the value rule active at that tier, and any dependency or manual-review condition.",
    "",
    "| Feature | Tier | Tag or key set | Requirement | Value rule | Dependency |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of tagRows(schema)) {
    if (row.requirement === "identifier") {
      continue;
    }
    lines.push(
      `| ${markdownEscape(row.featureName)} | ${schema.tiers[row.tier].name} | ${markdownEscape(row.keys.join(", "))} | ${markdownEscape(row.requirement)} | ${markdownEscape(row.valueSpec)} | ${markdownEscape(row.dependency || "")} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

function generateTierRelationshipsMermaid(schema) {
  const lines = ["flowchart LR"];
  const tiers = getTierOrder(schema);
  for (const tier of tiers) {
    lines.push(`  tier_${tier}["${mermaidLabel(schema.tiers[tier].name)}"]`);
  }
  for (let index = 0; index < tiers.length - 1; index += 1) {
    lines.push(`  tier_${tiers[index]} --> tier_${tiers[index + 1]}`);
  }

  for (const [featureId, feature] of Object.entries(schema.features)) {
    const featureNode = idFor("feature", featureId);
    lines.push(`  ${featureNode}["${mermaidLabel(feature.name)}"]`);
    lines.push(`  tier_${feature.identifier.minTier} --> ${featureNode}`);

    for (const entry of feature.tags) {
      const tagNode = idFor("rel", featureId, entry.key);
      lines.push(
        `  ${tagNode}["${mermaidLabel(expandEntryKeys(entry).join(", "))}\\n${mermaidLabel(formatRequirement(entry))}"]`
      );
      lines.push(`  tier_${entry.minTier} --> ${tagNode}`);
      lines.push(`  ${featureNode} --> ${tagNode}`);

      for (const dependencyKey of collectPredicateKeys(entry.appliesWhen)) {
        const dependencyNode = idFor("dep", featureId, dependencyKey);
        lines.push(`  ${dependencyNode}["${mermaidLabel(dependencyKey)}"]`);
        lines.push(`  ${dependencyNode} -. appliesWhen .-> ${tagNode}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function generateTierRelationshipsDot(schema) {
  const lines = [
    "digraph PWGTagTierRelationships {",
    "  rankdir=LR;",
    '  graph [fontname="Arial"];',
    '  node [shape=box, style=rounded, fontname="Arial"];',
    '  edge [fontname="Arial"];',
  ];

  const tiers = getTierOrder(schema);
  for (const tier of tiers) {
    lines.push(
      `  "tier:${tier}" [label="${dotLabel(schema.tiers[tier].name)}", shape=oval];`
    );
  }
  for (let index = 0; index < tiers.length - 1; index += 1) {
    lines.push(
      `  "tier:${tiers[index]}" -> "tier:${tiers[index + 1]}" [label="cumulative"];`
    );
  }

  for (const [featureId, feature] of Object.entries(schema.features)) {
    const featureNode = `feature:${featureId}`;
    lines.push(
      `  "${featureNode}" [label="${dotLabel(feature.name)}", shape=folder];`
    );
    lines.push(
      `  "tier:${feature.identifier.minTier}" -> "${featureNode}" [label="introduces"];`
    );

    for (const entry of feature.tags) {
      const tagNode = `tag:${featureId}:${entry.key}`;
      lines.push(
        `  "${tagNode}" [label="${dotLabel(expandEntryKeys(entry).join(", "))}\n${dotLabel(formatRequirement(entry))}\n${dotLabel(formatSpec(getActiveValueSpec(schema, entry, entry.minTier)))}"];`
      );
      lines.push(`  "${featureNode}" -> "${tagNode}" [label="requires"];`);
      lines.push(`  "tier:${entry.minTier}" -> "${tagNode}" [label="tier"];`);

      for (const dependencyKey of collectPredicateKeys(entry.appliesWhen)) {
        const dependencyNode = `dep:${featureId}:${dependencyKey}`;
        lines.push(
          `  "${dependencyNode}" [label="${dotLabel(dependencyKey)}", shape=note];`
        );
        lines.push(
          `  "${dependencyNode}" -> "${tagNode}" [label="appliesWhen", style=dashed];`
        );
      }
    }
  }

  lines.push("}", "");
  return lines.join("\n");
}

function writeFile(fileName, contents) {
  const filePath = path.resolve(DOCS_DIR, fileName);
  fs.writeFileSync(filePath, contents.replaceAll("\n", "\r\n"), "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), filePath)}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const schema = loadSchema(path.resolve(args.schema || DEFAULT_SCHEMA_PATH));

  writeFile("schema-structure.md", generateStructureMarkdown(schema));
  writeFile("schema-structure.mmd", generateStructureMermaid(schema));
  writeFile("schema-structure.graph.json", generateStructureGraphJson(schema));
  writeFile(
    "schema-tier-relationships.md",
    generateTierRelationshipsMarkdown(schema)
  );
  writeFile(
    "schema-tier-relationships.mmd",
    generateTierRelationshipsMermaid(schema)
  );
  writeFile(
    "schema-tier-relationships.dot",
    generateTierRelationshipsDot(schema)
  );
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
