#!/usr/bin/env node
/** @format */

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const steps = [
  ["validate-schema.js"],
  ["generate-josm-preset.js"],
  ["generate-josm-mapcss.js"],
  ["generate-ultra-visualization.js"],
  [
    "generate-ultra-visualization.js",
    "--mode",
    "readiness",
    "--targetTier",
    "silver",
  ],
];

function main() {
  if (process.argv.length > 2) {
    console.error("generate-all.js does not accept arguments");
    process.exitCode = 1;
    return;
  }

  for (const [script, ...args] of steps) {
    console.log(`Running ${[script, ...args].join(" ")}`);
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, script), ...args],
      { cwd: path.join(__dirname, ".."), stdio: "inherit" }
    );

    if (result.error) {
      console.error(`Failed to start ${script}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }

    if (result.signal) {
      console.error(`${script} terminated by ${result.signal}`);
      process.exitCode = 1;
      return;
    }

    if (result.status !== 0) {
      console.error(
        `${script} failed with exit code ${result.status ?? "unknown"}`
      );
      process.exitCode = result.status ?? 1;
      return;
    }
  }
}

main();
