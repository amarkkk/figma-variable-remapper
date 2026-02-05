# Variable Remapper

> Bulk reassign variables using find-and-replace on token paths.

> **⚠️ Development Status**: This plugin is currently in development and not yet published to the Figma Community. Follow the installation instructions below to use it locally.

> **🔒 Privacy**: This plugin operates entirely locally. No data is sent to external servers (`networkAccess: { allowedDomains: ["none"] }`).

## Use Case

When creating component variants, you often need to swap entire token families. For example, duplicating a "Brand" button to create a "Neutral" variant requires remapping dozens of variables like `button/brand/filled/surface/enabled` -> `button/neutral/filled/surface/enabled`.

Doing this manually in Figma is tedious - you'd need to rebind each variable individually. This plugin lets you find-and-replace across all bound variables in your selection at once.

**Common scenarios:**
- Creating button variants (Brand -> Neutral, Primary -> Secondary)
- Forking card components with different color schemes
- Bulk-updating components after token restructuring
- **Migrating variables between collections** (e.g., moving from a "primitives" collection to a "semantic" collection)

## Features

- **Auto-scan on selection** - Automatically scans selected components for bound variables
- **Two-column preview** - See current variables and their remapped targets side-by-side
- **Property grouping** - Variables grouped by type (fill, stroke, spacing, corner radius, typography)
- **Find & Replace options** - Whole segment matching (only replace complete path segments between `/`) and case sensitivity toggle
- **Cross-collection remapping** - Remap variables to a different collection using the "Target" dropdown
- **Validation indicators** - Shows ✓ for found targets, ⚠ for missing targets, unchanged for no match
- **Orphaned variable detection** - Detects broken variable references and allows remapping to valid variables
- **Node selection** - Click to select and zoom to nodes using a specific variable
- **Undo/Redo with history** - All changes are tracked in a history panel; undo reverts all changes from a single apply
- **Nested instance handling** - Flags nested instances that should be edited at their source component
- **Dark/Light theme** - Toggle with the sun/moon button
- **Resizable window** - Drag the corner to resize

## Installation

1. Clone or download this repository
2. In Figma Desktop: **Plugins -> Development -> Import plugin from manifest**
3. Select the `manifest.json` file from this folder

## Usage

1. Select one or more components in Figma
2. Run the plugin from **Plugins -> Development -> Variable Remapper**
3. The plugin scans and displays all bound variables grouped by property type
4. Enter find/replace terms (e.g., find: `brand`, replace: `neutral`)
5. Toggle options: **Whole segment** (match complete path segments) or **Case sensitive**
6. **(Optional)** Select a target collection from the "Target" dropdown to remap to a different collection
7. Click **Preview** to see what will change
8. Review the "Remapped To" column for validation status
9. Click **Apply** to commit changes
10. Use **Undo/Redo** buttons if needed

### Cross-Collection Remapping

To remap variables from one collection to another:

1. Select your components
2. In the "Target" dropdown, choose the destination collection (instead of "Same collection")
3. Enter your find/replace terms as usual
4. Preview and apply

This is useful when migrating from primitive tokens to semantic tokens, or when restructuring your design system across multiple collections.

## Screenshots

<!-- Add screenshots here -->

## Known Limitations

- Target variables must already exist (the plugin does not create new variables)
- Nested component instances are flagged but not modified - edit at the source component
- Effect variable binding is not yet implemented

## License

MIT

## Author

Created by [Márk Andrássy](https://github.com/amarkkk)

Part of a collection of Figma plugins for design token management.
