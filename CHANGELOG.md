# Changelog

All notable changes to the Variable Remapper plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2025-02-05

### Added
- **Cross-collection remapping**: New "Target" dropdown in the options row allows remapping variables to a different collection. Previously, remapping was limited to variables within the same collection.
- Documentation section in README explaining cross-collection remapping workflow

### Fixed
- **Tooltip visibility**: Tooltips on error/success icons and count badges were being clipped by container overflow. Implemented a global tooltip system using `position: fixed` with JavaScript positioning to ensure tooltips are always visible regardless of scroll position or container boundaries.

### Changed
- Updated README to reflect new cross-collection capability
- Removed "same collection only" from known limitations

## [1.0.0] - Initial Release

### Features
- Auto-scan on selection - Automatically scans selected components for bound variables
- Two-column preview - See current variables and their remapped targets side-by-side
- Property grouping - Variables grouped by type (fill, stroke, spacing, corner radius, typography)
- Find & Replace options - Whole segment matching and case sensitivity toggle
- Validation indicators - Shows ✓ for found targets, ⚠ for missing targets
- Orphaned variable detection - Detects broken variable references and allows remapping
- Node selection - Click to select and zoom to nodes using a specific variable
- Undo/Redo with history - All changes tracked in a history panel
- Nested instance handling - Flags nested instances that should be edited at source
- Dark/Light theme toggle
- Resizable window
