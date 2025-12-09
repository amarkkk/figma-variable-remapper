# Variable Remapper

A Figma plugin for bulk reassigning variables using find-and-replace on variable paths.

## Use Case

Perfect for scenarios like:
- Duplicating Brand button components to create Neutral variants
- Forking card components with different token mappings
- Any workflow where you need to remap `button/brand/filled/surface/enabled` → `button/neutral/filled/surface/enabled`

## Features

- **Auto-scan on selection**: Automatically scans selected components for bound variables
- **Two-column preview**: See current variables and their remapped targets side-by-side
- **Property grouping**: Variables grouped by type (Colors, Spacing, Corner Radius, Typography)
- **Find & Replace**: Simple string replacement with options:
  - Whole segment matching (only replace complete path segments between `/`)
  - Case sensitivity toggle
- **Validation**: Shows ✓ for found targets, ⚠ for missing targets
- **Nested instance handling**: Flags nested instances that should be edited at source
- **Single undo**: All changes from one "Apply" are undoable as a single action
- **Dark/Light theme**: Toggle with the sun/moon button
- **Resizable window**: Drag the corner to resize

## Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run build` (or `npm run watch` for development)
4. In Figma: Plugins → Development → Import plugin from manifest
5. Select the `manifest.json` file

## Usage

1. Select one or more components in Figma
2. Open the Variable Remapper plugin
3. The plugin scans and displays all bound variables
4. Enter find/replace terms (e.g., find: `brand`, replace: `neutral`)
5. Click "▶ Apply" to preview changes
6. Review the "Remapped To" column for validation
7. Click "Apply X Changes" to commit

## Screenshot

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Variable Remapper                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Find: [brand      ]  Replace: [neutral    ]  [▶ Apply]                       │
│ ☑ Whole segment only  ☑ Case sensitive                                       │
├─────────────────────────────────┬────────────────────────────────────────────┤
│ CURRENT                         │ REMAPPED TO                                │
├─────────────────────────────────┴────────────────────────────────────────────┤
│ ▼ Colors (8)                                                      Select All │
│ ☑ button/brand/surface/enabled  │ button/neutral/surface/enabled ✓          │
│ ☑ button/brand/surface/hover    │ button/neutral/surface/hover ✓            │
│ ☐ button/brand/icon/tint        │ button/neutral/icon/tint ⚠                │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▼ Spacing (3)                                                     Select All │
│ ☑ spacing/button/padding-x      │ (no change)                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ ℹ️ Nested instances (edit at component source)                                │
│ • IconButton → IconButton (3 variables)                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ [☀️] 11 variables selected  ⚠ 1 target not found       [Apply 10 Changes]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Development

```bash
npm install
npm run watch
```

Then import the plugin in Figma via Plugins → Development → Import plugin from manifest.

## How It Works

1. **Scan**: Reads `boundVariables` from all nodes in the selection, recursively
2. **Preview**: Applies find/replace to variable names and checks if targets exist in the same collection
3. **Apply**: Uses `setBoundVariable` and `setBoundVariableForPaint` to reassign variables

## Limitations

- Only works with variables in the same collection (no cross-collection remapping)
- Target variables must already exist (the plugin does not create new variables)
- Nested component instances are flagged but not modified (edit at source)

## License

MIT
