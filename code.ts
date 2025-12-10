// Figma Plugin: Variable Remapper
// Bulk reassign variables using find-and-replace on variable paths

// ============================================================================
// Types
// ============================================================================

interface BoundVariableInfo {
  propertyType: PropertyType;
  propertyKey: string;
  variableId: string;
  variableName: string;
  collectionId: string;
  collectionName: string;
  nodeCount: number; // How many nodes use this binding
  nodeIds: string[]; // List of node IDs that use this binding
}

type PropertyType = 'fill' | 'stroke' | 'effect' | 'text' | 'spacing' | 'cornerRadius' | 'typography' | 'other';

interface ScanResult {
  bindings: BoundVariableInfo[];
  nestedInstances: NestedInstanceInfo[];
  totalNodes: number;
}

interface NestedInstanceInfo {
  nodeId: string;
  nodeName: string;
  mainComponentName: string;
  boundVariableCount: number;
}

interface RemapPreview {
  binding: BoundVariableInfo;
  newVariableName: string | null;
  newVariableId: string | null;
  status: 'found' | 'not_found' | 'unchanged';
}

interface RemapRequest {
  propertyKey: string;
  propertyType: PropertyType;
  oldVariableId: string;
  newVariableId: string;
  nodeIds: string[];
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
var variableCache: Map<string, Variable> = new Map();
var collectionCache: Map<string, VariableCollection> = new Map();

// ============================================================================
// Message Handling
// ============================================================================

figma.ui.onmessage = async function(msg: any) {
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

      case 'get-collection-variables':
        await handleGetCollectionVariables(msg.collectionId);
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

figma.on('selectionchange', function() {
  figma.ui.postMessage({
    type: 'selection-changed',
    hasSelection: figma.currentPage.selection.length > 0
  });
});

// ============================================================================
// Core Functions
// ============================================================================

async function handleScanSelection(): Promise<void> {
  var selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'scan-complete',
      result: { bindings: [], nestedInstances: [], totalNodes: 0 }
    });
    return;
  }

  // Refresh caches
  await refreshVariableCaches();

  // Map to aggregate bindings: key = "propertyKey:variableId"
  var bindingMap: Map<string, BoundVariableInfo> = new Map();
  var nestedInstances: NestedInstanceInfo[] = [];
  var processedNestedIds: Set<string> = new Set();
  var totalNodes = 0;

  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    totalNodes += await scanNode(node, bindingMap, nestedInstances, processedNestedIds, false);
  }

  // Convert map to array
  var bindings: BoundVariableInfo[] = [];
  bindingMap.forEach(function(value) {
    bindings.push(value);
  });

  // Sort by property type, then by variable name
  bindings.sort(function(a, b) {
    if (a.propertyType !== b.propertyType) {
      return a.propertyType.localeCompare(b.propertyType);
    }
    return a.variableName.localeCompare(b.variableName);
  });

  figma.ui.postMessage({
    type: 'scan-complete',
    result: {
      bindings: bindings,
      nestedInstances: nestedInstances,
      totalNodes: totalNodes
    }
  });
}

async function scanNode(
  node: SceneNode,
  bindingMap: Map<string, BoundVariableInfo>,
  nestedInstances: NestedInstanceInfo[],
  processedNestedIds: Set<string>,
  isNestedInstance: boolean
): Promise<number> {
  var nodeCount = 1;

  // Check if this is a nested instance (not the top-level selection)
  if (node.type === 'INSTANCE' && isNestedInstance) {
    if (!processedNestedIds.has(node.id)) {
      processedNestedIds.add(node.id);

      // Count bound variables in this instance
      var instanceBindings: Map<string, BoundVariableInfo> = new Map();
      await collectBoundVariables(node, instanceBindings);

      if (instanceBindings.size > 0) {
        var mainComponent = await node.getMainComponentAsync();
        var mainName = 'Unknown Component';
        if (mainComponent && mainComponent.name) {
          mainName = mainComponent.name;
        }
        nestedInstances.push({
          nodeId: node.id,
          nodeName: node.name,
          mainComponentName: mainName,
          boundVariableCount: instanceBindings.size
        });
      }
    }
    return nodeCount; // Don't recurse into nested instances
  }

  // Collect bound variables from this node
  await collectBoundVariables(node, bindingMap, node.id);

  // Recurse into children
  if ('children' in node) {
    var children = (node as ChildrenMixin).children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i] as SceneNode;
      var childIsNestedInstance = child.type === 'INSTANCE';
      nodeCount += await scanNode(
        child,
        bindingMap,
        nestedInstances,
        processedNestedIds,
        childIsNestedInstance || isNestedInstance
      );
    }
  }

  return nodeCount;
}

async function collectBoundVariables(
  node: SceneNode,
  bindingMap: Map<string, BoundVariableInfo>,
  nodeId?: string
): Promise<void> {
  if (!('boundVariables' in node) || !node.boundVariables) {
    return;
  }

  var boundVars = node.boundVariables as Record<string, VariableAlias | VariableAlias[]>;
  var keys = Object.keys(boundVars);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var binding = boundVars[key];
    if (!binding) continue;

    var aliases: VariableAlias[] = Array.isArray(binding) ? binding : [binding];

    for (var j = 0; j < aliases.length; j++) {
      var alias = aliases[j];
      if (alias && 'id' in alias) {
        var variable = variableCache.get(alias.id);
        var collection = variable ? collectionCache.get(variable.variableCollectionId) : null;

        if (variable && collection) {
          var propType = categorizeProperty(key);
          var mapKey = propType + ':' + key + ':' + variable.id;

          var existing = bindingMap.get(mapKey);
          if (existing) {
            // Increment count and add nodeId
            existing.nodeCount++;
            if (nodeId && existing.nodeIds.indexOf(nodeId) === -1) {
              existing.nodeIds.push(nodeId);
            }
          } else {
            // Create new entry
            bindingMap.set(mapKey, {
              propertyType: propType,
              propertyKey: key,
              variableId: variable.id,
              variableName: variable.name,
              collectionId: collection.id,
              collectionName: collection.name,
              nodeCount: 1,
              nodeIds: nodeId ? [nodeId] : []
            });
          }
        }
      }
    }
  }
}

function categorizeProperty(key: string): PropertyType {
  // Fill colors
  if (key === 'fills') return 'fill';
  
  // Stroke colors
  if (key === 'strokes') return 'stroke';
  
  // Effect colors (shadows, etc.)
  if (key === 'effects') return 'effect';
  
  // Text colors
  if (key === 'textFills' || key === 'textColor') return 'text';
  
  // Spacing
  var spacingProps = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing'];
  if (spacingProps.indexOf(key) !== -1) return 'spacing';
  
  // Corner radius
  var radiusProps = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerRadius'];
  if (radiusProps.indexOf(key) !== -1) return 'cornerRadius';
  
  // Typography
  var typographyProps = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paragraphSpacing'];
  if (typographyProps.indexOf(key) !== -1) return 'typography';
  
  return 'other';
}

async function handlePreviewRemap(
  findText: string,
  replaceText: string,
  options: { wholeSegment: boolean; caseSensitive: boolean },
  selectedBindings: BoundVariableInfo[]
): Promise<void> {
  if (!findText) {
    var unchangedPreviews: RemapPreview[] = [];
    for (var i = 0; i < selectedBindings.length; i++) {
      unchangedPreviews.push({
        binding: selectedBindings[i],
        newVariableName: null,
        newVariableId: null,
        status: 'unchanged'
      });
    }
    figma.ui.postMessage({
      type: 'preview-result',
      previews: unchangedPreviews
    });
    return;
  }

  var previews: RemapPreview[] = [];

  for (var i = 0; i < selectedBindings.length; i++) {
    var binding = selectedBindings[i];
    var newName = applyFindReplace(binding.variableName, findText, replaceText, options);

    if (newName === binding.variableName) {
      previews.push({
        binding: binding,
        newVariableName: null,
        newVariableId: null,
        status: 'unchanged'
      });
      continue;
    }

    // Try to find target variable in the same collection
    var targetVariable = await findVariableByName(newName, binding.collectionId);

    previews.push({
      binding: binding,
      newVariableName: newName,
      newVariableId: targetVariable ? targetVariable.id : null,
      status: targetVariable ? 'found' : 'not_found'
    });
  }

  figma.ui.postMessage({
    type: 'preview-result',
    previews: previews
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
    var segments = original.split('/');
    var newSegments: string[] = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (options.caseSensitive) {
        newSegments.push(seg === find ? replace : seg);
      } else {
        newSegments.push(seg.toLowerCase() === find.toLowerCase() ? replace : seg);
      }
    }
    return newSegments.join('/');
  } else {
    // Simple string replacement
    if (options.caseSensitive) {
      return original.split(find).join(replace);
    } else {
      var regex = new RegExp(escapeRegExp(find), 'gi');
      return original.replace(regex, replace);
    }
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findVariableByName(name: string, collectionId: string): Promise<Variable | null> {
  var result: Variable | null = null;
  variableCache.forEach(function(variable) {
    if (variable.name === name && variable.variableCollectionId === collectionId) {
      result = variable;
    }
  });
  return result;
}

async function handleGetCollectionVariables(collectionId: string): Promise<void> {
  var variables: Array<{id: string, name: string}> = [];
  
  variableCache.forEach(function(variable) {
    if (variable.variableCollectionId === collectionId) {
      variables.push({
        id: variable.id,
        name: variable.name
      });
    }
  });

  // Sort by name
  variables.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });

  figma.ui.postMessage({
    type: 'collection-variables',
    collectionId: collectionId,
    variables: variables
  });
}

async function handleApplyRemap(remaps: RemapRequest[]): Promise<void> {
  if (remaps.length === 0) {
    figma.ui.postMessage({
      type: 'apply-complete',
      result: { success: true, appliedCount: 0 }
    });
    return;
  }

  var appliedCount = 0;
  var errors: string[] = [];

  // Process each remap
  for (var i = 0; i < remaps.length; i++) {
    var remap = remaps[i];
    var newVariable = variableCache.get(remap.newVariableId);
    
    if (!newVariable) {
      errors.push('Variable not found: ' + remap.newVariableId);
      continue;
    }

    // Apply to all nodes
    for (var j = 0; j < remap.nodeIds.length; j++) {
      var nodeId = remap.nodeIds[j];
      try {
        var node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
        if (!node) {
          errors.push('Node not found: ' + nodeId);
          continue;
        }

        await applyVariableToProperty(node, remap.propertyKey, remap.propertyType, newVariable);
        appliedCount++;
      } catch (err) {
        errors.push('Error remapping ' + nodeId + '.' + remap.propertyKey + ': ' + err);
      }
    }
  }

  // Trigger rescan after apply
  await handleScanSelection();

  figma.ui.postMessage({
    type: 'apply-complete',
    result: {
      success: errors.length === 0,
      appliedCount: appliedCount,
      errors: errors.length > 0 ? errors : undefined
    }
  });

  figma.notify('Applied ' + appliedCount + ' variable remap' + (appliedCount !== 1 ? 's' : ''), { timeout: 2000 });
}

async function applyVariableToProperty(
  node: SceneNode,
  propertyKey: string,
  propertyType: PropertyType,
  variable: Variable
): Promise<void> {
  // Handle fill colors
  if (propertyType === 'fill' && propertyKey === 'fills' && 'fills' in node) {
    var fills = (node.fills as Paint[]).slice();
    if (fills.length > 0 && fills[0].type === 'SOLID') {
      var newFill = figma.variables.setBoundVariableForPaint(fills[0], 'color', variable);
      (node as GeometryMixin).fills = [newFill];
    }
    return;
  }

  // Handle stroke colors
  if (propertyType === 'stroke' && propertyKey === 'strokes' && 'strokes' in node) {
    var strokes = (node.strokes as Paint[]).slice();
    if (strokes.length > 0 && strokes[0].type === 'SOLID') {
      var newStroke = figma.variables.setBoundVariableForPaint(strokes[0], 'color', variable);
      (node as GeometryMixin).strokes = [newStroke];
    }
    return;
  }

  // Handle effects (shadows, etc.) - more complex, need to handle each effect
  if (propertyType === 'effect' && propertyKey === 'effects' && 'effects' in node) {
    // Effects are more complex - for now skip
    // TODO: Implement effect variable binding
    return;
  }

  // Handle scalar properties (spacing, radius, etc.)
  if ('setBoundVariable' in node) {
    try {
      (node as any).setBoundVariable(propertyKey as VariableBindableNodeField, variable);
    } catch (e) {
      // Some properties may not be bindable
    }
  }
}

async function refreshVariableCaches(): Promise<void> {
  variableCache.clear();
  collectionCache.clear();

  var variables = await figma.variables.getLocalVariablesAsync();
  var collections = await figma.variables.getLocalVariableCollectionsAsync();

  for (var i = 0; i < variables.length; i++) {
    variableCache.set(variables[i].id, variables[i]);
  }

  for (var i = 0; i < collections.length; i++) {
    collectionCache.set(collections[i].id, collections[i]);
  }
}

// ============================================================================
// Auto-scan on startup
// ============================================================================

(async function() {
  await handleScanSelection();
})();
