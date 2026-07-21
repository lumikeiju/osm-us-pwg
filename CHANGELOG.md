<!-- @format -->

# Changelog

All notable changes to this `osm-us-pwg` repository are documented here, using the [Keep a Changelog](https://keepachangelog.com/) format, [Semantic Versioning](https://semver.org/), and [Conventional Commits](https://www.conventionalcommits.org/).

<!--
## [Unreleased]

### Added

### Changed

### Fixed
-->

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
