# PWG Machine-Readable Schema 1.0.1

This document is generated from `schema/1.0.1.json` by `scripts/generate-schema-docs.js`. It summarizes the schema contract used by query examples, the JOSM preset generator, and Ultra tier styling.

## Tier Contract

| Tier | Use cases | Required resources |
| --- | --- | --- |
| Bronze | Basic everyday pedestrian navigation | (Older) Low-quality aerial imagery |
| Silver | Accessibility-focused applications | (Somewhat recent) Medium-quality aerial imagery and/or low-quality street-level imagery |
| Gold | Advanced routers and visualizations | (Recent) High-quality aerial and/or street-level imagery or in-person survey |
| Diamond | Specialized applications | On-the-ground survey, or specialized tools |

## Feature Matrix

| Feature | Elements | Identifier | Min tier | Bronze | Silver | Gold | Diamond |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sidewalk | way | highway=footway + footway=sidewalk | bronze | identifier: highway=footway + footway=sidewalk | surface (required; examples concrete/asphalt) | lit (required; examples yes/no)<br>width (required; length)<br>incline (manual review: for hilly areas; up/down or number%/number°) | incline:across (required; up/down or number%/number°)<br>tactile_paving (required; yes/no)<br>tactile_paving:colour (conditional; free) |
| Crossing (way) | way | highway=footway + footway=crossing | bronze | identifier: highway=footway + footway=crossing<br>crossing:markings (required; yes/no)<br>crossing:signals (required; yes/no) | surface (required; examples concrete/asphalt)<br>crossing:island (required; yes/no) | crossing:signed (required; yes/no)<br>width (required; length)<br>button_operated (conditional; yes/no)<br>traffic_signals:arrow (conditional; yes/no)<br>traffic_signals:vibration (conditional; yes/no)<br>traffic_signals:sound (conditional; yes/no) | traffic_signals:minimap (conditional; yes/no)<br>crossing:flags (required; yes/no)<br>tactile_paving (required; yes/no)<br>tactile_paving:colour (conditional; free) |
| Crossing (node) | node | highway=crossing + not footway | bronze | identifier: highway=crossing + not footway<br>crossing:markings (required; yes/no)<br>crossing:signals (required; yes/no) | tactile_paving (required; yes/no/partial)<br>crossing:island (required; yes/no) | crossing:signed (required; yes/no)<br>button_operated (conditional; yes/no)<br>traffic_signals:arrow (conditional; yes/no)<br>traffic_signals:vibration (conditional; yes/no)<br>traffic_signals:sound (conditional; yes/no) | traffic_signals:minimap (conditional; yes/no)<br>crossing:flags (required; yes/no)<br>tactile_paving:colour (conditional; free) |
| Curb | node | barrier=kerb | silver |  | identifier: barrier=kerb<br>kerb (required; raised/lowered/flush/rolled/no)<br>tactile_paving (required; yes/no) | kerb:height (conditional; length) | tactile_paving:colour (conditional; free) |
| Traffic Island | way | highway=footway + footway=traffic_island | silver |  | identifier: highway=footway + footway=traffic_island<br>surface (required; examples concrete/asphalt) | lit (required; examples yes/no)<br>width (required; length)<br>incline (manual review: for hilly areas; up/down or number%/number°) | incline:across (required; up/down or number%/number°)<br>tactile_paving (required; yes/no)<br>tactile_paving:colour (conditional; free) |
| Access Aisle | way | highway=footway + footway=access_aisle | silver |  | identifier: highway=footway + footway=access_aisle<br>access_aisle:markings (required; examples no/yes/zebra/ladder:skewed)<br>surface (required; examples concrete/asphalt) | lit (required; examples yes/no)<br>width (required; length)<br>incline (manual review: for hilly areas; up/down or number%/number°) | incline:across (required; up/down or number%/number°)<br>tactile_paving (required; yes/no)<br>tactile_paving:colour (conditional; free) |
| Footway Area | way, relation | area:highway=footway | gold |  |  | identifier: area:highway=footway |  |
| Roadway | way | highway=* + not footway | bronze | identifier: highway=* + not footway<br>sidewalk:left, sidewalk:right, sidewalk:both (required; no/separate; oneOf: sidewalk:both OR sidewalk:left + sidewalk:right) |  | maxspeed (required; free) |  |

## Example Query Commands

```powershell
node scripts/query-schema.js tier-of --element way --tags highway=footway,footway=sidewalk,surface=concrete,lit=yes,width=1.5
node scripts/query-schema.js tags-for-tier --feature crossing_way --tier diamond
node scripts/query-schema.js gap-to-tier --feature curb --tier diamond --tags barrier=kerb,kerb=raised,tactile_paving=yes
node scripts/validate-schema.js
node scripts/generate-josm-preset.js
node scripts/generate-ultra-visualization.js
node scripts/generate-ultra-visualization.js --mode readiness --targetTier silver
node scripts/generate-schema-visualizations.js
```

Machine-readable examples live in `examples/schema-queries.json`.

## Consumer Notes

JOSM preset generation uses one item per feature, `elements` for item type, identifier tags as fixed keys where possible, and one field per expanded schema key. Conditional fields are surfaced in labels because JOSM presets cannot enforce every PWG precondition.

Ultra tier coloring should evaluate tiers from Diamond down to Bronze. Required tags block tier coloring. `appliesWhen` conditionals block only when their precondition is true. Free-text `condition` entries are manual-review checks and should not block automated coloring.

Schema-driven example visualizations live in `visualizations/pwg_schema_tiers.ultra` and `visualizations/pwg_schema_silver_readiness.ultra`. Both are generated from the same schema JSON and can be copied directly into Ultra.

Schema-structure visualizations are generated in two families: `docs/schema-structure.*` for feature/tier hierarchy, and `docs/schema-tier-relationships.*` for tag dependencies and tier progression. Each family is emitted in Markdown, Mermaid, and graph/data formats for different ways of thinking about the schema.

Roadway sidewalk tagging uses `keySet.mode = oneOf`: `sidewalk:both` is sufficient, or both `sidewalk:left` and `sidewalk:right` must be present. The preset can expose all three fields, but quality evaluation should use the key-set rule.
