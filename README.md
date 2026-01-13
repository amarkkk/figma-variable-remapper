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

## Screenshots
<img width="837" height="615" alt="image" src="https://github.com/user-attachments/assets/3dcd636a-4eec-4686-827e-265e8f8ffef5" />
<img width="830" height="615" alt="image" src="https://github.com/user-attachments/assets/0a753e48-4804-454a-8408-e58bd40a144c" />
<img width="837" height="615" alt="image" src="https://github.com/user-attachments/assets/b090f6d6-0d6f-4de7-838a-bd6a4a6fd71c" />
<img width="837" height="615" alt="image" src="https://github.com/user-attachments/assets/41d53191-3a5a-4a56-ae6f-add3e581a8d4" />

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
