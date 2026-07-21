# PWG Schema Structure

Generated from `schema/1.0.1.json` by `scripts/generate-schema-visualizations.js`.

This view is for table-first thinking: features are the primary objects, tiers describe when they enter the schema, and tag rows show how detail accumulates.

| Feature | Elements | Identifier | Starts at | Tags by tier |
| --- | --- | --- | --- | --- |
| Sidewalk | way | highway=footway + footway=sidewalk | Bronze | Silver: surface<br>Gold: lit, width, incline<br>Diamond: incline:across, tactile_paving, tactile_paving:colour |
| Crossing (way) | way | highway=footway + footway=crossing | Bronze | Bronze: crossing:markings, crossing:signals<br>Silver: surface, crossing:island<br>Gold: crossing:signed, width, button_operated, traffic_signals:arrow, traffic_signals:vibration, traffic_signals:sound<br>Diamond: traffic_signals:minimap, crossing:flags, tactile_paving, tactile_paving:colour |
| Crossing (node) | node | highway=crossing + not footway | Bronze | Bronze: crossing:markings, crossing:signals<br>Silver: tactile_paving, crossing:island<br>Gold: crossing:signed, button_operated, traffic_signals:arrow, traffic_signals:vibration, traffic_signals:sound<br>Diamond: traffic_signals:minimap, crossing:flags, tactile_paving:colour |
| Curb | node | barrier=kerb | Silver | Silver: kerb, tactile_paving<br>Gold: kerb:height<br>Diamond: tactile_paving:colour |
| Traffic Island | way | highway=footway + footway=traffic_island | Silver | Silver: surface<br>Gold: lit, width, incline<br>Diamond: incline:across, tactile_paving, tactile_paving:colour |
| Access Aisle | way | highway=footway + footway=access_aisle | Silver | Silver: access_aisle:markings, surface<br>Gold: lit, width, incline<br>Diamond: incline:across, tactile_paving, tactile_paving:colour |
| Footway Area | way, relation | area:highway=footway | Gold | identifier only |
| Roadway | way | highway=* + not footway | Bronze | Bronze: sidewalk:left, sidewalk:right, sidewalk:both<br>Gold: maxspeed |

## Tier Summary

| Tier | Features introduced | Tags introduced |
| --- | --- | --- |
| Bronze | 4 | 5 |
| Silver | 3 | 10 |
| Gold | 1 | 22 |
| Diamond | 0 | 17 |
