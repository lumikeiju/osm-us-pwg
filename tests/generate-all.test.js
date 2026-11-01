/** @format */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..");
const { DEFAULT_SCHEMA_PATH } = require("../scripts/pwg-schema");
const CURRENT_SCHEMA_RELATIVE_PATH = path.relative(
  REPO_ROOT,
  DEFAULT_SCHEMA_PATH
);
const OUTPUT_DIRECTORIES = ["presets", "styles", "visualizations"];
const EXPECTED_OUTPUTS = [
  ["presets", "pwg_schema.xml"],
  ["styles", "pwg_schema.mapcss"],
  ["visualizations", "pwg_schema_tiers.ultra"],
  ["visualizations", "pwg_schema_silver_readiness.ultra"],
]
  .map((parts) => path.join(...parts))
  .sort();

function createWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "osm-us-pwg-generate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const directory of ["scripts", "schema", "resources", "examples"]) {
    fs.cpSync(path.join(REPO_ROOT, directory), path.join(root, directory), {
      recursive: true,
    });
  }
  for (const directory of OUTPUT_DIRECTORIES) {
    fs.mkdirSync(path.join(root, directory));
  }
  return root;
}

function runScript(root, script, args = []) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", script), ...args],
    { cwd: os.tmpdir(), encoding: "utf8" }
  );
  assert.ifError(result.error);
  return result;
}

function runGenerator(root, args = []) {
  return runScript(root, "generate-all.js", args);
}

function outputFiles(root) {
  return OUTPUT_DIRECTORIES.flatMap((directory) =>
    fs
      .readdirSync(path.join(root, directory))
      .map((file) => path.join(directory, file))
  ).sort();
}

function normalizedContents(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

test("generates every checked-in asset without recreating schema documentation", (t) => {
  const root = createWorkspace(t);
  const result = runGenerator(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(outputFiles(root), EXPECTED_OUTPUTS);
  assert.equal(fs.existsSync(path.join(root, "docs")), false);

  const generatorRuns = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Running generate-"))
    .map((line) => line.slice("Running ".length));
  const generators = fs
    .readdirSync(path.join(REPO_ROOT, "scripts"))
    .filter(
      (file) =>
        file.startsWith("generate-") &&
        file.endsWith(".js") &&
        file !== "generate-all.js"
    )
    .sort();
  assert.deepEqual(
    [...new Set(generatorRuns.map((line) => line.split(" ")[0]))].sort(),
    generators
  );
  assert.equal(generatorRuns.length, generators.length + 1);
  assert.ok(generatorRuns.includes("generate-ultra-visualization.js"));
  assert.ok(
    generatorRuns.includes(
      "generate-ultra-visualization.js --mode readiness --targetTier silver"
    )
  );

  const firstRun = new Map();
  for (const file of EXPECTED_OUTPUTS) {
    const generated = path.join(root, file);
    assert.equal(
      normalizedContents(generated),
      normalizedContents(path.join(REPO_ROOT, file)),
      `${file} differs from the checked-in asset`
    );
    firstRun.set(file, fs.readFileSync(generated));
  }
  const secondRun = runGenerator(root);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  for (const file of EXPECTED_OUTPUTS) {
    assert.ok(
      fs.readFileSync(path.join(root, file)).equals(firstRun.get(file)),
      `${file} changed when regenerated a second time`
    );
  }
});

test("preset icon encoding is independent of checkout line endings", (t) => {
  const root = createWorkspace(t);
  const icons = path.join(root, "resources", "icons", "tiers");
  for (const newline of ["\n", "\r\n"]) {
    for (const tier of ["bronze", "silver", "gold", "diamond"]) {
      const iconPath = path.join(icons, `${tier}.svg`);
      const source = fs.readFileSync(iconPath, "utf8").replaceAll("\r\n", "\n");
      fs.writeFileSync(iconPath, source.replaceAll("\n", newline));
    }
    const result = runScript(root, "generate-josm-preset.js");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      normalizedContents(path.join(root, "presets", "pwg_schema.xml")),
      normalizedContents(path.join(REPO_ROOT, "presets", "pwg_schema.xml")),
      `Preset differs with ${JSON.stringify(newline)} SVG newlines`
    );
  }
});

test("stops before generating anything when validation fails", (t) => {
  const root = createWorkspace(t);
  fs.writeFileSync(
    path.join(root, "examples", "schema-queries.json"),
    JSON.stringify({
      examples: [{ name: "invalid example", query: "unknown" }],
    })
  );
  const result = runGenerator(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid example: unknown query unknown/);
  assert.match(result.stderr, /validate-schema\.js failed with exit code 1/);
  assert.deepEqual(outputFiles(root), []);
});

test("propagates generator failures and skips subsequent steps", (t) => {
  const root = createWorkspace(t);
  fs.writeFileSync(
    path.join(root, "scripts", "generate-josm-mapcss.js"),
    'console.error("intentional test failure"); process.exitCode = 23;\n'
  );
  const result = runGenerator(root);
  assert.equal(result.status, 23);
  assert.match(result.stderr, /intentional test failure/);
  assert.match(
    result.stderr,
    /generate-josm-mapcss\.js failed with exit code 23/
  );
  assert.ok(!result.stdout.includes("Running generate-ultra-visualization.js"));
  assert.deepEqual(outputFiles(root), [path.join("presets", "pwg_schema.xml")]);
});

test("rejects unsupported arguments before generating anything", (t) => {
  const root = createWorkspace(t);
  const result = runGenerator(root, ["--unsupported"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not accept arguments/);
  assert.deepEqual(outputFiles(root), []);
});

test("preset labels preserve nested conditional grouping and manual-review notes", (t) => {
  const root = createWorkspace(t);
  const schemaPath = path.join(root, CURRENT_SCHEMA_RELATIVE_PATH);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const entry = schema.features.sidewalk.tags.find(
    (tag) => tag.key === "tactile_paving:colour"
  );
  entry.appliesWhen = {
    allOf: [
      { key: "tactile_paving", value: "yes" },
      {
        oneOf: [
          { key: "access", value: "yes" },
          { noneOf: [{ key: "access", value: "no" }] },
        ],
      },
    ],
    oneOf: [
      { key: "surface", value: "asphalt" },
      { key: "surface", value: "concrete" },
    ],
    noneOf: [{ key: "hazard", oneOf: ["barrier", "stairs"] }],
  };
  entry.condition = "verify on site";
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  const result = runScript(root, "generate-josm-preset.js");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    normalizedContents(path.join(root, "presets", "pwg_schema.xml")).includes(
      "when tactile_paving=yes and (access=yes or not (access=no)) and (surface=asphalt or surface=concrete) and not (hazard is one of barrier, stairs); verify on site"
    )
  );
});

test("fails schema preflight before generating any assets on missing value rules", (t) => {
  const root = createWorkspace(t);
  const schemaPath = path.join(root, CURRENT_SCHEMA_RELATIVE_PATH);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  delete schema.features.sidewalk.tags[0].valueSpec;
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  const result = runGenerator(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /activeAt\.silver: missing valueSpec/);
  assert.deepEqual(outputFiles(root), []);
});
