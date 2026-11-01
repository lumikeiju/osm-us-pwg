<!-- @format -->

# Changelog

All notable changes to this `osm-us-pwg` repository are documented here, using the [Keep a Changelog](https://keepachangelog.com/) format, [Semantic Versioning](https://semver.org/), and [Conventional Commits](https://www.conventionalcommits.org/).

Release headings below refer to the **repository version**. Individual components, including the **PWG Schema** and **PWG Guide**, have independent versions and release cycles; their versions are named explicitly in entries that concern them. See [Versioning](README.md#versioning) for the distinction.

## v1.1.0 (2026-10-31)

### Added

- Schema-generated JOSM MapCSS PaintStyle that colors PWG features by their highest automatically satisfied tier.
- JOSM validator checks for typos and conflicts.
- Single-command regeneration of all schema-generated assets, with validation.
- Cross-platform CI coverage on supported Node.js LTS releases.
- Cross-consumer agreement and schema/CLI validation tests.

### Changed

- Made generated length-unit checks case-insensitive to match the schema query helper, and made command-line parsing reject unknown, duplicate, or incomplete options.
- Strengthened schema structure, predicate, tier, and templated-key validation.
- Run the complete discovered Node.js test suite in local documentation and CI instructions.
- Removed generated schema documentation and its generator.
- Clarified independent repository and product versioning, and documented the Schema and Guide latest aliases.

### Fixed

- Made embedded preset icon encoding independent of Windows/Linux checkout line endings.
- Retained every supported length unit, including miles, in the generated PaintStyle.
- Aligned compound predicate and manual-review handling across schema consumers, and made preset labels preserve predicate grouping.
- Rejected missing tier-active value rules and unresolved template placeholders before asset regeneration, while retaining valid nearest-earlier tier-specific rules.
- Rejected malformed semantic-version metadata.

## v1.0.0 (2026-07-20)

### Added

- Machine-readable PWG Schema 1.0.1, including tier definitions, feature identifiers, value specifications, conditional requirements, and consumer guidance.
- Schema query, validation, JOSM preset, documentation, and Ultra visualization generation scripts.
- Machine-readable query examples covering tier evaluation, required-tag gaps, conditional crossing fields, and incline formats.
- Generated schema documentation, structure and tier-relationship diagrams, a JOSM preset, and Ultra tier and Silver-readiness views.

### Changed

- Updated the repository documentation to describe the schema-generated Ultra views and their regeneration workflow.
- Expanded `incline` and `incline:across` values to accept `up`, `down`, signed or unsigned percentages, and degree values.
- Defined Diamond as specialized, regional, or rare tagging for specialized applications requiring on-the-ground survey or specialized tools.
- Changed license to CC-BY-SA 2.0.

### Fixed

- Enforced numeric, length, percent, and incline value formats in generated Ultra tier filters.
- Applied crossing signal-detail requirements only when `crossing:signals` is `yes`, `shared`, or `dedicated`, and exposed those predicates in generated JOSM field labels.
- Rejected unknown tiers and requests below a feature's minimum tier in `tags-for-tier` queries.
- Corrected the Silver-readiness view description to match its silver ready and red not-ready colors.
