<!-- @format -->

# OSM-US-PWG

**(Semi-official)** repository for things related to the [OpenStreetMap US Pedestrian Working Group](https://wiki.openstreetmap.org/wiki/Foundation/Local_Chapters/United_States/Pedestrian_Working_Group).

## Versioning

This repository's release version, recorded in the [changelog](CHANGELOG.md), is independent of the versions of its subproducts, including the **PWG Schema** and **PWG Guide**. Each product advances on its own release cycle. For example, repository v1.1.0 does not imply PWG Schema v1.1.0 or PWG Guide v1.1.0.

## Requirements

Node.js 22 or newer is required. The repository has no npm dependencies; run the built-in test suite with `node --test`.

## Presets

- **[PWG Schema Preset](presets/pwg_schema.xml)** | _(pwg_schema.xml)_ | JOSM tagging preset generated from the machine-readable PWG schema.
- **[PWG Schema PaintStyle](styles/pwg_schema.mapcss)** | _(pwg_schema.mapcss)_ | JOSM MapCSS PaintStyle generated from the machine-readable PWG schema; colors features by their highest automatically satisfied tier.

## Regenerating assets

From the repository root, regenerate the preset, PaintStyle, and both schema-derived Ultra views:

```powershell
node scripts\generate-all.js
```

The command validates the schema and example queries first, then stops at the first error. If a later generator fails, earlier assets may already have been updated. When adding a generator or checked-in output, update the [generator list](scripts/generate-all.js) and its [test](tests/generate-all.test.js).

The test suite checks reproducible regeneration in temporary workspaces, command-line failures, schema structure, and shared tier/readiness fixtures across the query helper and generated visualization rules. Free-text real-world conditions remain manual-review items, even when accompanied by a tag predicate.

An existing limitation remains in Ultra's conversion-based numeric checks: uncommon formats such as `width=1e3 m` can receive different tier results than the query helper's stricter length rules. Shared-fixture coverage does not imply complete equivalence for every possible tag value.

To check regeneration without modifying tracked assets:

```powershell
node --test
```

## Validators

- **[PWG Tagging Checks](validators/pwg-tagging.validator.mapcss)** | _(pwg-tagging.validator.mapcss)_ | JOSM validator rules for PWG sidewalk conflicts and typos, pedestrian-signal detail tags on unsignalized crossings, and tactile-paving color dependencies.

## Machine-Readable Schema

- **[PWG Schema 1.0.1](schema/1.0.1.json)** | _(1.0.1.json)_ | JSON representation of the PWG tagging schema, including tier semantics, feature identifiers, value specs, conditional rules, and consumer notes.
- **[Example Queries](examples/schema-queries.json)** | _(schema-queries.json)_ | Machine-readable examples for `tierOf`, `tagsForTier`, and `gapToTier`.

The default current schema is selected by `CURRENT_SCHEMA_VERSION` in [pwg-schema.js](scripts/pwg-schema.js); versioned schema snapshots are retained. This setting selects the machine-readable PWG Schema version, not the repository version; the generators do not read the `.mw` latest aliases.

Useful commands:

```powershell
node scripts/query-schema.js tier-of --element way --tags highway=footway,footway=sidewalk,surface=concrete,lit=yes,width=1.5
node scripts/query-schema.js tags-for-tier --feature crossing_way --tier diamond
node scripts/query-schema.js gap-to-tier --feature curb --tier diamond --tags barrier=kerb,kerb=raised,tactile_paving=yes
node scripts/validate-schema.js
node scripts/generate-josm-preset.js
node scripts/generate-josm-mapcss.js
node scripts/generate-ultra-visualization.js
node scripts/generate-ultra-visualization.js --mode readiness --targetTier silver
```

## Visualizations

Style documents for use on [Ultra](https://overpass-ultra.us/).

**How to use:** Replace the query on Ultra with the contents of the file. Navigate on the map to the desired area and hit "Run" at the top left.

Refer to the [MapLibre Style Spec documentation](https://maplibre.org/maplibre-style-spec/) for more details on customizing the visualization.

- **[Curb Type](visualizations/curb_type.yaml)** | _(curb_type.yaml)_ | Visualization of `kerb=raised|lowered|flush|no` values on nodes

- **[Sidewalk Tags on Roadways](visualizations/roadway_sidewalk_tagging.yaml)** | _(roadway_sidewalk_tagging.yaml)_ | Visualization of `sidewalk*=*` tags on roadways

- **[Tactile Paving](visualizations/tactile_paving.yaml)** | _(tactile_paving.yaml)_ | Visualization of `tactile_paving=yes|no` values on nodes

- **[PWG Schema Tier View](visualizations/pwg_schema_tiers.ultra)** | _(pwg_schema_tiers.ultra)_ | Schema-generated visualization of PWG feature tiers for Ultra.

- **[PWG Schema Silver Readiness View](visualizations/pwg_schema_silver_readiness.ultra)** | _(pwg_schema_silver_readiness.ultra)_ | Schema-generated visualization showing whether mapped PWG features meet Silver-tier requirements.

## Archive

Archive with copies of PWG-related documents.

Version-numbered files are snapshots of the named product release, not the repository release. The unversioned `.mw` files below are aliases for each product's **latest** release: update the corresponding alias when releasing that product, while retaining its versioned snapshots.

### Guide

- Latest alias: [guide.mw](guide/guide.mw)
- Shortcut: https://wiki.osm.org/PWG_Guide
- Full link: https://wiki.openstreetmap.org/wiki/Foundation/Local_Chapters/United_States/Pedestrian_Working_Group/Guide

### Schema

- Latest alias: [schema.mw](schema/schema.mw)
- Shortcut: https://wiki.osm.org/PWG_Schema
- Full link: https://wiki.openstreetmap.org/wiki/Foundation/Local_Chapters/United_States/Pedestrian_Working_Group/Schema

### Templates

#### PWG Header

- https://wiki.openstreetmap.org/wiki/Template:PWG_Header
- https://wiki.openstreetmap.org/wiki/Template:PWG_Header/doc

#### PWG Template

- https://wiki.openstreetmap.org/wiki/Template:PWG_Releases_Table
- https://wiki.openstreetmap.org/wiki/Template:PWG_Releases_Table/doc
