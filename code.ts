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
  nodeCount: number;
  nodeIds: string[];
  isOrphaned: boolean;
}

interface OrphanedBindingInfo {
  propertyType: PropertyType;
  propertyKey: string;
  variableId: string;
  nodeCount: number;
  nodeIds: string[];
  nodeNames: string[];
}

type PropertyType = 'fill' | 'stroke' | 'effect' | 'text' | 'spacing' | 'cornerRadius' | 'typography' | 'other';

interface ScanResult {
  bindings: BoundVariableInfo[];
  orphanedBindings: OrphanedBindingInfo[];
  nestedInstances: NestedInstanceInfo[];
  totalNodes: number;
  localCollections: Array<{id: string, name: string}>;
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
  oldVariableName: string;
  newVariableId: string;
  newVariableName: string;
  nodeIds: string[];
  isOrphaned?: boolean;
}

interface HistoryEntry {
  id: string;
  timestamp: number;
  description: string;
  remaps: Array<{
    propertyKey: string;
    propertyType: PropertyType;
    oldVariableId: string;
    oldVariableName: string;
    newVariableId: string;
    newVariableName: string;
    nodeIds: string[];
    isOrphaned?: boolean;
  }>;
}

// ============================================================================
// Plugin Initialization
// ============================================================================

figma.showUI(__html__, {
  width: 720,
  height: 600,
  themeColors: true
});

// Variable cache for lookups
var variableCache: Map<string, Variable> = new Map();
var collectionCache: Map<string, VariableCollection> = new Map();

// History for undo/redo (in-memory, cleared on plugin close)
var history: HistoryEntry[] = [];
var historyIndex = -1;

// ============================================================================
// Message Handling
// ============================================================================

figma.ui.onmessage = async function(msg: any) {
  try {
    switch (msg.type) {
      case 'select-nodes':
        await handleSelectNodes(msg.nodeIds);
        break;

      case 'scan-selection':
        await handleScanSelection();
        break;

      case 'preview-remap':
        await handlePreviewRemap(msg.findText, msg.replaceText, msg.options, msg.selectedBindings);
        break;

      case 'apply-remap':
        await handleApplyRemap(msg.remaps);
        break;

      case 'apply-orphan-remap':
        await handleApplyOrphanRemap(msg.orphanedBinding, msg.newVariableId, msg.newVariableName);
        break;

      case 'undo':
        await handleUndo();
        break;

      case 'redo':
        await handleRedo();
        break;

      case 'get-collection-variables':
        await handleGetCollectionVariables(msg.collectionId, msg.variableType);
        break;

      case 'get-all-local-variables':
        await handleGetAllLocalVariables();
        break;

      case 'get-node-info':
        await handleGetNodeInfo(msg.nodeIds, msg.bindingKey);
        break;

      case 'refresh':
        await refreshVariableCaches();
        await handleScanSelection();
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

async function handleSelectNodes(nodeIds: string[]): Promise<void> {
  var nodes: SceneNode[] = [];
  var targetPage: PageNode | null = null;

  for (var i = 0; i < nodeIds.length; i++) {
    var node = await figma.getNodeByIdAsync(nodeIds[i]) as SceneNode;
    if (node) {
      nodes.push(node);

      // Find the page this node belongs to
      var parent: BaseNode | null = node.parent;
      while (parent && parent.type !== 'PAGE') {
        parent = parent.parent;
      }
      if (parent && parent.type === 'PAGE') {
        targetPage = parent as PageNode;
      }
    }
  }

  if (nodes.length > 0) {
    // Switch to the correct page if needed
    if (targetPage && figma.currentPage.id !== targetPage.id) {
      await figma.setCurrentPageAsync(targetPage);
    }

    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }
}

async function handleScanSelection(): Promise<void> {
  var selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'scan-complete',
      result: { 
        bindings: [], 
        orphanedBindings: [],
        nestedInstances: [], 
        totalNodes: 0,
        localCollections: []
      }
    });
    return;
  }

  // Refresh caches
  await refreshVariableCaches();

  var bindingMap: Map<string, BoundVariableInfo> = new Map();
  var orphanedMap: Map<string, OrphanedBindingInfo> = new Map();
  var nestedInstances: NestedInstanceInfo[] = [];
  var processedNestedIds: Set<string> = new Set();
  var totalNodes = 0;

  for (var i = 0; i < selection.length; i++) {
    var node = selection[i];
    totalNodes += await scanNode(node, bindingMap, orphanedMap, nestedInstances, processedNestedIds, false);
  }

  var bindings: BoundVariableInfo[] = [];
  bindingMap.forEach(function(value) {
    bindings.push(value);
  });

  var orphanedBindings: OrphanedBindingInfo[] = [];
  orphanedMap.forEach(function(value) {
    orphanedBindings.push(value);
  });

  bindings.sort(function(a, b) {
    if (a.propertyType !== b.propertyType) {
      return a.propertyType.localeCompare(b.propertyType);
    }
    return a.variableName.localeCompare(b.variableName);
  });

  orphanedBindings.sort(function(a, b) {
    if (a.propertyType !== b.propertyType) {
      return a.propertyType.localeCompare(b.propertyType);
    }
    return a.variableId.localeCompare(b.variableId);
  });

  // Get local collections for the UI dropdown
  var localCollections: Array<{id: string, name: string}> = [];
  collectionCache.forEach(function(collection) {
    localCollections.push({
      id: collection.id,
      name: collection.name
    });
  });

  figma.ui.postMessage({
    type: 'scan-complete',
    result: {
      bindings: bindings,
      orphanedBindings: orphanedBindings,
      nestedInstances: nestedInstances,
      totalNodes: totalNodes,
      localCollections: localCollections
    }
  });
}

async function scanNode(
  node: SceneNode,
  bindingMap: Map<string, BoundVariableInfo>,
  orphanedMap: Map<string, OrphanedBindingInfo>,
  nestedInstances: NestedInstanceInfo[],
  processedNestedIds: Set<string>,
  isNestedInstance: boolean
): Promise<number> {
  var nodeCount = 1;

  if (node.type === 'INSTANCE' && isNestedInstance) {
    if (!processedNestedIds.has(node.id)) {
      processedNestedIds.add(node.id);

      var instanceBindings: Map<string, BoundVariableInfo> = new Map();
      var instanceOrphaned: Map<string, OrphanedBindingInfo> = new Map();
      await collectBoundVariables(node, instanceBindings, instanceOrphaned);

      var totalBindings = instanceBindings.size + instanceOrphaned.size;
      if (totalBindings > 0) {
        var mainComponent = await node.getMainComponentAsync();
        var mainName = 'Unknown Component';
        if (mainComponent && mainComponent.name) {
          mainName = mainComponent.name;
        }
        nestedInstances.push({
          nodeId: node.id,
          nodeName: node.name,
          mainComponentName: mainName,
          boundVariableCount: totalBindings
        });
      }
    }
    return nodeCount;
  }

  await collectBoundVariables(node, bindingMap, orphanedMap, node.id, node.name);

  if ('children' in node) {
    var children = (node as ChildrenMixin).children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i] as SceneNode;
      var childIsNestedInstance = child.type === 'INSTANCE';
      nodeCount += await scanNode(
        child,
        bindingMap,
        orphanedMap,
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
  orphanedMap: Map<string, OrphanedBindingInfo>,
  nodeId?: string,
  nodeName?: string
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

        var propType = categorizeProperty(key);

        if (variable && collection) {
          // Valid variable binding
          var mapKey = propType + ':' + key + ':' + variable.id;

          var existing = bindingMap.get(mapKey);
          if (existing) {
            existing.nodeCount++;
            if (nodeId && existing.nodeIds.indexOf(nodeId) === -1) {
              existing.nodeIds.push(nodeId);
            }
          } else {
            bindingMap.set(mapKey, {
              propertyType: propType,
              propertyKey: key,
              variableId: variable.id,
              variableName: variable.name,
              collectionId: collection.id,
              collectionName: collection.name,
              nodeCount: 1,
              nodeIds: nodeId ? [nodeId] : [],
              isOrphaned: false
            });
          }
        } else {
          // Orphaned variable binding - variable doesn't exist locally
          var orphanKey = propType + ':' + key + ':' + alias.id;

          var existingOrphan = orphanedMap.get(orphanKey);
          if (existingOrphan) {
            existingOrphan.nodeCount++;
            if (nodeId && existingOrphan.nodeIds.indexOf(nodeId) === -1) {
              existingOrphan.nodeIds.push(nodeId);
              if (nodeName) {
                existingOrphan.nodeNames.push(nodeName);
              }
            }
          } else {
            orphanedMap.set(orphanKey, {
              propertyType: propType,
              propertyKey: key,
              variableId: alias.id,
              nodeCount: 1,
              nodeIds: nodeId ? [nodeId] : [],
              nodeNames: nodeName ? [nodeName] : []
            });
          }
        }
      }
    }
  }
}

function categorizeProperty(key: string): PropertyType {
  if (key === 'fills') return 'fill';
  if (key === 'strokes') return 'stroke';
  if (key === 'effects') return 'effect';
  if (key === 'textFills' || key === 'textColor') return 'text';
  
  var spacingProps = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing'];
  if (spacingProps.indexOf(key) !== -1) return 'spacing';
  
  var radiusProps = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerRadius'];
  if (radiusProps.indexOf(key) !== -1) return 'cornerRadius';
  
  var typographyProps = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paragraphSpacing'];
  if (typographyProps.indexOf(key) !== -1) return 'typography';
  
  return 'other';
}

function getVariableTypeForProperty(propType: PropertyType): VariableResolvedDataType | null {
  if (propType === 'fill' || propType === 'stroke' || propType === 'effect' || propType === 'text') {
    return 'COLOR';
  }
  if (propType === 'spacing' || propType === 'cornerRadius' || propType === 'typography') {
    return 'FLOAT';
  }
  return null;
}

async function handlePreviewRemap(
  findText: string,
  replaceText: string,
  options: { wholeSegment: boolean; caseSensitive: boolean; targetCollectionId?: string },
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

    // Determine which collection to search in:
    // - If targetCollectionId is specified (not 'same' or empty), use that specific collection
    // - Otherwise, search in the same collection as the source binding
    var searchCollectionId: string | null;
    if (options.targetCollectionId && options.targetCollectionId !== 'same') {
      searchCollectionId = options.targetCollectionId;
    } else {
      searchCollectionId = binding.collectionId;
    }

    var targetVariable = await findVariableByName(newName, searchCollectionId);

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

async function findVariableByName(name: string, collectionId: string | null): Promise<Variable | null> {
  var result: Variable | null = null;
  variableCache.forEach(function(variable) {
    if (variable.name === name) {
      // If collectionId is null, search across all collections
      // If collectionId is specified, only match within that collection
      if (collectionId === null || variable.variableCollectionId === collectionId) {
        result = variable;
      }
    }
  });
  return result;
}

async function findVariableByNameInCollection(name: string, targetCollectionId: string): Promise<Variable | null> {
  var result: Variable | null = null;
  variableCache.forEach(function(variable) {
    if (variable.name === name && variable.variableCollectionId === targetCollectionId) {
      result = variable;
    }
  });
  return result;
}

async function handleGetCollectionVariables(collectionId: string, variableType?: string): Promise<void> {
  var variables: Array<{id: string, name: string, resolvedType: string}> = [];
  
  variableCache.forEach(function(variable) {
    if (variable.variableCollectionId === collectionId) {
      // Filter by type if specified
      if (!variableType || variable.resolvedType === variableType) {
        variables.push({
          id: variable.id,
          name: variable.name,
          resolvedType: variable.resolvedType
        });
      }
    }
  });

  variables.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });

  figma.ui.postMessage({
    type: 'collection-variables',
    collectionId: collectionId,
    variables: variables
  });
}

async function handleGetAllLocalVariables(): Promise<void> {
  var variablesByCollection: Record<string, Array<{id: string, name: string, resolvedType: string}>> = {};
  
  collectionCache.forEach(function(collection) {
    variablesByCollection[collection.id] = [];
  });

  variableCache.forEach(function(variable) {
    if (variablesByCollection[variable.variableCollectionId]) {
      variablesByCollection[variable.variableCollectionId].push({
        id: variable.id,
        name: variable.name,
        resolvedType: variable.resolvedType
      });
    }
  });

  // Sort variables in each collection
  Object.keys(variablesByCollection).forEach(function(collectionId) {
    variablesByCollection[collectionId].sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
  });

  var collections: Array<{id: string, name: string}> = [];
  collectionCache.forEach(function(collection) {
    collections.push({
      id: collection.id,
      name: collection.name
    });
  });

  figma.ui.postMessage({
    type: 'all-local-variables',
    collections: collections,
    variablesByCollection: variablesByCollection
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

  // Create history entry for undo
  var historyEntry: HistoryEntry = {
    id: 'h_' + Date.now(),
    timestamp: Date.now(),
    description: 'Remapped ' + remaps.length + ' variable' + (remaps.length !== 1 ? 's' : ''),
    remaps: remaps.map(function(r) {
      return {
        propertyKey: r.propertyKey,
        propertyType: r.propertyType,
        oldVariableId: r.oldVariableId,
        oldVariableName: r.oldVariableName,
        newVariableId: r.newVariableId,
        newVariableName: r.newVariableName,
        nodeIds: r.nodeIds.slice(),
        isOrphaned: r.isOrphaned
      };
    })
  };

  // Process each remap
  for (var i = 0; i < remaps.length; i++) {
    var remap = remaps[i];
    var newVariable = variableCache.get(remap.newVariableId);
    
    if (!newVariable) {
      errors.push('Variable not found: ' + remap.newVariableId);
      continue;
    }

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

  // Add to history (truncate any redo history)
  if (appliedCount > 0) {
    history = history.slice(0, historyIndex + 1);
    history.push(historyEntry);
    historyIndex = history.length - 1;
    sendHistoryUpdate();
  }

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

async function handleApplyOrphanRemap(
  orphanedBinding: OrphanedBindingInfo,
  newVariableId: string,
  newVariableName: string
): Promise<void> {
  var newVariable = variableCache.get(newVariableId);
  
  if (!newVariable) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Variable not found: ' + newVariableId
    });
    return;
  }

  var appliedCount = 0;
  var errors: string[] = [];

  // Create history entry
  var historyEntry: HistoryEntry = {
    id: 'h_' + Date.now(),
    timestamp: Date.now(),
    description: 'Fixed orphaned ' + orphanedBinding.propertyType + ' binding',
    remaps: [{
      propertyKey: orphanedBinding.propertyKey,
      propertyType: orphanedBinding.propertyType,
      oldVariableId: orphanedBinding.variableId,
      oldVariableName: '(orphaned)',
      newVariableId: newVariableId,
      newVariableName: newVariableName,
      nodeIds: orphanedBinding.nodeIds.slice(),
      isOrphaned: true
    }]
  };

  for (var i = 0; i < orphanedBinding.nodeIds.length; i++) {
    var nodeId = orphanedBinding.nodeIds[i];
    try {
      var node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
      if (!node) {
        errors.push('Node not found: ' + nodeId);
        continue;
      }

      await applyVariableToProperty(node, orphanedBinding.propertyKey, orphanedBinding.propertyType, newVariable);
      appliedCount++;
    } catch (err) {
      errors.push('Error remapping ' + nodeId + '.' + orphanedBinding.propertyKey + ': ' + err);
    }
  }

  if (appliedCount > 0) {
    history = history.slice(0, historyIndex + 1);
    history.push(historyEntry);
    historyIndex = history.length - 1;
    sendHistoryUpdate();
  }

  await handleScanSelection();

  figma.ui.postMessage({
    type: 'orphan-remap-complete',
    result: {
      success: errors.length === 0,
      appliedCount: appliedCount,
      errors: errors.length > 0 ? errors : undefined
    }
  });

  figma.notify('Fixed ' + appliedCount + ' orphaned binding' + (appliedCount !== 1 ? 's' : ''), { timeout: 2000 });
}

async function handleUndo(): Promise<void> {
  if (historyIndex < 0) {
    figma.notify('Nothing to undo', { timeout: 1500 });
    return;
  }

  var entry = history[historyIndex];
  var undoneCount = 0;

  // Reverse the remaps (swap old and new)
  for (var i = 0; i < entry.remaps.length; i++) {
    var remap = entry.remaps[i];
    
    // For orphaned bindings, we can't really undo - the old variable doesn't exist
    if (remap.isOrphaned) {
      // We could try to unbind the variable, but that might not be what user wants
      // For now, skip orphaned remaps in undo
      continue;
    }

    var oldVariable = variableCache.get(remap.oldVariableId);
    if (!oldVariable) continue;

    for (var j = 0; j < remap.nodeIds.length; j++) {
      var nodeId = remap.nodeIds[j];
      try {
        var node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
        if (!node) continue;

        await applyVariableToProperty(node, remap.propertyKey, remap.propertyType, oldVariable);
        undoneCount++;
      } catch (err) {
        // Silently continue
      }
    }
  }

  historyIndex--;
  sendHistoryUpdate();
  await handleScanSelection();

  figma.notify('Undone: ' + entry.description, { timeout: 2000 });
}

async function handleRedo(): Promise<void> {
  if (historyIndex >= history.length - 1) {
    figma.notify('Nothing to redo', { timeout: 1500 });
    return;
  }

  historyIndex++;
  var entry = history[historyIndex];
  var redoneCount = 0;

  // Re-apply the remaps
  for (var i = 0; i < entry.remaps.length; i++) {
    var remap = entry.remaps[i];
    var newVariable = variableCache.get(remap.newVariableId);
    
    if (!newVariable) continue;

    for (var j = 0; j < remap.nodeIds.length; j++) {
      var nodeId = remap.nodeIds[j];
      try {
        var node = await figma.getNodeByIdAsync(nodeId) as SceneNode;
        if (!node) continue;

        await applyVariableToProperty(node, remap.propertyKey, remap.propertyType, newVariable);
        redoneCount++;
      } catch (err) {
        // Silently continue
      }
    }
  }

  sendHistoryUpdate();
  await handleScanSelection();

  figma.notify('Redone: ' + entry.description, { timeout: 2000 });
}

function sendHistoryUpdate(): void {
  figma.ui.postMessage({
    type: 'history-update',
    history: history.map(function(h) {
      return {
        id: h.id,
        timestamp: h.timestamp,
        description: h.description,
        remapCount: h.remaps.length
      };
    }),
    historyIndex: historyIndex
  });
}

async function applyVariableToProperty(
  node: SceneNode,
  propertyKey: string,
  propertyType: PropertyType,
  variable: Variable
): Promise<void> {
  if (propertyType === 'fill' && propertyKey === 'fills' && 'fills' in node) {
    var fills = (node.fills as Paint[]).slice();
    if (fills.length > 0 && fills[0].type === 'SOLID') {
      var newFill = figma.variables.setBoundVariableForPaint(fills[0], 'color', variable);
      (node as GeometryMixin).fills = [newFill];
    }
    return;
  }

  if (propertyType === 'stroke' && propertyKey === 'strokes' && 'strokes' in node) {
    var strokes = (node.strokes as Paint[]).slice();
    if (strokes.length > 0 && strokes[0].type === 'SOLID') {
      var newStroke = figma.variables.setBoundVariableForPaint(strokes[0], 'color', variable);
      (node as GeometryMixin).strokes = [newStroke];
    }
    return;
  }

  if (propertyType === 'effect' && propertyKey === 'effects' && 'effects' in node) {
    // TODO: Implement effect variable binding
    return;
  }

  if ('setBoundVariable' in node) {
    try {
      (node as any).setBoundVariable(propertyKey as VariableBindableNodeField, variable);
    } catch (e) {
      // Some properties may not be bindable
    }
  }
}

async function handleGetNodeInfo(nodeIds: string[], bindingKey: string): Promise<void> {
  var nodeInfo: Array<{id: string, name: string, type: string}> = [];

  for (var i = 0; i < nodeIds.length; i++) {
    try {
      var node = await figma.getNodeByIdAsync(nodeIds[i]) as SceneNode;
      if (node) {
        nodeInfo.push({
          id: node.id,
          name: node.name,
          type: node.type
        });
      } else {
        nodeInfo.push({
          id: nodeIds[i],
          name: '(deleted)',
          type: 'UNKNOWN'
        });
      }
    } catch (err) {
      nodeInfo.push({
        id: nodeIds[i],
        name: '(error)',
        type: 'UNKNOWN'
      });
    }
  }

  figma.ui.postMessage({
    type: 'node-info',
    bindingKey: bindingKey,
    nodeInfo: nodeInfo
  });
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
  sendHistoryUpdate();
})();
