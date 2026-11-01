#!/usr/bin/env node
/** @format */

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SCHEMA_PATH,
  expandEntryKeys,
  formatPredicate,
  getActiveValueSpec,
  getFeatureElements,
  loadSchema,
} = require("./pwg-schema");
const { parseOptions } = require("./parse-options");

const DEFAULT_OUTPUT_PATH = path.resolve(
  __dirname,
  "..",
  "presets",
  "pwg_schema.xml"
);
const TIER_ICON_DIRECTORY = path.resolve(
  __dirname,
  "..",
  "resources",
  "icons",
  "tiers"
);
const tierIconDataUris = new Map();

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function humanizeKey(key) {
  return key
    .replaceAll(":", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function conditionalNote(entry) {
  const notes = [];
  if (entry.appliesWhen) {
    notes.push(`when ${formatPredicate(entry.appliesWhen)}`);
  }
  if (entry.condition) {
    notes.push(entry.condition);
  }
  return notes.length ? `Conditional fields — ${notes.join("; ")}` : "";
}

function fieldXmlForKey(schema, key, entry) {
  const spec = getActiveValueSpec(schema, entry, entry.minTier) ?? {
    type: "free",
  };
  // Tier and conditional context is rendered as a separate label. Keeping
  // the control labels short gives the value inputs substantially more room.
  const text = humanizeKey(key);

  if (["enum", "openEnum"].includes(spec.type) && spec.values?.length) {
    // Later tiers can use a different value specification for the same key.
    // Keep the suggestions valid at the field's displayed tier while allowing
    // a mapper to enter a valid higher-tier value.
    const editable =
      spec.type === "openEnum" || entry.valueSpecByTier ? "true" : "false";
    return `      <combo key="${escapeXml(key)}" text="${escapeXml(text)}" values="${escapeXml(spec.values.join(","))}" editable="${editable}" />`;
  }

  if (spec.type === "boolean") {
    return `      <check key="${escapeXml(key)}" text="${escapeXml(text)}" value_on="yes" value_off="no" />`;
  }

  return `      <text key="${escapeXml(key)}" text="${escapeXml(text)}" />`;
}

function keySetDescription(entry) {
  return entry.keySet.description.replace(
    /\s*The preset may expose all three keys because existing OSM data uses each form\.\s*/,
    ""
  );
}

function keySetAlternativeLabel(keys) {
  if (
    keys.length === 2 &&
    keys.every((key) => ["sidewalk:left", "sidewalk:right"].includes(key))
  ) {
    return "Or map each side separately:";
  }

  return `Or use ${keys.join(" and ")}:`;
}

function entryFieldsXml(schema, entry) {
  const keys = expandEntryKeys(entry);
  if (entry.keySet?.mode !== "oneOf") {
    return keys.map((key) => fieldXmlForKey(schema, key, entry));
  }

  const lines = [];
  const emittedKeys = new Set();
  for (const [index, keySet] of entry.keySet.sets.entries()) {
    if (index > 0) {
      lines.push("      <space />");
      lines.push(
        `      <label text="${escapeXml(keySetAlternativeLabel(keySet))}" />`
      );
    }
    for (const key of keySet) {
      lines.push(fieldXmlForKey(schema, key, entry));
      emittedKeys.add(key);
    }
  }

  for (const key of keys) {
    if (!emittedKeys.has(key)) {
      lines.push(fieldXmlForKey(schema, key, entry));
    }
  }

  return lines;
}

function identifierApplicabilityText(feature, clause) {
  if (feature.name === "Roadway" && clause.key === "footway") {
    return "Applies to roads typically expected to have sidewalks.";
  }

  return `Applies when ${clause.key} is not present`;
}

function identifierXml(feature) {
  const lines = [];
  for (const clause of feature.identifier.allOf ?? []) {
    if (!clause.key) {
      continue;
    }

    if (clause.value !== undefined) {
      lines.push(
        `      <key key="${escapeXml(clause.key)}" value="${escapeXml(clause.value)}" />`
      );
    } else {
      lines.push(
        `      <text key="${escapeXml(clause.key)}" text="${escapeXml(humanizeKey(clause.key))}" />`
      );
    }
  }

  for (const clause of feature.identifier.noneOf ?? []) {
    if (clause.key) {
      lines.push(
        `      <label text="${escapeXml(identifierApplicabilityText(feature, clause))}" />`
      );
    }
  }

  return lines;
}

function josmTypeForFeature(feature) {
  if (feature.josmTypes?.length) {
    return feature.josmTypes.join(",");
  }

  return getFeatureElements(feature)
    .map((element) => {
      if (element === "way") {
        return "way";
      }
      return element;
    })
    .join(",");
}

function tierIconDataUri(tier) {
  if (!tierIconDataUris.has(tier)) {
    const iconPath = path.join(TIER_ICON_DIRECTORY, `${tier}.svg`);
    const source = fs.readFileSync(iconPath, "utf8").replaceAll("\r\n", "\n");
    const icon = Buffer.from(source, "utf8").toString("base64");
    tierIconDataUris.set(tier, `data:image/svg+xml;base64,${icon}`);
  }

  return tierIconDataUris.get(tier);
}

function tierSectionXml(schema, tier) {
  const tierDefinition = schema.tiers[tier];
  const heading = `${tierDefinition.name} tier — ${tierDefinition.shortDescription}`;
  const icon = tierIconDataUri(tier);

  return [
    "      <space />",
    "      <item_separator />",
    `      <label text="${escapeXml(heading)}" icon="${escapeXml(icon)}" icon_size="20" />`,
    "      <space />",
  ];
}

function generatePreset(schema) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<presets xmlns="http://josm.openstreetmap.de/tagging-preset-1.0">',
    `  <!-- Generated from ${escapeXml(schema.sourceDocument)} and schema/${escapeXml(schema.version)}.json by scripts/generate-josm-preset.js. -->`,
    `  <group name="PWG Schema v${escapeXml(schema.version)}">`,
  ];

  let itemNumber = 1;
  for (const [featureId, feature] of Object.entries(schema.features)) {
    lines.push(
      `    <item name="${String(itemNumber).padStart(2, "0")}. ${escapeXml(feature.name)}" type="${escapeXml(josmTypeForFeature(feature))}">`
    );
    lines.push(
      `      <label text="${escapeXml(`${feature.name} (${feature.identifier.minTier}+)`)}" />`
    );
    lines.push(...identifierXml(feature));

    const entriesByTier = new Map();
    for (const entry of feature.tags) {
      if (!entriesByTier.has(entry.minTier)) {
        entriesByTier.set(entry.minTier, []);
      }
      entriesByTier.get(entry.minTier).push(entry);
    }

    for (const tier of schema.$usage.tierOrder) {
      const entries = entriesByTier.get(tier) ?? [];
      if (entries.length === 0) {
        continue;
      }

      lines.push(...tierSectionXml(schema, tier));
      let previousConditionalNote = "";
      for (const entry of entries) {
        if (entry.keySet?.description) {
          lines.push(
            `      <label text="${escapeXml(keySetDescription(entry))}" />`
          );
        }
        const note = conditionalNote(entry);
        if (note && note !== previousConditionalNote) {
          lines.push(`      <label text="${escapeXml(note)}" />`);
        }
        lines.push(...entryFieldsXml(schema, entry));
        previousConditionalNote = note;
      }
    }

    lines.push("    </item>");
    itemNumber += 1;
  }

  lines.push("  </group>", "</presets>", "");
  return lines.join("\n");
}

function main() {
  const args = parseOptions(process.argv.slice(2), {
    valueOptions: ["schema", "output"],
  });
  const schemaPath = path.resolve(args.schema || DEFAULT_SCHEMA_PATH);
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT_PATH);
  const schema = loadSchema(schemaPath);
  fs.writeFileSync(
    outputPath,
    generatePreset(schema).replaceAll("\n", "\r\n"),
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
