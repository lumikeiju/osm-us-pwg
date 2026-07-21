# PWG Tag Tier Relationships

Generated from `schema/1.0.1.json` by `scripts/generate-schema-visualizations.js`.

This view is for dependency-first thinking: each row is a tag requirement, the tier where it enters, the value rule active at that tier, and any dependency or manual-review condition.

| Feature | Tier | Tag or key set | Requirement | Value rule | Dependency |
| --- | --- | --- | --- | --- | --- |
| Sidewalk | Silver | surface | required | examples concrete/asphalt |  |
| Sidewalk | Gold | lit | required | examples yes/no |  |
| Sidewalk | Gold | width | required | length |  |
| Sidewalk | Gold | incline | manual review: for hilly areas | up/down or number%/number° | for hilly areas |
| Sidewalk | Diamond | incline:across | required | up/down or number%/number° |  |
| Sidewalk | Diamond | tactile_paving | required | yes/no |  |
| Sidewalk | Diamond | tactile_paving:colour | conditional | free | requires tactile_paving |
| Crossing (way) | Bronze | crossing:markings | required | yes/no |  |
| Crossing (way) | Bronze | crossing:signals | required | yes/no |  |
| Crossing (way) | Silver | surface | required | examples concrete/asphalt |  |
| Crossing (way) | Silver | crossing:island | required | yes/no |  |
| Crossing (way) | Gold | crossing:signed | required | yes/no |  |
| Crossing (way) | Gold | width | required | length |  |
| Crossing (way) | Gold | button_operated | conditional | yes/no | requires crossing:signals |
| Crossing (way) | Gold | traffic_signals:arrow | conditional | yes/no | requires crossing:signals |
| Crossing (way) | Gold | traffic_signals:vibration | conditional | yes/no | requires crossing:signals |
| Crossing (way) | Gold | traffic_signals:sound | conditional | yes/no | requires crossing:signals |
| Crossing (way) | Diamond | traffic_signals:minimap | conditional | yes/no | requires crossing:signals |
| Crossing (way) | Diamond | crossing:flags | required | yes/no |  |
| Crossing (way) | Diamond | tactile_paving | required | yes/no |  |
| Crossing (way) | Diamond | tactile_paving:colour | conditional | free | requires tactile_paving |
| Crossing (node) | Bronze | crossing:markings | required | yes/no |  |
| Crossing (node) | Bronze | crossing:signals | required | yes/no |  |
| Crossing (node) | Silver | tactile_paving | required | yes/no/partial |  |
| Crossing (node) | Silver | crossing:island | required | yes/no |  |
| Crossing (node) | Gold | crossing:signed | required | yes/no |  |
| Crossing (node) | Gold | button_operated | conditional | yes/no | requires crossing:signals |
| Crossing (node) | Gold | traffic_signals:arrow | conditional | yes/no | requires crossing:signals |
| Crossing (node) | Gold | traffic_signals:vibration | conditional | yes/no | requires crossing:signals |
| Crossing (node) | Gold | traffic_signals:sound | conditional | yes/no | requires crossing:signals |
| Crossing (node) | Diamond | traffic_signals:minimap | conditional | yes/no | requires crossing:signals |
| Crossing (node) | Diamond | crossing:flags | required | yes/no |  |
| Crossing (node) | Diamond | tactile_paving:colour | conditional | free | requires tactile_paving |
| Curb | Silver | kerb | required | raised/lowered/flush/rolled/no |  |
| Curb | Silver | tactile_paving | required | yes/no |  |
| Curb | Gold | kerb:height | conditional | length | requires kerb |
| Curb | Diamond | tactile_paving:colour | conditional | free | requires tactile_paving |
| Traffic Island | Silver | surface | required | examples concrete/asphalt |  |
| Traffic Island | Gold | lit | required | examples yes/no |  |
| Traffic Island | Gold | width | required | length |  |
| Traffic Island | Gold | incline | manual review: for hilly areas | up/down or number%/number° | for hilly areas |
| Traffic Island | Diamond | incline:across | required | up/down or number%/number° |  |
| Traffic Island | Diamond | tactile_paving | required | yes/no |  |
| Traffic Island | Diamond | tactile_paving:colour | conditional | free | requires tactile_paving |
| Access Aisle | Silver | access_aisle:markings | required | examples no/yes/zebra/ladder:skewed |  |
| Access Aisle | Silver | surface | required | examples concrete/asphalt |  |
| Access Aisle | Gold | lit | required | examples yes/no |  |
| Access Aisle | Gold | width | required | length |  |
| Access Aisle | Gold | incline | manual review: for hilly areas | up/down or number%/number° | for hilly areas |
| Access Aisle | Diamond | incline:across | required | up/down or number%/number° |  |
| Access Aisle | Diamond | tactile_paving | required | yes/no |  |
| Access Aisle | Diamond | tactile_paving:colour | conditional | free | requires tactile_paving |
| Roadway | Bronze | sidewalk:left, sidewalk:right, sidewalk:both | required | no/separate | sidewalk:both OR sidewalk:left + sidewalk:right |
| Roadway | Gold | maxspeed | required | free |  |
