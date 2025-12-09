// Figma Plugin: Variable Remapper
// Bulk reassign variables using find-and-replace on variable paths

// ============================================================================
// Types
// ============================================================================

interface BoundVariableInfo {
  nodeId: string;
  nodeName: string;
  propertyType: PropertyType;
  propertyKey: string;
  variableId: string;
  variableName: string;
  collectionId: string;
  collectionName: string;
  isNestedInstance: boolean;
  instancePath?: string; // e.g., "IconButton > Icon"
}

type PropertyType = 'color' | 'spacing' | 'cornerRadius' | 'typography' | 'other';

interface ScanResult {
  bindings: BoundVariableInfo[];
  nestedInstances: NestedInstanceInfo[];
}

interface NestedInstanceInfo {
  nodeId: string;
  nodeName: string;
  mainComponentName: string;
  boundVariableCount: number;
}

interface RemapPreview {
  binding: BoundVariableInfo;
  newVariableName: string | null; // null if target not found
  newVariableId: string | null;
  status: 'found' | 'not_found' | 'unchanged';
}

interface RemapRequest {
  nodeId: string;
  propertyKey: string;
  propertyType: PropertyType;
  oldVariableId: string;
  newVariableId: string;
}

// ============================================================================
// Plugin Initialization
// ============================================================================

figma.showUI(__html__, {
  width: 720,
  height: 560,
  themeColors: true
});

// Variable cache for lookups
let variableCache: Map<string, Variable> = new Map();
let collectionCache: Map<string, VariableCollection> = new Map();

// ============================================================================
// Message Handling
// ============================================================================

figma.ui.onmessage = async (msg) => {
  try {
    switch (msg.type) {
      case 'scan-selection':
        await handleScanSelection();
        break;

      case 'preview-remap':
        await handlePreviewRemap(msg.findText, msg.replaceText, msg.options, msg.selectedBindings);
        break;

      case 'apply-remap':
        await handleApplyRemap(msg.remaps);
        break;

      case 'resize':
        figma.ui.resize(msg.size.w, msg.size.h);
        break;

      case 'close':
        figma.closePlugin();
        break;
    }
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: String(error)
    });
  }
};

// ============================================================================
// Selection Change Handling
// ============================================================================

figma.on('selectionchange', () => {
  figma.ui.postMessage({
    type: 'selection-changed',
    hasSelection: figma.currentPage.selection.length > 0
  });
});

// ============================================================================
// Core Functions
// ============================================================================

async function handleScanSelection(): Promise<void> {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'scan-complete',
      result: { bindings: [], nestedInstances: [] }
    });
    return;
  }

  // Refresh caches
  await refreshVariableCaches();

  const bindings: BoundVariableInfo[] = [];
  const nestedInstances: NestedInstanceInfo[] = [];
  const processedNestedIds = new Set<string>();

  for (const node of selection) {
    await scanNode(node, bindings, nestedInstances, processedNestedIds, false, '');
  }

  // Deduplicate bindings by unique combination
  const uniqueBindings = deduplicateBindings(bindings);

  figma.ui.postMessage({
    type: 'scan-complete',
    result: {
      bindings: uniqueBindings,
      nestedInstances
    }
  });
}

async function scanNode(
  node: SceneNode,
  bindings: BoundVariableInfo[],
  nestedInstances: NestedInstanceInfo[],
  processedNestedIds: Set<string>,
  isNestedInstance: boolean,
  instancePath: string
): Promise<void> {
  // Check if this is a nested instance (not the top-level selection)
  if (node.type === 'INSTANCE' && isNestedInstance) {
    if (!processedNestedIds.has(node.id)) {
      processedNestedIds.add(node.id);

      // Count bound variables in this instance
      const instanceBindings: BoundVariableInfo[] = [];
      await collectBoundVariables(node, instanceBindings, true, node.name);

      if (instanceBindings.length > 0) {
        const mainComponent = await node.getMainComponentAsync();
        nestedInstances.push({
          nodeId: node.id,
          nodeName: node.name,
          mainComponentName: mainComponent?.name || 'Unknown Component',
          boundVariableCount: instanceBindings.length
        });
      }
    }
    return; // Don't recurse into nested instances
  }

  // Collect bound variables from this node
  await collectBoundVariables(node, bindings, isNestedInstance, instancePath);

  // Recurse into children
  if ('children' in node) {
    for (const child of node.children) {
      const childIsNestedInstance = child.type === 'INSTANCE';
      const childPath = instancePath ? `${instancePath} > ${child.name}` : child.name;
      await scanNode(
        child,
        bindings,
        nestedInstances,
        processedNestedIds,
        childIsNestedInstance || isNestedInstance,
        childPath
      );
    }
  }
}

async function collectBoundVariables(
  node: SceneNode,
  bindings: BoundVariableInfo[],
  isNestedInstance: boolean,
  instancePath: string
): Promise<void> {
  if (!('boundVariables' in node) || !node.boundVariables) {
    return;
  }

  const boundVars = node.boundVariables as Record<string, VariableAlias | VariableAlias[]>;

  for (const [key, binding] of Object.entries(boundVars)) {
    if (!binding) continue;

    const aliases = Array.isArray(binding) ? binding : [binding];

    for (const alias of aliases) {
      if (alias && 'id' in alias) {
        const variable = variableCache.get(alias.id);
        const collection = variable ? collectionCache.get(variable.variableCollectionId) : null;

        if (variable && collection) {
          bindings.push({
            nodeId: node.id,
            nodeName: node.name,
            propertyType: categorizeProperty(key),
            propertyKey: key,
            variableId: variable.id,
            variableName: variable.name,
            collectionId: collection.id,
            collectionName: collection.name,
            isNestedInstance,
            instancePath: instancePath || undefined
          });
        }
      }
    }
  }
}

function categorizeProperty(key: string): PropertyType {
  const colorProps = ['fills', 'strokes', 'effects'];
  const spacingProps = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing'];
  const radiusProps = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerRadius'];
  const typographyProps = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paragraphSpacing'];

  if (colorProps.includes(key)) return 'color';
  if (spacingProps.includes(key)) return 'spacing';
  if (radiusProps.includes(key)) return 'cornerRadius';
  if (typographyProps.includes(key)) return 'typography';
  return 'other';
}

function deduplicateBindings(bindings: BoundVariableInfo[]): BoundVariableInfo[] {
  const seen = new Set<string>();
  return bindings.filter(b => {
    const key = `${b.nodeId}:${b.propertyKey}:${b.variableId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function handlePreviewRemap(
  findText: string,
  replaceText: string,
  options: { wholeSegment: boolean; caseSensitive: boolean },
  selectedBindings: BoundVariableInfo[]
): Promise<void> {
  if (!findText) {
    figma.ui.postMessage({
      type: 'preview-result',
      previews: selectedBindings.map(b => ({
        binding: b,
        newVariableName: null,
        newVariableId: null,
        status: 'unchanged' as const
      }))
    });
    return;
  }

  const previews: RemapPreview[] = [];

  for (const binding of selectedBindings) {
    const newName = applyFindReplace(binding.variableName, findText, replaceText, options);

    if (newName === binding.variableName) {
      previews.push({
        binding,
        newVariableName: null,
        newVariableId: null,
        status: 'unchanged'
      });
      continue;
    }

    // Try to find target variable in the same collection
    const targetVariable = await findVariableByName(newName, binding.collectionId);

    previews.push({
      binding,
      newVariableName: newName,
      newVariableId: targetVariable?.id || null,
      status: targetVariable ? 'found' : 'not_found'
    });
  }

  figma.ui.postMessage({
    type: 'preview-result',
    previews
  });
}

function applyFindReplace(
  original: string,
  find: string,
  replace: string,
  options: { wholeSegment: boolean; caseSensitive: boolean }
): string {
  if (options.wholeSegment) {
    // Split by '/' and replace whole segments only
    const segments = original.split('/');
    const newSegments = segments.map(seg => {
      if (options.caseSensitive) {
        return seg === find ? replace : seg;
      } else {
        return seg.toLowerCase() === find.toLowerCase() ? replace : seg;
      }
    });
    return newSegments.join('/');
  } else {
    // Simple string replacement
    if (options.caseSensitive) {
      return original.split(find).join(replace);
    } else {
      const regex = new RegExp(escapeRegExp(find), 'gi');
      return original.replace(regex, replace);
    }
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findVariableByName(name: string, collectionId: string): Promise<Variable | null> {
  for (const variable of variableCache.values()) {
    if (variable.name === name && variable.variableCollectionId === collectionId) {
      return variable;
    }
  }
  return null;
}

async function handleApplyRemap(remaps: RemapRequest[]): Promise<void> {
  if (remaps.length === 0) {
    figma.ui.postMessage({
      type: 'apply-complete',
      result: { success: true, appliedCount: 0 }
    });
    return;
  }

  let appliedCount = 0;
  const errors: string[] = [];

  // Group all changes for single undo step
  for (const remap of remaps) {
    try {
      const node = await figma.getNodeByIdAsync(remap.nodeId) as SceneNode;
      if (!node) {
        errors.push(`Node not found: ${remap.nodeId}`);
        continue;
      }

      const newVariable = variableCache.get(remap.newVariableId);
      if (!newVariable) {
        errors.push(`Variable not found: ${remap.newVariableId}`);
        continue;
      }

      await applyVariableToProperty(node, remap.propertyKey, remap.propertyType, newVariable);
      appliedCount++;
    } catch (err) {
      errors.push(`Error remapping ${remap.nodeId}.${remap.propertyKey}: ${err}`);
    }
  }

  // Trigger rescan after apply
  await handleScanSelection();

  figma.ui.postMessage({
    type: 'apply-complete',
    result: {
      success: errors.length === 0,
      appliedCount,
      errors: errors.length > 0 ? errors : undefined
    }
  });

  figma.notify(`Applied ${appliedCount} variable remap${appliedCount !== 1 ? 's' : ''}`, { timeout: 2000 });
}

async function applyVariableToProperty(
  node: SceneNode,
  propertyKey: string,
  propertyType: PropertyType,
  variable: Variable
): Promise<void> {
  // Handle array properties (fills, strokes, effects)
  if (propertyType === 'color') {
    if (propertyKey === 'fills' && 'fills' in node) {
      const fills = [...(node.fills as Paint[])];
      if (fills.length > 0 && fills[0].type === 'SOLID') {
        const newFill = figma.variables.setBoundVariableForPaint(fills[0], 'color', variable);
        (node as GeometryMixin).fills = [newFill];
      }
    } else if (propertyKey === 'strokes' && 'strokes' in node) {
      const strokes = [...(node.strokes as Paint[])];
      if (strokes.length > 0 && strokes[0].type === 'SOLID') {
        const newStroke = figma.variables.setBoundVariableForPaint(strokes[0], 'color', variable);
        (node as GeometryMixin).strokes = [newStroke];
      }
    }
  } else {
    // Handle scalar properties (spacing, radius, etc.)
    if ('setBoundVariable' in node) {
      (node as SceneNode & { setBoundVariable: (field: string, variable: Variable) => void })
        .setBoundVariable(propertyKey as VariableBindableNodeField, variable);
    }
  }
}

async function refreshVariableCaches(): Promise<void> {
  variableCache.clear();
  collectionCache.clear();

  const variables = await figma.variables.getLocalVariablesAsync();
  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  for (const variable of variables) {
    variableCache.set(variable.id, variable);
  }

  for (const collection of collections) {
    collectionCache.set(collection.id, collection);
  }
}

// ============================================================================
// Auto-scan on startup
// ============================================================================

(async () => {
  await handleScanSelection();
})();
