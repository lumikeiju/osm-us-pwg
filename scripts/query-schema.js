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

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    if (args[key] !== undefined) {
      args[key] = Array.isArray(args[key])
        ? [...args[key], next]
        : [args[key], next];
    } else {
      args[key] = next;
    }
    index += 1;
  }
  return args;
}

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
  const args = parseArgs(process.argv.slice(2));
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
