#!/usr/bin/env node
/** @format */

const {
  DEFAULT_SCHEMA_PATH,
  gapToTier,
  loadSchema,
  parseTagString,
  tagsForTier,
  tierOf,
} = require("./pwg-schema");
const { parseOptions } = require("./parse-options");

function printUsage() {
  console.log(`Usage:
  node scripts/query-schema.js tier-of --element way --tags highway=footway,footway=sidewalk,surface=concrete
  node scripts/query-schema.js tags-for-tier --feature sidewalk --tier gold
  node scripts/query-schema.js gap-to-tier --feature curb --tier diamond --tags barrier=kerb,kerb=raised,tactile_paving=yes

Options:
  --schema <path>    Schema JSON path. Defaults to ${DEFAULT_SCHEMA_PATH}
  --tags <tags>      JSON object or comma-separated key=value pairs.
`);
}

function main() {
  const args = parseOptions(process.argv.slice(2), {
    valueOptions: ["schema", "tags", "element", "feature", "tier"],
    booleanOptions: ["help"],
    allowPositionals: true,
  });
  if (args._.length > 1) {
    throw new Error("query-schema accepts one command");
  }
  const command = args._[0];

  if (!command || args.help) {
    printUsage();
    return;
  }

  const schema = loadSchema(args.schema || DEFAULT_SCHEMA_PATH);
  const tags = parseTagString(args.tags);
  let result;

  if (command === "tier-of") {
    result = tierOf(schema, args.element, tags);
  } else if (command === "tags-for-tier") {
    if (!args.feature || !args.tier) {
      throw new Error("tags-for-tier requires --feature and --tier");
    }
    result = tagsForTier(schema, args.feature, args.tier);
  } else if (command === "gap-to-tier") {
    if (!args.feature || !args.tier) {
      throw new Error("gap-to-tier requires --feature and --tier");
    }
    result = gapToTier(schema, args.feature, args.tier, tags);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
