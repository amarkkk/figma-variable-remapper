"use strict";
// Figma Plugin: Variable Remapper
// Bulk reassign variables using find-and-replace on variable paths
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ============================================================================
// Plugin Initialization
// ============================================================================
figma.showUI(__html__, {
    width: 720,
    height: 600,
    themeColors: true
});
// Variable cache for lookups
var variableCache = new Map();
var collectionCache = new Map();
// History for undo/redo (in-memory, cleared on plugin close)
var history = [];
var historyIndex = -1;
// ============================================================================
// Message Handling
// ============================================================================
figma.ui.onmessage = function (msg) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            switch (msg.type) {
                case 'select-nodes':
                    yield handleSelectNodes(msg.nodeIds);
                    break;
                case 'scan-selection':
                    yield handleScanSelection();
                    break;
                case 'preview-remap':
                    yield handlePreviewRemap(msg.findText, msg.replaceText, msg.options, msg.selectedBindings);
                    break;
                case 'apply-remap':
                    yield handleApplyRemap(msg.remaps);
                    break;
                case 'apply-orphan-remap':
                    yield handleApplyOrphanRemap(msg.orphanedBinding, msg.newVariableId, msg.newVariableName);
                    break;
                case 'undo':
                    yield handleUndo();
                    break;
                case 'redo':
                    yield handleRedo();
                    break;
                case 'get-collection-variables':
                    yield handleGetCollectionVariables(msg.collectionId, msg.variableType);
                    break;
                case 'get-all-local-variables':
                    yield handleGetAllLocalVariables();
                    break;
                case 'get-node-info':
                    yield handleGetNodeInfo(msg.nodeIds, msg.bindingKey);
                    break;
                case 'refresh':
                    yield refreshVariableCaches();
                    yield handleScanSelection();
                    break;
                case 'resize':
                    figma.ui.resize(msg.size.w, msg.size.h);
                    break;
                case 'close':
                    figma.closePlugin();
                    break;
            }
        }
        catch (error) {
            figma.ui.postMessage({
                type: 'error',
                message: String(error)
            });
        }
    });
};
// ============================================================================
// Selection Change Handling
// ============================================================================
figma.on('selectionchange', function () {
    figma.ui.postMessage({
        type: 'selection-changed',
        hasSelection: figma.currentPage.selection.length > 0
    });
});
// ============================================================================
// Core Functions
// ============================================================================
function handleSelectNodes(nodeIds) {
    return __awaiter(this, void 0, void 0, function* () {
        var nodes = [];
        var targetPage = null;
        for (var i = 0; i < nodeIds.length; i++) {
            var node = yield figma.getNodeByIdAsync(nodeIds[i]);
            if (node) {
                nodes.push(node);
                // Find the page this node belongs to
                var parent = node.parent;
                while (parent && parent.type !== 'PAGE') {
                    parent = parent.parent;
                }
                if (parent && parent.type === 'PAGE') {
                    targetPage = parent;
                }
            }
        }
        if (nodes.length > 0) {
            // Switch to the correct page if needed
            if (targetPage && figma.currentPage.id !== targetPage.id) {
                yield figma.setCurrentPageAsync(targetPage);
            }
            figma.currentPage.selection = nodes;
            figma.viewport.scrollAndZoomIntoView(nodes);
        }
    });
}
function handleScanSelection() {
    return __awaiter(this, void 0, void 0, function* () {
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
        yield refreshVariableCaches();
        var bindingMap = new Map();
        var orphanedMap = new Map();
        var nestedInstances = [];
        var processedNestedIds = new Set();
        var totalNodes = 0;
        for (var i = 0; i < selection.length; i++) {
            var node = selection[i];
            totalNodes += yield scanNode(node, bindingMap, orphanedMap, nestedInstances, processedNestedIds, false);
        }
        var bindings = [];
        bindingMap.forEach(function (value) {
            bindings.push(value);
        });
        var orphanedBindings = [];
        orphanedMap.forEach(function (value) {
            orphanedBindings.push(value);
        });
        bindings.sort(function (a, b) {
            if (a.propertyType !== b.propertyType) {
                return a.propertyType.localeCompare(b.propertyType);
            }
            return a.variableName.localeCompare(b.variableName);
        });
        orphanedBindings.sort(function (a, b) {
            if (a.propertyType !== b.propertyType) {
                return a.propertyType.localeCompare(b.propertyType);
            }
            return a.variableId.localeCompare(b.variableId);
        });
        // Get local collections for the UI dropdown
        var localCollections = [];
        collectionCache.forEach(function (collection) {
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
    });
}
function scanNode(node, bindingMap, orphanedMap, nestedInstances, processedNestedIds, isNestedInstance) {
    return __awaiter(this, void 0, void 0, function* () {
        var nodeCount = 1;
        if (node.type === 'INSTANCE' && isNestedInstance) {
            if (!processedNestedIds.has(node.id)) {
                processedNestedIds.add(node.id);
                var instanceBindings = new Map();
                var instanceOrphaned = new Map();
                yield collectBoundVariables(node, instanceBindings, instanceOrphaned);
                var totalBindings = instanceBindings.size + instanceOrphaned.size;
                if (totalBindings > 0) {
                    var mainComponent = yield node.getMainComponentAsync();
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
        yield collectBoundVariables(node, bindingMap, orphanedMap, node.id, node.name);
        if ('children' in node) {
            var children = node.children;
            for (var i = 0; i < children.length; i++) {
                var child = children[i];
                var childIsNestedInstance = child.type === 'INSTANCE';
                nodeCount += yield scanNode(child, bindingMap, orphanedMap, nestedInstances, processedNestedIds, childIsNestedInstance || isNestedInstance);
            }
        }
        return nodeCount;
    });
}
function collectBoundVariables(node, bindingMap, orphanedMap, nodeId, nodeName) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!('boundVariables' in node) || !node.boundVariables) {
            return;
        }
        var boundVars = node.boundVariables;
        var keys = Object.keys(boundVars);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var binding = boundVars[key];
            if (!binding)
                continue;
            var aliases = Array.isArray(binding) ? binding : [binding];
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
                        }
                        else {
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
                    }
                    else {
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
                        }
                        else {
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
    });
}
function categorizeProperty(key) {
    if (key === 'fills')
        return 'fill';
    if (key === 'strokes')
        return 'stroke';
    if (key === 'effects')
        return 'effect';
    if (key === 'textFills' || key === 'textColor')
        return 'text';
    var spacingProps = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing'];
    if (spacingProps.indexOf(key) !== -1)
        return 'spacing';
    var radiusProps = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerRadius'];
    if (radiusProps.indexOf(key) !== -1)
        return 'cornerRadius';
    var typographyProps = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paragraphSpacing'];
    if (typographyProps.indexOf(key) !== -1)
        return 'typography';
    return 'other';
}
function getVariableTypeForProperty(propType) {
    if (propType === 'fill' || propType === 'stroke' || propType === 'effect' || propType === 'text') {
        return 'COLOR';
    }
    if (propType === 'spacing' || propType === 'cornerRadius' || propType === 'typography') {
        return 'FLOAT';
    }
    return null;
}
function handlePreviewRemap(findText, replaceText, options, selectedBindings) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!findText) {
            var unchangedPreviews = [];
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
        var previews = [];
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
            var searchCollectionId;
            if (options.targetCollectionId && options.targetCollectionId !== 'same') {
                searchCollectionId = options.targetCollectionId;
            }
            else {
                searchCollectionId = binding.collectionId;
            }
            var targetVariable = yield findVariableByName(newName, searchCollectionId);
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
    });
}
function applyFindReplace(original, find, replace, options) {
    if (options.wholeSegment) {
        var segments = original.split('/');
        var newSegments = [];
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            if (options.caseSensitive) {
                newSegments.push(seg === find ? replace : seg);
            }
            else {
                newSegments.push(seg.toLowerCase() === find.toLowerCase() ? replace : seg);
            }
        }
        return newSegments.join('/');
    }
    else {
        if (options.caseSensitive) {
            return original.split(find).join(replace);
        }
        else {
            var regex = new RegExp(escapeRegExp(find), 'gi');
            return original.replace(regex, replace);
        }
    }
}
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function findVariableByName(name, collectionId) {
    return __awaiter(this, void 0, void 0, function* () {
        var result = null;
        variableCache.forEach(function (variable) {
            if (variable.name === name) {
                // If collectionId is null, search across all collections
                // If collectionId is specified, only match within that collection
                if (collectionId === null || variable.variableCollectionId === collectionId) {
                    result = variable;
                }
            }
        });
        return result;
    });
}
function findVariableByNameInCollection(name, targetCollectionId) {
    return __awaiter(this, void 0, void 0, function* () {
        var result = null;
        variableCache.forEach(function (variable) {
            if (variable.name === name && variable.variableCollectionId === targetCollectionId) {
                result = variable;
            }
        });
        return result;
    });
}
function handleGetCollectionVariables(collectionId, variableType) {
    return __awaiter(this, void 0, void 0, function* () {
        var variables = [];
        variableCache.forEach(function (variable) {
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
        variables.sort(function (a, b) {
            return a.name.localeCompare(b.name);
        });
        figma.ui.postMessage({
            type: 'collection-variables',
            collectionId: collectionId,
            variables: variables
        });
    });
}
function handleGetAllLocalVariables() {
    return __awaiter(this, void 0, void 0, function* () {
        var variablesByCollection = {};
        collectionCache.forEach(function (collection) {
            variablesByCollection[collection.id] = [];
        });
        variableCache.forEach(function (variable) {
            if (variablesByCollection[variable.variableCollectionId]) {
                variablesByCollection[variable.variableCollectionId].push({
                    id: variable.id,
                    name: variable.name,
                    resolvedType: variable.resolvedType
                });
            }
        });
        // Sort variables in each collection
        Object.keys(variablesByCollection).forEach(function (collectionId) {
            variablesByCollection[collectionId].sort(function (a, b) {
                return a.name.localeCompare(b.name);
            });
        });
        var collections = [];
        collectionCache.forEach(function (collection) {
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
    });
}
function handleApplyRemap(remaps) {
    return __awaiter(this, void 0, void 0, function* () {
        if (remaps.length === 0) {
            figma.ui.postMessage({
                type: 'apply-complete',
                result: { success: true, appliedCount: 0 }
            });
            return;
        }
        var appliedCount = 0;
        var errors = [];
        // Create history entry for undo
        var historyEntry = {
            id: 'h_' + Date.now(),
            timestamp: Date.now(),
            description: 'Remapped ' + remaps.length + ' variable' + (remaps.length !== 1 ? 's' : ''),
            remaps: remaps.map(function (r) {
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
                    var node = yield figma.getNodeByIdAsync(nodeId);
                    if (!node) {
                        errors.push('Node not found: ' + nodeId);
                        continue;
                    }
                    yield applyVariableToProperty(node, remap.propertyKey, remap.propertyType, newVariable);
                    appliedCount++;
                }
                catch (err) {
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
        yield handleScanSelection();
        figma.ui.postMessage({
            type: 'apply-complete',
            result: {
                success: errors.length === 0,
                appliedCount: appliedCount,
                errors: errors.length > 0 ? errors : undefined
            }
        });
        figma.notify('Applied ' + appliedCount + ' variable remap' + (appliedCount !== 1 ? 's' : ''), { timeout: 2000 });
    });
}
function handleApplyOrphanRemap(orphanedBinding, newVariableId, newVariableName) {
    return __awaiter(this, void 0, void 0, function* () {
        var newVariable = variableCache.get(newVariableId);
        if (!newVariable) {
            figma.ui.postMessage({
                type: 'error',
                message: 'Variable not found: ' + newVariableId
            });
            return;
        }
        var appliedCount = 0;
        var errors = [];
        // Create history entry
        var historyEntry = {
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
                var node = yield figma.getNodeByIdAsync(nodeId);
                if (!node) {
                    errors.push('Node not found: ' + nodeId);
                    continue;
                }
                yield applyVariableToProperty(node, orphanedBinding.propertyKey, orphanedBinding.propertyType, newVariable);
                appliedCount++;
            }
            catch (err) {
                errors.push('Error remapping ' + nodeId + '.' + orphanedBinding.propertyKey + ': ' + err);
            }
        }
        if (appliedCount > 0) {
            history = history.slice(0, historyIndex + 1);
            history.push(historyEntry);
            historyIndex = history.length - 1;
            sendHistoryUpdate();
        }
        yield handleScanSelection();
        figma.ui.postMessage({
            type: 'orphan-remap-complete',
            result: {
                success: errors.length === 0,
                appliedCount: appliedCount,
                errors: errors.length > 0 ? errors : undefined
            }
        });
        figma.notify('Fixed ' + appliedCount + ' orphaned binding' + (appliedCount !== 1 ? 's' : ''), { timeout: 2000 });
    });
}
function handleUndo() {
    return __awaiter(this, void 0, void 0, function* () {
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
            if (!oldVariable)
                continue;
            for (var j = 0; j < remap.nodeIds.length; j++) {
                var nodeId = remap.nodeIds[j];
                try {
                    var node = yield figma.getNodeByIdAsync(nodeId);
                    if (!node)
                        continue;
                    yield applyVariableToProperty(node, remap.propertyKey, remap.propertyType, oldVariable);
                    undoneCount++;
                }
                catch (err) {
                    // Silently continue
                }
            }
        }
        historyIndex--;
        sendHistoryUpdate();
        yield handleScanSelection();
        figma.notify('Undone: ' + entry.description, { timeout: 2000 });
    });
}
function handleRedo() {
    return __awaiter(this, void 0, void 0, function* () {
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
            if (!newVariable)
                continue;
            for (var j = 0; j < remap.nodeIds.length; j++) {
                var nodeId = remap.nodeIds[j];
                try {
                    var node = yield figma.getNodeByIdAsync(nodeId);
                    if (!node)
                        continue;
                    yield applyVariableToProperty(node, remap.propertyKey, remap.propertyType, newVariable);
                    redoneCount++;
                }
                catch (err) {
                    // Silently continue
                }
            }
        }
        sendHistoryUpdate();
        yield handleScanSelection();
        figma.notify('Redone: ' + entry.description, { timeout: 2000 });
    });
}
function sendHistoryUpdate() {
    figma.ui.postMessage({
        type: 'history-update',
        history: history.map(function (h) {
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
function applyVariableToProperty(node, propertyKey, propertyType, variable) {
    return __awaiter(this, void 0, void 0, function* () {
        if (propertyType === 'fill' && propertyKey === 'fills' && 'fills' in node) {
            var fills = node.fills.slice();
            if (fills.length > 0 && fills[0].type === 'SOLID') {
                var newFill = figma.variables.setBoundVariableForPaint(fills[0], 'color', variable);
                node.fills = [newFill];
            }
            return;
        }
        if (propertyType === 'stroke' && propertyKey === 'strokes' && 'strokes' in node) {
            var strokes = node.strokes.slice();
            if (strokes.length > 0 && strokes[0].type === 'SOLID') {
                var newStroke = figma.variables.setBoundVariableForPaint(strokes[0], 'color', variable);
                node.strokes = [newStroke];
            }
            return;
        }
        if (propertyType === 'effect' && propertyKey === 'effects' && 'effects' in node) {
            // TODO: Implement effect variable binding
            return;
        }
        if ('setBoundVariable' in node) {
            try {
                node.setBoundVariable(propertyKey, variable);
            }
            catch (e) {
                // Some properties may not be bindable
            }
        }
    });
}
function handleGetNodeInfo(nodeIds, bindingKey) {
    return __awaiter(this, void 0, void 0, function* () {
        var nodeInfo = [];
        for (var i = 0; i < nodeIds.length; i++) {
            try {
                var node = yield figma.getNodeByIdAsync(nodeIds[i]);
                if (node) {
                    nodeInfo.push({
                        id: node.id,
                        name: node.name,
                        type: node.type
                    });
                }
                else {
                    nodeInfo.push({
                        id: nodeIds[i],
                        name: '(deleted)',
                        type: 'UNKNOWN'
                    });
                }
            }
            catch (err) {
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
    });
}
function refreshVariableCaches() {
    return __awaiter(this, void 0, void 0, function* () {
        variableCache.clear();
        collectionCache.clear();
        var variables = yield figma.variables.getLocalVariablesAsync();
        var collections = yield figma.variables.getLocalVariableCollectionsAsync();
        for (var i = 0; i < variables.length; i++) {
            variableCache.set(variables[i].id, variables[i]);
        }
        for (var i = 0; i < collections.length; i++) {
            collectionCache.set(collections[i].id, collections[i]);
        }
    });
}
// ============================================================================
// Auto-scan on startup
// ============================================================================
(function () {
    return __awaiter(this, void 0, void 0, function* () {
        yield handleScanSelection();
        sendHistoryUpdate();
    });
})();
