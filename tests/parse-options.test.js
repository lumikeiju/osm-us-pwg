/** @format */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { parseOptions } = require("../scripts/parse-options");

const REPO_ROOT = path.resolve(__dirname, "..");

test("rejects unknown, duplicate, missing, and unexpected CLI arguments", () => {
  assert.throws(
    () => parseOptions(["--unknown"], { valueOptions: ["schema"] }),
    /Unknown option: --unknown/
  );
  assert.throws(
    () =>
      parseOptions(["--schema", "--output"], {
        valueOptions: ["schema", "output"],
      }),
    /Option --schema requires a value/
  );
  assert.throws(
    () =>
      parseOptions(["--schema", "schema.json", "--schema", "other.json"], {
        valueOptions: ["schema"],
      }),
    /Option --schema may only be specified once/
  );
  assert.throws(
    () => parseOptions(["unexpected"], { valueOptions: ["schema"] }),
    /Unexpected argument: unexpected/
  );
});

test("every CLI rejects malformed arguments before writing outputs", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pwg-cli-options-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cases = [
    ["generate-josm-preset.js", "preset.xml"],
    ["generate-josm-mapcss.js", "paintstyle.mapcss"],
    ["generate-ultra-visualization.js", "style.ultra"],
  ];

  for (const [script, filename] of cases) {
    const output = path.join(directory, filename);
    for (const [args, message] of [
      [["--unexpected"], /Unknown option: --unexpected/],
      [["--schema"], /Option --schema requires a value/],
      [["--schema", "--mode"], /Option --schema requires a value/],
      [["--output", output], /Option --output may only be specified once/],
      [["unexpected"], /Unexpected argument: unexpected/],
    ]) {
      const result = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, "scripts", script), "--output", output, ...args],
        { cwd: directory, encoding: "utf8" }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 1, `${script}: ${result.stderr}`);
      assert.match(result.stderr, message);
      assert.equal(fs.existsSync(output), false, `${script} wrote an output`);
    }
  }

  for (const [script, command, positionalError] of [
    ["validate-schema.js", [], /Unexpected argument: unexpected/],
    ["query-schema.js", ["tier-of"], /accepts one command/],
  ]) {
    for (const [args, message] of [
      [["--unknown"], /Unknown option: --unknown/],
      [["--schema"], /Option --schema requires a value/],
      [
        ["--schema", "first", "--schema", "second"],
        /may only be specified once/,
      ],
      [["unexpected"], positionalError],
    ]) {
      const result = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, "scripts", script), ...command, ...args],
        { cwd: directory, encoding: "utf8" }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 1, `${script}: ${result.stderr}`);
      assert.match(result.stderr, message);
    }
  }
});

test("query commands and help continue to accept documented arguments", () => {
  for (const [args, check] of [
    [["--help"], (result) => assert.match(result.stdout, /Usage:/)],
    [
      [
        "tier-of",
        "--element",
        "way",
        "--tags",
        "highway=footway,footway=sidewalk",
      ],
      (result) => assert.equal(JSON.parse(result.stdout)[0].tier, "bronze"),
    ],
    [
      ["tags-for-tier", "--feature", "sidewalk", "--tier", "silver"],
      (result) =>
        assert.ok(
          JSON.parse(result.stdout).entries.some(
            (entry) => entry.key === "surface"
          )
        ),
    ],
    [
      [
        "gap-to-tier",
        "--feature",
        "sidewalk",
        "--tier",
        "silver",
        "--tags",
        "highway=footway,footway=sidewalk",
      ],
      (result) => assert.equal(JSON.parse(result.stdout).passes, false),
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "query-schema.js"), ...args],
      { encoding: "utf8" }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    check(result);
  }
});
