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
  ["visualizations", "pwg_schema_tiers_overpass.ultra"],
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
  assert.equal(generatorRuns.length, generators.length + 2);
  assert.ok(generatorRuns.includes("generate-ultra-visualization.js"));
  assert.ok(
    generatorRuns.includes(
      "generate-ultra-visualization.js --provider overpass"
    )
  );
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

test("Overpass defaults to a separate output in both view modes", (t) => {
  const root = createWorkspace(t);
  const script = "generate-ultra-visualization.js";
  for (const [view, args] of [
    ["tiers", []],
    ["silver_readiness", ["--mode", "readiness"]],
  ]) {
    const postpass = runScript(root, script, args);
    assert.equal(postpass.status, 0, postpass.stderr);
    const maps = path.join(root, "visualizations");
    const defaultFile = path.join(maps, `pwg_schema_${view}.ultra`);
    const original = normalizedContents(defaultFile);
    assert.match(original, /\ntype: postpass\n/);

    const overpass = runScript(root, script, [
      ...args,
      "--provider",
      "overpass",
    ]);
    assert.equal(overpass.status, 0, overpass.stderr);
    assert.match(
      normalizedContents(path.join(maps, `pwg_schema_${view}_overpass.ultra`)),
      /\ntype: overpass\n/
    );
    assert.equal(normalizedContents(defaultFile), original);
  }
});

// REUSE-IgnoreStart
test("schema-generated assets begin with their CC BY-SA 2.0 attribution notice", () => {
  for (const file of EXPECTED_OUTPUTS) {
    const header = normalizedContents(path.join(REPO_ROOT, file))
      .split("\n")
      .slice(0, 10)
      .join("\n");
    assert.match(header, /SPDX-License-Identifier: CC-BY-SA-2\.0$/m, file);
    assert.match(
      header,
      /Adapted from PWG Schema v\S+ by the OpenStreetMap US Pedestrian Working Group and OpenStreetMap Wiki contributors/,
      file
    );
    assert.match(
      header,
      /https:\/\/creativecommons\.org\/licenses\/by-sa\/2\.0\//,
      file
    );
  }
});
// REUSE-IgnoreEnd

test("preset icon encoding is independent of checkout line endings", (t) => {
  const root = createWorkspace(t);
  for (const newline of ["\n", "\r\n"]) {
    for (const directory of ["tiers", "presets"]) {
      const icons = path.join(root, "resources", "icons", directory);
      for (const file of fs
        .readdirSync(icons)
        .filter((name) => name.endsWith(".svg"))) {
        const iconPath = path.join(icons, file);
        const source = fs
          .readFileSync(iconPath, "utf8")
          .replaceAll("\r\n", "\n");
        fs.writeFileSync(iconPath, source.replaceAll("\n", newline));
      }
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

test("preset embeds the group and feature icons for each supported schema", (t) => {
  const root = createWorkspace(t);
  const assertIcon = (tag, directory, name) => {
    const icon = tag?.match(
      /\sicon="data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})"/
    );
    assert.ok(icon, `Missing embedded SVG icon for ${name}`);
    assert.equal(
      Buffer.from(icon[1], "base64").toString("utf8"),
      normalizedContents(
        path.join(root, "resources", "icons", directory, `${name}.svg`)
      ),
      `Unexpected SVG icon for ${name}`
    );
  };
  for (const schemaPath of [
    path.join(root, "schema", "1.0.1.json"),
    path.join(root, CURRENT_SCHEMA_RELATIVE_PATH),
  ]) {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const result = runScript(root, "generate-josm-preset.js", [
      "--schema",
      schemaPath,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const preset = normalizedContents(
      path.join(root, "presets", "pwg_schema.xml")
    );
    const header = preset.slice(0, preset.indexOf("<presets "));
    assert.match(
      header,
      /Preset icon support initially contributed by Josh Carlson/
    );
    assert.match(
      header,
      /Tier and preset icons are CC0 1\.0: https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\//
    );
    assert.match(header, /Pedestrian figures adapted from Temaki \(CC0 1\.0\)/);
    assertIcon(preset.match(/<group\s[^>]*>/)?.[0], "tiers", "gold");
    const items = preset.match(/<item\s[^>]*>/g) ?? [];
    const featureIds = Object.keys(schema.features);
    assert.equal(items.length, featureIds.length);
    for (const [index, featureId] of featureIds.entries()) {
      assert.equal(
        items[index].match(/\sname="([^"]+)"/)?.[1],
        `${String(index + 1).padStart(2, "0")}. ${schema.features[featureId].name}`
      );
      assertIcon(items[index], "presets", featureId);
    }
  }
});

test("preset generation reports missing feature icons", (t) => {
  const root = createWorkspace(t);
  const output = path.join(root, "presets", "pwg_schema.xml");
  fs.writeFileSync(output, "previous preset");
  fs.rmSync(path.join(root, "resources", "icons", "presets", "sidewalk.svg"));
  const result = runScript(root, "generate-josm-preset.js");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing SVG icon:.*sidewalk\.svg/);
  assert.equal(normalizedContents(output), "previous preset");
});

test("preset generation rejects path separators in feature icon IDs", (t) => {
  const root = createWorkspace(t);
  const schemaPath = path.join(root, CURRENT_SCHEMA_RELATIVE_PATH);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  schema.features["custom/sidewalk"] = schema.features.sidewalk;
  fs.writeFileSync(schemaPath, JSON.stringify(schema));
  const result = runScript(root, "generate-josm-preset.js");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid SVG icon ID "custom\/sidewalk"/);
  assert.deepEqual(outputFiles(root), []);
});

test("preset handles tiered identifier fields and valued exclusions", (t) => {
  const root = createWorkspace(t);
  const result = runScript(root, "generate-josm-preset.js");
  assert.equal(result.status, 0, result.stderr);
  const preset = normalizedContents(
    path.join(root, "presets", "pwg_schema.xml")
  );
  const sign = preset.match(/<item name="[^"]*Traffic Sign"[\s\S]*?<\/item>/);
  assert.ok(sign, "Missing traffic sign preset");
  assert.equal(
    [...sign[0].matchAll(/<(?:text|combo|check|key)\b[^>]*key="traffic_sign"/g)]
      .length,
    1
  );
  assert.match(sign[0], /<combo key="traffic_sign"/);
  assert.ok(preset.includes("Applies when not (highway=steps)"));
  assert.ok(!preset.includes("Applies when highway is not present"));
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
