<!-- @format -->

# OSM-US-PWG

**(Semi-official)** repository for things related to the [OpenStreetMap US Pedestrian Working Group](https://wiki.openstreetmap.org/wiki/Foundation/Local_Chapters/United_States/Pedestrian_Working_Group).

## Presets

- **[PWG Schema Preset](presets/pwg_schema.xml)** | _(pwg_schema.xml)_ | JOSM tagging preset generated from the machine-readable PWG schema.

Regenerate after schema changes:

```powershell
node scripts/generate-josm-preset.js
```

## Machine-Readable Schema

- **[PWG Schema 1.0.1](schema/1.0.1.json)** | _(1.0.1.json)_ | JSON representation of the PWG tagging schema, including tier semantics, feature identifiers, value specs, conditional rules, and consumer notes.
- **[Schema Documentation](docs/schema-1.0.1.md)** | _(schema-1.0.1.md)_ | Generated feature/tier matrix and consumer guidance.
- **[Example Queries](examples/schema-queries.json)** | _(schema-queries.json)_ | Machine-readable examples for `tierOf`, `tagsForTier`, and `gapToTier`.

Useful commands:

```powershell
node scripts/query-schema.js tier-of --element way --tags highway=footway,footway=sidewalk,surface=concrete,lit=yes,width=1.5
node scripts/query-schema.js tags-for-tier --feature crossing_way --tier diamond
node scripts/query-schema.js gap-to-tier --feature curb --tier diamond --tags barrier=kerb,kerb=raised,tactile_paving=yes
node scripts/validate-schema.js
node scripts/generate-schema-docs.js
node scripts/generate-schema-visualizations.js
node scripts/generate-ultra-visualization.js
node scripts/generate-ultra-visualization.js --mode readiness --targetTier silver
```

Schema visualization artifacts:

- **[Schema Structure Table](docs/schema-structure.md)** | _(schema-structure.md)_ | Feature/tier structure in a table-first format.
- **[Schema Structure Mermaid](docs/schema-structure.mmd)** | _(schema-structure.mmd)_ | Feature, tier, and tag hierarchy as a Mermaid graph.
- **[Schema Structure Graph JSON](docs/schema-structure.graph.json)** | _(schema-structure.graph.json)_ | Node-link graph data for tools and custom visualizers.
- **[Tag Tier Relationship Table](docs/schema-tier-relationships.md)** | _(schema-tier-relationships.md)_ | Tag requirements, value rules, and dependencies by tier.
- **[Tag Tier Relationship Mermaid](docs/schema-tier-relationships.mmd)** | _(schema-tier-relationships.mmd)_ | Tag/tier/dependency relationships as a Mermaid graph.
- **[Tag Tier Relationship DOT](docs/schema-tier-relationships.dot)** | _(schema-tier-relationships.dot)_ | Graphviz representation of tier and tag dependencies.

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

### Guide

- Shortcut: https://wiki.osm.org/PWG_Guide
- Full link: https://wiki.openstreetmap.org/wiki/Foundation/Local_Chapters/United_States/Pedestrian_Working_Group/Guide

### Schema

- Shortcut: https://wiki.osm.org/PWG_Schema
- Full link: https://wiki.openstreetmap.org/wiki/Foundation/Local_Chapters/United_States/Pedestrian_Working_Group/Schema

### Templates

#### PWG Header

- https://wiki.openstreetmap.org/wiki/Template:PWG_Header
- https://wiki.openstreetmap.org/wiki/Template:PWG_Header/doc

#### PWG Template

- https://wiki.openstreetmap.org/wiki/Template:PWG_Releases_Table
- https://wiki.openstreetmap.org/wiki/Template:PWG_Releases_Table/doc
