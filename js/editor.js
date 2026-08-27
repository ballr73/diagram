// editor.js — HTML Diagram App

// ============================================================
// State
// ============================================================
const state = {
    nodes: new Map(), // id → {id, x, y, width, height, label, shape}
    edges: new Map(), // id → {id, from, to, label, waypoints:[{id,x,y}]}
    lines: new Map(), // id → {id, x1, y1, x2, y2, waypoints, label, stroke, ...}
    annotations: new Map(), // id → {id, x, y, text}
    groups: new Map(), // id → {id, memberIds:[]}
    layers: [], // [{id, name, visible}] — per-tab layer stack
    activeLayerId: null, // id of the layer new shapes are placed on
    tabs: [],
    activeTabIndex: 0,
    selected: new Set(),
    selectedWaypoint: null, // {edgeId?, lineId?, waypointId} — waypoint focused for deletion
    tool: 'select',
    currentShape: 'box',
    nextId: 1,
    history: [],
    historyIndex: -1,
    clipboard: { nodes: [], edges: [], lines: [], annotations: [], groups: [] },
    pasteOffset: 0,
    zoom: 1.0,
    viewCenterX: 0,
    viewCenterY: 0,
    diagramName: null, // null = unsaved/new; string = last saved filename (without .json)
    dirty: false, // true when there are unsaved changes
    snapToGrid: false, // snap shapes to grid when dragging
    presentationMode: false, // true while in presentation mode (read-only, chrome hidden)
};

/** Snap a value to the nearest grid point (only when snap is enabled). */
function snapVal(v) {
    return state.snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : v;
}

function createTab(name) {
    return {
        name,
        nodes: new Map(),
        edges: new Map(),
        lines: new Map(),
        annotations: new Map(),
        groups: new Map(),
        layers: [{ id: 'layer-1', name: 'Background', visible: true, locked: false }],
        activeLayerId: 'layer-1',
        history: [],
        historyIndex: -1,
        nextId: 1,
        zoom: 1.0,
        viewCenterX: 0,
        viewCenterY: 0,
        selected: new Set(),
        selectedWaypoint: null,
    };
}

function flushTabState() {
    const tab = state.tabs[state.activeTabIndex];
    if (!tab) return;
    tab.historyIndex = state.historyIndex;
    tab.nextId = state.nextId;
    tab.zoom = state.zoom;
    tab.viewCenterX = state.viewCenterX;
    tab.viewCenterY = state.viewCenterY;
    tab.selectedWaypoint = state.selectedWaypoint;
    tab.layers = state.layers;
    tab.activeLayerId = state.activeLayerId;
}

function loadTabToLiveState(index) {
    const tab = state.tabs[index];
    if (!tab) return;
    state.activeTabIndex = index;
    state.nodes = tab.nodes;
    state.edges = tab.edges;
    state.lines = tab.lines;
    state.annotations = tab.annotations;
    state.groups = tab.groups;
    state.layers = tab.layers;
    state.activeLayerId = tab.activeLayerId;
    state.history = tab.history;
    state.historyIndex = tab.historyIndex;
    state.nextId = tab.nextId;
    state.zoom = tab.zoom;
    state.viewCenterX = tab.viewCenterX;
    state.viewCenterY = tab.viewCenterY;
    state.selected = tab.selected;
    state.selectedWaypoint = tab.selectedWaypoint;
    renderLayersPanel();
}

function genId() {
    return `id-${state.nextId++}`;
}

/**
 * Ensures a tab has a valid layers array and that every element has a layerId.
 * Called after loading any tab data (localStorage, file open, import).
 * @param {object} tab - The tab object to fix up.
 * @param {Array|null} savedLayers - Layers array from the saved data (may be null/undefined).
 * @param {string|null} savedActiveLayerId - Active layer ID from saved data.
 */
function ensureLayerIds(tab, savedLayers, savedActiveLayerId) {
    if (savedLayers && savedLayers.length > 0) {
        tab.layers = savedLayers.map((l) => ({ ...l }));
        tab.activeLayerId =
            savedActiveLayerId &&
            tab.layers.some((l) => l.id === savedActiveLayerId)
                ? savedActiveLayerId
                : tab.layers[0].id;
    } else {
        tab.layers = [{ id: 'layer-1', name: 'Background', visible: true, locked: false }];
        tab.activeLayerId = 'layer-1';
    }
    // Backward compat: ensure locked field exists on all layers
    tab.layers.forEach((l) => { if (l.locked === undefined) l.locked = false; });
    const defaultId = tab.layers[0].id;
    // Assign default layer to any element that doesn't have one
    for (const node of tab.nodes.values()) {
        if (!node.layerId) node.layerId = defaultId;
    }
    for (const edge of tab.edges.values()) {
        if (!edge.layerId) edge.layerId = defaultId;
    }
    for (const line of tab.lines.values()) {
        if (!line.layerId) line.layerId = defaultId;
    }
    for (const ann of tab.annotations.values()) {
        if (!ann.layerId) ann.layerId = defaultId;
    }
}

/** Returns true if the layer with the given id is visible (defaults true if layer not found). */
function isLayerVisible(layerId) {
    const layer = state.layers.find((l) => l.id === layerId);
    return layer ? layer.visible : true;
}

/** Returns true if the layer with the given id is locked (defaults false if layer not found). */
function isLayerLocked(layerId) {
    const layer = state.layers.find((l) => l.id === layerId);
    return layer ? !!layer.locked : false;
}

// ============================================================
// History (snapshot-based undo/redo)
// ============================================================
function snapshot() {
    return {
        nodes: new Map([...state.nodes].map(([k, v]) => [k, { ...v }])),
        edges: new Map(
            [...state.edges].map(([k, v]) => [
                k,
                {
                    ...v,
                    waypoints: (v.waypoints || []).map((wp) => ({ ...wp })),
                },
            ]),
        ),
        lines: new Map(
            [...state.lines].map(([k, v]) => [
                k,
                {
                    ...v,
                    waypoints: (v.waypoints || []).map((wp) => ({ ...wp })),
                },
            ]),
        ),
        annotations: new Map(
            [...state.annotations].map(([k, v]) => [k, { ...v }]),
        ),
        groups: new Map(
            [...state.groups].map(([k, v]) => [
                k,
                { ...v, memberIds: [...v.memberIds] },
            ]),
        ),
        nextId: state.nextId,
        layers: state.layers.map((l) => ({ ...l })),
        activeLayerId: state.activeLayerId,
    };
}

function pushHistory() {
    // Truncate redo branch, add current state, cap at 100
    state.history.splice(state.historyIndex + 1);
    state.history.push(snapshot());
    if (state.history.length > 100) state.history.shift();
    state.historyIndex = state.history.length - 1;
    if (state.tabs[state.activeTabIndex]) {
        state.tabs[state.activeTabIndex].historyIndex = state.historyIndex;
    }
    saveToLocalStorage();
    syncUndoRedoMenu();
    state.dirty = true;
    updateTitleDisplay();
}

// ============================================================
// localStorage persistence
// ============================================================
const LS_KEY = 'diagram-editor';

function saveToLocalStorage() {
    try {
        flushTabState();
        const data = {
            version: 2,
            diagramName: state.diagramName,
            snapToGrid: state.snapToGrid,
            activeTabIndex: state.activeTabIndex,
            tabs: state.tabs.map((tab) => ({
                name: tab.name,
                nodes: [...tab.nodes.values()],
                edges: [...tab.edges.values()],
                lines: [...tab.lines.values()],
                annotations: [...tab.annotations.values()],
                groups: [...tab.groups.values()],
                layers: tab.layers || [],
                activeLayerId: tab.activeLayerId || null,
                nextId: tab.nextId,
                zoom: tab.zoom,
                viewCenterX: tab.viewCenterX,
                viewCenterY: tab.viewCenterY,
            })),
        };
        localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (_) {
        // Storage full or unavailable — silently ignore
    }
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (typeof data.version === 'undefined') return false;

        if (data.tabs) {
            state.tabs = data.tabs.map((td, i) => {
                const tab = createTab(td.name || `tab-${i + 1}`);
                (td.nodes || []).forEach((n) => tab.nodes.set(n.id, { ...n }));
                (td.edges || []).forEach((e) =>
                    tab.edges.set(e.id, {
                        ...e,
                        waypoints: (e.waypoints || []).map((wp) => ({ ...wp })),
                    }),
                );
                (td.lines || []).forEach((l) =>
                    tab.lines.set(l.id, {
                        ...l,
                        waypoints: (l.waypoints || []).map((wp) => ({ ...wp })),
                    }),
                );
                (td.annotations || []).forEach((a) =>
                    tab.annotations.set(a.id, { ...a }),
                );
                (td.groups || []).forEach((g) =>
                    tab.groups.set(g.id, {
                        ...g,
                        memberIds: [...(g.memberIds || [])],
                    }),
                );
                if (td.nextId) tab.nextId = td.nextId;
                if (td.zoom != null) tab.zoom = td.zoom;
                if (td.viewCenterX != null) tab.viewCenterX = td.viewCenterX;
                if (td.viewCenterY != null) tab.viewCenterY = td.viewCenterY;
                ensureLayerIds(tab, td.layers, td.activeLayerId);
                return tab;
            });
            if (!state.tabs.length) state.tabs = [createTab('tab-1')];
            const activeIdx = Math.min(
                data.activeTabIndex || 0,
                state.tabs.length - 1,
            );
            loadTabToLiveState(activeIdx);
        } else {
            const tab = createTab('tab-1');
            state.tabs = [tab];
            tab.nodes.clear();
            tab.edges.clear();
            tab.lines.clear();
            tab.annotations.clear();
            tab.selected.clear();
            tab.selectedWaypoint = null;
            (data.nodes || []).forEach((n) => tab.nodes.set(n.id, { ...n }));
            (data.edges || []).forEach((e) =>
                tab.edges.set(e.id, {
                    ...e,
                    waypoints: (e.waypoints || []).map((wp) => ({ ...wp })),
                }),
            );
            (data.lines || []).forEach((l) =>
                tab.lines.set(l.id, {
                    ...l,
                    waypoints: (l.waypoints || []).map((wp) => ({ ...wp })),
                }),
            );
            (data.annotations || []).forEach((a) =>
                tab.annotations.set(a.id, { ...a }),
            );
            if (data.nextId) tab.nextId = data.nextId;
            ensureLayerIds(tab, null, null);
            loadTabToLiveState(0);
        }
        if (data.diagramName) state.diagramName = data.diagramName;
        if (data.snapToGrid != null) state.snapToGrid = data.snapToGrid;
        state.dirty = false;
        return true;
    } catch (_) {
        return false;
    }
}

function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    if (state.tabs[state.activeTabIndex]) {
        state.tabs[state.activeTabIndex].historyIndex = state.historyIndex;
    }
    restoreSnapshot(state.history[state.historyIndex]);
    updateToolbarStatus();
    syncUndoRedoMenu();
}

function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    if (state.tabs[state.activeTabIndex]) {
        state.tabs[state.activeTabIndex].historyIndex = state.historyIndex;
    }
    restoreSnapshot(state.history[state.historyIndex]);
    updateToolbarStatus();
    syncUndoRedoMenu();
}

function restoreSnapshot(snap) {
    state.nodes.clear();
    [...snap.nodes].forEach(([k, v]) => state.nodes.set(k, { ...v }));
    state.edges.clear();
    [...snap.edges].forEach(([k, v]) =>
        state.edges.set(k, {
            ...v,
            waypoints: (v.waypoints || []).map((wp) => ({ ...wp })),
        }),
    );
    state.lines.clear();
    [...(snap.lines || [])].forEach(([k, v]) =>
        state.lines.set(k, {
            ...v,
            waypoints: (v.waypoints || []).map((wp) => ({ ...wp })),
        }),
    );
    state.annotations.clear();
    [...snap.annotations].forEach(([k, v]) =>
        state.annotations.set(k, { ...v }),
    );
    state.groups.clear();
    [...(snap.groups || [])].forEach(([k, v]) =>
        state.groups.set(k, { ...v, memberIds: [...(v.memberIds || [])] }),
    );
    state.nextId = snap.nextId;
    if (snap.layers) {
        state.layers = snap.layers.map((l) => ({ ...l }));
        state.activeLayerId = snap.activeLayerId;
        if (state.tabs[state.activeTabIndex]) {
            state.tabs[state.activeTabIndex].layers = state.layers;
            state.tabs[state.activeTabIndex].activeLayerId = state.activeLayerId;
        }
    }
    if (state.tabs[state.activeTabIndex]) {
        state.tabs[state.activeTabIndex].nextId = state.nextId;
        state.tabs[state.activeTabIndex].selectedWaypoint = null;
    }
    state.selected.clear();
    state.selectedWaypoint = null;
    render();
    renderLayersPanel();
    updatePropertiesPanel();
}

// ============================================================
// JSON Serialization — Open / Save
// ============================================================
function newDiagram() {
    const hasContent =
        state.tabs.some(
            (t) =>
                t.nodes.size > 0 ||
                t.edges.size > 0 ||
                t.lines.size > 0 ||
                t.annotations.size > 0,
        ) ||
        state.nodes.size > 0 ||
        state.edges.size > 0 ||
        state.lines.size > 0 ||
        state.annotations.size > 0;
    if (
        hasContent &&
        !window.confirm('Discard current diagram and start a new one?')
    )
        return;

    const firstTab = createTab('tab-1');
    state.tabs = [firstTab];
    state.activeTabIndex = 0;
    loadTabToLiveState(0);
    state.diagramName = null;
    state.dirty = false;
    drag = null;
    panDrag = null;
    clearInlineEditor();
    if (uiLayer) uiLayer.innerHTML = '';
    if (svg)
        svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
    pushHistory();
    state.dirty = false;
    render();
    updateViewBox();
    syncZoomSelect();
    updatePropertiesPanel();
    updateToolbarStatus();
    updateTitleDisplay();
    renderTabBar();
    saveToLocalStorage();
}

// Save a Blob to disk. Uses showSaveFilePicker when available (Chrome/Edge);
// falls back to anchor-click download for Safari and Firefox.
// Returns the actual filename saved, or null if the user cancelled.
async function saveBlob(blob, suggestedName, types) {
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName,
                types,
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return handle.name;
        } catch (err) {
            if (err.name === 'AbortError') return null; // user cancelled
            console.warn(
                'showSaveFilePicker failed, falling back to download:',
                err,
            );
        }
    }
    // Legacy anchor-click fallback (Safari, Firefox, or picker failure)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    return suggestedName;
}

async function saveDiagram() {
    const baseName = state.diagramName || 'diagram';
    if (typeof window.showSaveFilePicker !== 'function') {
        // Fallback browsers (Safari, Firefox) — always prompt for name
        const input = window.prompt('Save as:', baseName);
        if (input === null) return;
        await _doSave((input.trim() || 'diagram').replace(/\.json$/i, ''));
    } else {
        await _doSave(baseName); // picker dialog handles naming
    }
}

async function _doSave(baseName) {
    flushTabState();
    const filename = baseName + '.json';
    const blob = buildDiagramBlob();

    const savedName = await saveBlob(blob, filename, [
        {
            description: 'JSON Diagram',
            accept: { 'application/json': ['.json'] },
        },
    ]);
    if (savedName === null) return; // cancelled

    state.diagramName = savedName.replace(/\.json$/i, '');
    state.dirty = false;
    updateTitleDisplay();
    saveToLocalStorage();
}

function buildDiagramBlob() {
    flushTabState();
    const data = {
        version: 2,
        tabs: state.tabs.map((tab) => ({
            name: tab.name,
            nodes: [...tab.nodes.values()],
            edges: [...tab.edges.values()],
            lines: [...tab.lines.values()],
            annotations: [...tab.annotations.values()],
            groups: [...tab.groups.values()],
            layers: tab.layers || [],
            activeLayerId: tab.activeLayerId || null,
            zoom: tab.zoom,
            viewCenterX: tab.viewCenterX,
            viewCenterY: tab.viewCenterY,
        })),
    };
    return new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
    });
}

function importDiagram(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            importDiagramData(data, file.name);
        } catch (err) {
            alert('Import failed: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function importDiagramData(data, filename) {
    if (typeof data.version === 'undefined')
        throw new Error('Missing version field');
    const loadTabData = (tab, td) => {
        (td.nodes || []).forEach((n) => tab.nodes.set(n.id, { ...n }));
        (td.edges || []).forEach((e) =>
            tab.edges.set(e.id, {
                ...e,
                waypoints: (e.waypoints || []).map((wp) => ({ ...wp })),
            }),
        );
        (td.lines || []).forEach((l) =>
            tab.lines.set(l.id, {
                ...l,
                waypoints: (l.waypoints || []).map((wp) => ({ ...wp })),
            }),
        );
        (td.annotations || []).forEach((a) =>
            tab.annotations.set(a.id, { ...a }),
        );
        (td.groups || []).forEach((g) =>
            tab.groups.set(g.id, { ...g, memberIds: [...(g.memberIds || [])] }),
        );
        const allNums = [
            ...tab.nodes.keys(),
            ...tab.edges.keys(),
            ...tab.lines.keys(),
            ...tab.annotations.keys(),
        ]
            .map((id) => parseInt(id.replace('id-', ''), 10))
            .filter((n) => !isNaN(n));
        tab.nextId = allNums.length > 0 ? Math.max(...allNums) + 1 : 1;
        if (td.zoom != null) tab.zoom = td.zoom;
        if (td.viewCenterX != null) tab.viewCenterX = td.viewCenterX;
        if (td.viewCenterY != null) tab.viewCenterY = td.viewCenterY;
    };

    if (data.tabs) {
        state.tabs = data.tabs.map((td, i) => {
            const tab = createTab(td.name || `tab-${i + 1}`);
            loadTabData(tab, td);
            ensureLayerIds(tab, td.layers, td.activeLayerId);
            return tab;
        });
        if (!state.tabs.length) state.tabs = [createTab('tab-1')];
        loadTabToLiveState(0);
    } else {
        const tab = createTab('tab-1');
        loadTabData(tab, data);
        ensureLayerIds(tab, null, null);
        state.tabs = [tab];
        loadTabToLiveState(0);
    }

    state.diagramName = (
        typeof filename === 'string'
            ? filename
            : (filename && filename.name) || 'diagram'
    ).replace(/\.json$/i, '');
    updateTitleDisplay();
    pushHistory();
    state.dirty = false;
    render();
    updateViewBox();
    syncZoomSelect();
    updatePropertiesPanel();
    updateToolbarStatus();
    renderTabBar();
}

// ============================================================
// SVG / PNG Export helpers
// ============================================================

/** CSS rules to embed inside an exported standalone SVG file. */
function getSVGEmbedStyles() {
    return `
    .node-shape { fill: var(--node-fill, #ffffff); stroke: var(--node-stroke, #475569); stroke-width: 1.5; }
    .node-label  { fill: #1e293b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .edge-hit    { display: none; }
    .edge-line   { stroke-width: 1.5; fill: none; }
    .edge-label  { fill: #475569; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .edge-label-bg  { fill: #f8fafc; stroke: none; }
    .waypoint-handle { display: none; }
    .annotation-text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .annotation-bg   { fill: none; stroke: none; }
    .annotation-selection { display: none; }
    .annotation-text { fill: #7c3aed; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .arrow-fill     { fill: currentColor; }
    .arrow-fill-sel { fill: currentColor; }
    .line-sym-fill     { fill: currentColor; }
    .line-sym-fill-sel { fill: currentColor; }
    .line-endpoint-handle { display: none; }
  `;
}

// Cache of iconPath → SVG data URI (populated from manifest at startup)
const iconDataURICache = new Map();

/**
 * Look up a data URI for an icon path.
 * Data URIs are pre-populated from window.ICON_MANIFEST at panel-build time,
 * so no fetch/XHR/canvas is needed — works under file:// protocol.
 * Returns a Promise<string|null> for compatibility with existing callers.
 */
function loadIconAsDataURI(iconPath) {
    return Promise.resolve(iconDataURICache.get(iconPath) || null);
}

/** Pre-cache data URIs for every symbol node currently in the diagram. */
function cacheAllSymbolIcons() {
    const paths = new Set();
    for (const tab of state.tabs) {
        for (const node of tab.nodes.values()) {
            if (node.type === 'symbol' && node.iconPath)
                paths.add(node.iconPath);
        }
    }
    return Promise.all([...paths].map(loadIconAsDataURI));
}

/**
 * Build a clean, self-contained SVG string for export.
 * Symbol <image> elements are replaced with embedded base64 data URIs so the
 * exported file is fully self-contained (no external file dependencies).
 * Returns a Promise<string>.
 */
async function buildExportSVG() {
    const PADDING = 40;

    // Embed icon images as data URIs before cloning
    await cacheAllSymbolIcons();

    // Compute content bounding box
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const n of state.nodes.values()) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
    }
    for (const a of state.annotations.values()) {
        minX = Math.min(minX, a.x);
        minY = Math.min(minY, a.y - 16); // approx text ascent
        maxX = Math.max(maxX, a.x + 300); // approx text width
        maxY = Math.max(maxY, a.y + 10);
    }
    for (const l of state.lines.values()) {
        const pts = linePoints(l);
        for (const pt of pts) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
        }
    }
    if (!isFinite(minX)) {
        minX = 0;
        minY = 0;
        maxX = 500;
        maxY = 400;
    }

    const viewX = minX - PADDING;
    const viewY = minY - PADDING;
    const viewW = maxX - minX + PADDING * 2;
    const viewH = maxY - minY + PADDING * 2;

    // Render without selection so the DOM clone has clean styling
    const savedSelected = new Set(state.selected);
    state.selected.clear();
    render();

    // Clone the live SVG
    const srcSvg = document.getElementById('canvas');
    const clone = srcSvg.cloneNode(true);

    // Restore selection and re-render
    state.selected.clear();
    savedSelected.forEach((id) => state.selected.add(id));
    render();

    // Strip interactive-only content from clone
    const uiLayer = clone.querySelector('#ui-layer');
    if (uiLayer) uiLayer.innerHTML = '';
    clone.querySelectorAll('.resize-handle').forEach((el) => el.remove());
    clone.querySelectorAll('.line-endpoint-handle').forEach((el) => el.remove());
    // Remove grid background from exports
    const gridBg = clone.querySelector('#grid-bg');
    if (gridBg) gridBg.remove();

    // Replace icon <image> hrefs with embedded data URIs
    clone.querySelectorAll('image').forEach((imgEl) => {
        const href =
            imgEl.getAttribute('href') ||
            imgEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (href && !href.startsWith('data:')) {
            const dataURI = iconDataURICache.get(href);
            if (dataURI) {
                imgEl.setAttribute('href', dataURI);
                imgEl.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
            }
        }
    });

    // Set dimensions and viewBox
    clone.setAttribute('width', String(viewW));
    clone.setAttribute('height', String(viewH));
    clone.setAttribute('viewBox', `${viewX} ${viewY} ${viewW} ${viewH}`);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.removeAttribute('style'); // remove 100%/100% sizing

    // White background rect (inserted before the first layer group)
    const ns = 'http://www.w3.org/2000/svg';
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('x', String(viewX));
    bg.setAttribute('y', String(viewY));
    bg.setAttribute('width', String(viewW));
    bg.setAttribute('height', String(viewH));
    bg.setAttribute('fill', '#ffffff');
    const defs = clone.querySelector('defs');
    // Embed CSS inside defs
    const styleEl = document.createElementNS(ns, 'style');
    styleEl.textContent = getSVGEmbedStyles();
    defs.appendChild(styleEl);
    // Insert background after defs
    defs.insertAdjacentElement('afterend', bg);

    return new XMLSerializer().serializeToString(clone);
}

async function exportSVG() {
    const svgString = await buildExportSVG();
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const name = state.diagramName || 'diagram';
    await saveBlob(blob, name + '.svg', [
        { description: 'SVG Image', accept: { 'image/svg+xml': ['.svg'] } },
    ]);
}

async function exportPNG() {
    const svgString = await buildExportSVG();

    // Parse width/height from the SVG for canvas sizing
    const match = svgString.match(/width="([^"]+)"\s+height="([^"]+)"/);
    const scale = window.devicePixelRatio || 1;
    const w = match ? parseFloat(match[1]) : 800;
    const h = match ? parseFloat(match[2]) : 600;

    const svgBlob = new Blob([svgString], {
        type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(svgBlob);

    const pngBlob = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = w * scale;
            canvas.height = h * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            canvas.toBlob(resolve, 'image/png');
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image load failed'));
        };
        img.src = url;
    }).catch(() => null);

    if (!pngBlob) {
        alert('PNG export failed. Try SVG export instead.');
        return;
    }

    const name = state.diagramName || 'diagram';
    await saveBlob(pngBlob, name + '.png', [
        { description: 'PNG Image', accept: { 'image/png': ['.png'] } },
    ]);
}

// ============================================================
// Geometry
// ============================================================
function nodeCenter(node) {
    return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

/** Vertices of polygonal shapes (diamond, triangle, parallelogram). Returns null for others. */
function shapeVertices(node) {
    const { x, y, width: w, height: h } = node;
    const cx = x + w / 2,
        cy = y + h / 2;
    switch (node.shape) {
        case 'diamond':
            return [
                { x: cx, y },
                { x: x + w, y: cy },
                { x: cx, y: y + h },
                { x, y: cy },
            ];
        case 'triangle':
            return [
                { x: cx, y },
                { x: x + w, y: y + h },
                { x, y: y + h },
            ];
        case 'parallelogram': {
            const sk = w * 0.2;
            return [
                { x: x + sk, y },
                { x: x + w, y },
                { x: x + w - sk, y: y + h },
                { x, y: y + h },
            ];
        }
        case 'merge':
            return [
                { x, y },
                { x: x + w, y },
                { x: cx, y: y + h },
            ];
        default:
            return null;
    }
}

/** Intersection of ray from (cx,cy) toward (px,py) with an ellipse of semi-axes (rx,ry). */
function ellipseIntersect(cx, cy, rx, ry, px, py) {
    const dx = px - cx,
        dy = py - cy;
    if (dx === 0 && dy === 0) return { x: cx + rx, y: cy };
    const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    return { x: cx + dx * t, y: cy + dy * t };
}

/** Intersection of ray from (cx,cy) toward (px,py) with a polygon defined by vertices[]. */
function rayPolygonIntersect(cx, cy, px, py, vertices) {
    const dx = px - cx,
        dy = py - cy;
    let bestT = Infinity;
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
        const v1 = vertices[i],
            v2 = vertices[(i + 1) % n];
        const ex = v2.x - v1.x,
            ey = v2.y - v1.y;
        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 1e-10) continue;
        const fx = v1.x - cx,
            fy = v1.y - cy;
        const t = (fx * ey - fy * ex) / denom;
        const s = (fx * dy - fy * dx) / denom;
        if (t > 1e-6 && s >= -1e-6 && s <= 1 + 1e-6 && t < bestT) bestT = t;
    }
    if (bestT === Infinity) return { x: px, y: py };
    return { x: cx + dx * bestT, y: cy + dy * bestT };
}

/** Intersection of the line from node center toward point p with the node's actual shape boundary. */
function borderIntersect(node, p) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const shape = node.shape || 'box';

    if (shape === 'circle' || shape === 'oval') {
        return ellipseIntersect(
            cx,
            cy,
            node.width / 2,
            node.height / 2,
            p.x,
            p.y,
        );
    }

    const verts = shapeVertices(node);
    if (verts) return rayPolygonIntersect(cx, cy, p.x, p.y, verts);

    // Default: bounding-box rectangle (box shape)
    const hw = node.width / 2,
        hh = node.height / 2;
    const dx = p.x - cx,
        dy = p.y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: cx + dx * t, y: cy + dy * t };
}

function getNodeAt(x, y) {
    // Iterate in reverse so topmost (last rendered) is hit first
    const entries = [...state.nodes.entries()];
    for (let i = entries.length - 1; i >= 0; i--) {
        const [, node] = entries[i];
        if (!isLayerVisible(node.layerId)) continue;
        if (isLayerLocked(node.layerId)) continue;
        if (
            x >= node.x &&
            x <= node.x + node.width &&
            y >= node.y &&
            y <= node.y + node.height
        ) {
            return node;
        }
    }
    return null;
}

function getAnnotationAt(x, y, layer = null) {
    const entries = [...state.annotations.entries()];
    for (let i = entries.length - 1; i >= 0; i--) {
        const [, ann] = entries[i];
        if (!isLayerVisible(ann.layerId)) continue;
        if (isLayerLocked(ann.layerId)) continue;
        if (layer !== null) {
            const annLayer = ann.zLayer === 'bg' ? 'bg' : 'fg';
            if (annLayer !== layer) continue;
        }
        const bb = annBBox(ann);
        const pad = 4;
        if (
            x >= bb.x - pad &&
            x <= bb.x + bb.w + pad &&
            y >= bb.y - pad &&
            y <= bb.y + bb.h + pad
        ) {
            return ann;
        }
    }
    return null;
}

const ANN_DEFAULT_MAX_WIDTH = 300;

/**
 * Word-wrap `text` into lines that fit within `maxWidth` pixels.
 * Explicit \n line breaks are always honoured.
 */
function wrapTextToLines(text, maxWidth, fontSize) {
    const charWidth = fontSize * 0.6;
    const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));
    const rawLines = (text || '').split('\n');
    const result = [];
    for (const rawLine of rawLines) {
        if (!rawLine) {
            result.push('');
            continue;
        }
        const words = rawLine.split(' ');
        let current = '';
        for (const word of words) {
            const test = current ? current + ' ' + word : word;
            if (test.length <= maxChars) {
                current = test;
            } else {
                if (current) result.push(current);
                // Word longer than max — push as-is rather than lose it
                current = word;
            }
        }
        if (current !== '') result.push(current);
    }
    return result.length ? result : [''];
}

/** Estimated (or explicit) bounding box for an annotation, accounting for wrapping and alignment. */
function annBBox(ann) {
    const fontSize = ann.fontSize || 13;
    const lineHeight = fontSize * 1.4;
    const charWidth = fontSize * 0.6;

    // Width: explicit > auto-from-text (capped at default max)
    const rawLines = (ann.text || 'Text').split('\n');
    const autoW = Math.max(
        40,
        Math.max(...rawLines.map((l) => (l || '').length)) * charWidth,
    );
    const w = ann.width || Math.min(autoW, ANN_DEFAULT_MAX_WIDTH);

    // Height: explicit > derived from wrapped line count
    const wrappedLines = wrapTextToLines(ann.text || 'Text', w, fontSize);
    const h = ann.height || wrappedLines.length * lineHeight;

    const align = ann.align || 'left';
    let x;
    if (align === 'center') x = ann.x - w / 2;
    else if (align === 'right') x = ann.x - w;
    else x = ann.x;
    return { x, y: ann.y - fontSize, w, h };
}

function getEdgeAt(x, y, threshold = 8) {
    for (const edge of state.edges.values()) {
        if (!isLayerVisible(edge.layerId)) continue;
        if (isLayerLocked(edge.layerId)) continue;
        const pts = edgePoints(edge);
        if (!pts) continue;
        for (let i = 0; i < pts.length - 1; i++) {
            if (
                segmentDist(
                    x,
                    y,
                    pts[i].x,
                    pts[i].y,
                    pts[i + 1].x,
                    pts[i + 1].y,
                ) < threshold
            )
                return edge;
        }
    }
    return null;
}

/** Returns the ordered list of points for an edge: [p1, ...waypoints, p2] */
function edgePoints(edge) {
    const from = state.nodes.get(edge.from);
    const to = state.nodes.get(edge.to);
    if (!from || !to) return null;
    const wps = edge.waypoints || [];
    // Determine aim targets for borderIntersect, honouring anchor offsets
    let fromAim, toAim;
    if (edge.fromAnchorOffset) {
        const fc = nodeCenter(from);
        fromAim = { x: fc.x + edge.fromAnchorOffset.dx, y: fc.y + edge.fromAnchorOffset.dy };
    } else {
        fromAim = wps.length > 0 ? wps[0] : nodeCenter(to);
    }
    if (edge.toAnchorOffset) {
        const tc = nodeCenter(to);
        toAim = { x: tc.x + edge.toAnchorOffset.dx, y: tc.y + edge.toAnchorOffset.dy };
    } else {
        toAim = wps.length > 0 ? wps[wps.length - 1] : nodeCenter(from);
    }
    const p1 = borderIntersect(from, fromAim);
    const p2 = borderIntersect(to, toAim);
    return [p1, ...wps, p2];
}

/** Returns the point at 50% of the total arc length of a polyline. */
function pathMidpoint(pts) {
    let total = 0;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        segs.push(d);
        total += d;
    }
    let rem = total / 2;
    for (let i = 0; i < segs.length; i++) {
        if (rem <= segs[i] || i === segs.length - 1) {
            const t = segs[i] > 0 ? rem / segs[i] : 0;
            return {
                x: pts[i].x + t * (pts[i + 1].x - pts[i].x),
                y: pts[i].y + t * (pts[i + 1].y - pts[i].y),
            };
        }
        rem -= segs[i];
    }
    return pts[Math.floor(pts.length / 2)];
}

// ── Curved connector helpers ──────────────────────────────────────────────

/**
 * Convert an ordered array of points to an SVG cubic Bézier path string
 * using Catmull-Rom parameterisation.  Each waypoint "pulls" the curve
 * through it; dragging a waypoint reshapes the curve.
 */
function catmullRomToPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x},${p2.y}`;
    }
    return d;
}

/**
 * Build an SVG path `d` string for a connector.
 * curved=true → Catmull-Rom spline; curved=false → straight polyline-as-path.
 */
function buildPathD(pts, curved) {
    if (pts.length < 2) return '';
    if (!curved) return 'M ' + pts.map((p) => `${p.x},${p.y}`).join(' L ');
    return catmullRomToPath(pts);
}

/**
 * Sample the Catmull-Rom curve defined by pts at ~40 points and return
 * the point at 50% arc length.  Used for label placement on curved connectors.
 */
function curvedMidpoint(pts) {
    if (pts.length < 2) return pts[0] || { x: 0, y: 0 };
    // Sample the curve by evaluating cubic Bézier segments
    const samples = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        const steps = 20;
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const u = 1 - t;
            samples.push({
                x:
                    u * u * u * p1.x +
                    3 * u * u * t * cp1x +
                    3 * u * t * t * cp2x +
                    t * t * t * p2.x,
                y:
                    u * u * u * p1.y +
                    3 * u * u * t * cp1y +
                    3 * u * t * t * cp2y +
                    t * t * t * p2.y,
            });
        }
    }
    return pathMidpoint(samples);
}

function segmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1,
        dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(
        0,
        Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq),
    );
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Returns resize handle name ('n','s','e','w','ne','nw','se','sw') or null */
function getResizeHandle(node, x, y, threshold = 6) {
    const handles = [
        { name: 'nw', x: node.x, y: node.y },
        { name: 'n', x: node.x + node.width / 2, y: node.y },
        { name: 'ne', x: node.x + node.width, y: node.y },
        { name: 'e', x: node.x + node.width, y: node.y + node.height / 2 },
        { name: 'se', x: node.x + node.width, y: node.y + node.height },
        { name: 's', x: node.x + node.width / 2, y: node.y + node.height },
        { name: 'sw', x: node.x, y: node.y + node.height },
        { name: 'w', x: node.x, y: node.y + node.height / 2 },
    ];
    for (const h of handles) {
        if (Math.abs(x - h.x) <= threshold && Math.abs(y - h.y) <= threshold)
            return h.name;
    }
    return null;
}

function getAnnResizeHandle(ann, x, y, threshold = 6) {
    const bb = annBBox(ann);
    const handles = [
        { name: 'nw', x: bb.x, y: bb.y },
        { name: 'n', x: bb.x + bb.w / 2, y: bb.y },
        { name: 'ne', x: bb.x + bb.w, y: bb.y },
        { name: 'e', x: bb.x + bb.w, y: bb.y + bb.h / 2 },
        { name: 'se', x: bb.x + bb.w, y: bb.y + bb.h },
        { name: 's', x: bb.x + bb.w / 2, y: bb.y + bb.h },
        { name: 'sw', x: bb.x, y: bb.y + bb.h },
        { name: 'w', x: bb.x, y: bb.y + bb.h / 2 },
    ];
    for (const h of handles) {
        if (Math.abs(x - h.x) <= threshold && Math.abs(y - h.y) <= threshold)
            return h.name;
    }
    return null;
}

// ============================================================
// Rendering
// ============================================================
let svg, linesLayer, shapesLayer, annotationsLayer, bgAnnotationsLayer, uiLayer;

function initSVG() {
    svg = document.getElementById('canvas');
    linesLayer = document.getElementById('lines-layer');
    shapesLayer = document.getElementById('shapes-layer');
    annotationsLayer = document.getElementById('annotations-layer');
    bgAnnotationsLayer = document.getElementById('bg-annotations-layer');
    uiLayer = document.getElementById('ui-layer');
}

function svgEl(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    }
    if (text != null) el.textContent = text;
    return el;
}

function render() {
    renderAll();
    renderGroupSelection();
}

/** Draw dashed bounding boxes around selected groups in the UI layer. */
function renderGroupSelection() {
    // Remove any existing group selection rects
    if (!uiLayer) return;
    uiLayer.querySelectorAll('.group-selection').forEach((el) => el.remove());

    for (const id of state.selected) {
        const group = state.groups.get(id);
        if (!group) continue;
        const b = groupBounds(group);
        if (!isFinite(b.x)) continue;
        const pad = 8;
        const rect = svgEl('rect', {
            x: b.x - pad,
            y: b.y - pad,
            width: b.w + pad * 2,
            height: b.h + pad * 2,
            class: 'group-selection',
        });
        uiLayer.appendChild(rect);
    }
}

/**
 * Apply font style properties as inline style on an SVG text element.
 * defaults: { size, bold, italic, underline }
 */
function applyFontStyle(el, item, defaults = {}) {
    const size =
        item.fontSize !== undefined ? item.fontSize : defaults.size || 13;
    const bold =
        item.fontBold !== undefined ? item.fontBold : defaults.bold || false;
    const italic =
        item.fontItalic !== undefined
            ? item.fontItalic
            : defaults.italic || false;
    const underline =
        item.fontUnderline !== undefined
            ? item.fontUnderline
            : defaults.underline || false;
    el.style.fontSize = size + 'px';
    el.style.fontWeight = bold ? 'bold' : 'normal';
    el.style.fontStyle = italic ? 'italic' : 'normal';
    el.style.textDecoration = underline ? 'underline' : 'none';
}

/** Apply stroke-dasharray and stroke-linecap for a given strokeStyle. */
function applyStrokeStyle(el, style) {
    switch (style) {
        case 'dashed':
            el.style.strokeDasharray = '8 4';
            el.style.strokeLinecap = 'square';
            break;
        case 'dotted':
            el.style.strokeDasharray = '2 4';
            el.style.strokeLinecap = 'round';
            break;
        default: // solid
            el.style.strokeDasharray = 'none';
            el.style.strokeLinecap = 'square';
    }
}

/** Create the correct SVG shape element for a node. */
function createShapeEl(node, sel) {
    const { x, y, width: w, height: h } = node;
    const cx = x + w / 2,
        cy = y + h / 2;
    const cls = 'node-shape' + (sel ? ' selected' : '');
    let el;
    switch (node.shape || 'box') {
        case 'circle':
            el = svgEl('ellipse', { cx, cy, rx: w / 2, ry: h / 2, class: cls });
            break;
        case 'oval':
            el = svgEl('ellipse', { cx, cy, rx: w / 2, ry: h / 2, class: cls });
            break;
        case 'diamond': {
            const pts = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
            el = svgEl('polygon', { points: pts, class: cls });
            break;
        }
        case 'triangle': {
            const pts = `${cx},${y} ${x + w},${y + h} ${x},${y + h}`;
            el = svgEl('polygon', { points: pts, class: cls });
            break;
        }
        case 'parallelogram': {
            const sk = w * 0.2;
            const pts = `${x + sk},${y} ${x + w},${y} ${x + w - sk},${y + h} ${x},${y + h}`;
            el = svgEl('polygon', { points: pts, class: cls });
            break;
        }
        case 'document': {
            // Rectangle body with a wavy bottom edge (one full wave)
            const waveH = Math.max(6, h * 0.12);
            const by = y + h - waveH; // y of wave baseline
            const d = `M ${x},${y} L ${x + w},${y} L ${x + w},${by}` +
                      ` C ${x + w * 0.75},${by} ${x + w * 0.75},${y + h} ${x + w * 0.5},${y + h}` +
                      ` C ${x + w * 0.25},${y + h} ${x + w * 0.25},${by} ${x},${by} Z`;
            el = svgEl('path', { d, class: cls });
            break;
        }
        case 'database': {
            // Cylinder: top ellipse + body rect + bottom arc
            const ry = Math.max(4, h * 0.15);
            const d = `M ${x},${y + ry}` +
                      ` A ${w / 2},${ry} 0 0 1 ${x + w},${y + ry}` +
                      ` L ${x + w},${y + h - ry}` +
                      ` A ${w / 2},${ry} 0 0 1 ${x},${y + h - ry} Z` +
                      ` M ${x},${y + ry}` +
                      ` A ${w / 2},${ry} 0 0 0 ${x + w},${y + ry}`;
            el = svgEl('path', { d, class: cls });
            break;
        }
        case 'wait': {
            // D-shape: straight left/top/bottom, bezier-curved right edge
            const cr = Math.min(w * 0.55, h * 0.55);
            const d = `M ${x},${y} L ${x + w - cr},${y}` +
                      ` C ${x + w + cr * 0.2},${y} ${x + w + cr * 0.2},${y + h} ${x + w - cr},${y + h}` +
                      ` L ${x},${y + h} Z`;
            el = svgEl('path', { d, class: cls });
            break;
        }
        case 'merge': {
            const pts = `${x},${y} ${x + w},${y} ${cx},${y + h}`;
            el = svgEl('polygon', { points: pts, class: cls });
            break;
        }
        default: // box
            el = svgEl('rect', {
                x,
                y,
                width: w,
                height: h,
                rx: 4,
                ry: 4,
                class: cls,
            });
            break;
    }
    // Apply custom colours via CSS custom properties (overridden by !important on selected state)
    if (node.fill) el.style.setProperty('--node-fill', node.fill);
    if (node.stroke) el.style.setProperty('--node-stroke', node.stroke);
    return el;
}

/**
 * Compute SVG label coordinates from node.labelPos.
 * Positions: tl/tm/tr/ml/mm/mr/bl/bm/br
 * Default: 'mm' for regular nodes, 'bm' for symbol nodes.
 */
function getLabelCoords(node) {
    const pos = node.labelPos || (node.type === 'symbol' ? 'bm' : 'mm');
    const PAD = 6;
    const { x, y, width, height } = node;
    const row = pos[0]; // 't', 'm', 'b'
    const col = pos[1]; // 'l', 'm', 'r'

    let lx, textAnchor;
    if (col === 'l') {
        lx = x + PAD;
        textAnchor = 'start';
    } else if (col === 'r') {
        lx = x + width - PAD;
        textAnchor = 'end';
    } else {
        lx = x + width / 2;
        textAnchor = 'middle';
    }

    let ly, dominantBaseline;
    if (row === 't') {
        ly = y + PAD;
        dominantBaseline = 'hanging';
    } else if (row === 'b') {
        if (node.type === 'symbol') {
            ly = y + height + 8; // below icon with small gap
            dominantBaseline = 'hanging';
        } else {
            ly = y + height - PAD;
            dominantBaseline = 'auto';
        }
    } else {
        ly = y + height / 2;
        dominantBaseline = 'middle';
    }
    return { x: lx, y: ly, textAnchor, dominantBaseline };
}

/** Build and return an SVG <g> for a single node (does not append to DOM). */
function renderNodeGroup(node) {
    const sel = state.selected.has(node.id);
    const g = svgEl('g', { 'data-id': node.id, 'data-type': 'node' });
    if (isLayerLocked(node.layerId)) g.classList.add('layer-locked');

    if (node.type === 'symbol') {
        // Symbol node: SVG image + selection outline + label
        const img = svgEl('image', {
            href: node.iconPath,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            preserveAspectRatio: 'xMidYMid meet',
        });
        g.appendChild(img);

        if (sel) {
            const outline = svgEl('rect', {
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height,
                class: 'node-shape selected',
                fill: 'none',
            });
            g.appendChild(outline);
        }

        if (node.label) {
            const coords = getLabelCoords(node);
            const fontSize = 11;
            const lbl = svgEl('text', {
                x: coords.x,
                y: coords.y,
                'text-anchor': coords.textAnchor,
                'dominant-baseline': coords.dominantBaseline,
                class: 'node-label',
            });
            applyFontStyle(lbl, node, { size: fontSize });
            const lines = (node.label || '').split('\n');
            if (lines.length === 1) {
                lbl.textContent = node.label;
            } else {
                lines.forEach((line, i) => {
                    lbl.appendChild(
                        svgEl(
                            'tspan',
                            {
                                x: coords.x,
                                dy: i === 0 ? '0' : `${fontSize * 1.3}`,
                            },
                            line,
                        ),
                    );
                });
            }
            g.appendChild(lbl);
        }
    } else {
        const shapeEl = createShapeEl(node, sel);
        shapeEl.style.fillOpacity = (node.opacity ?? 100) / 100;
        applyStrokeStyle(shapeEl, node.strokeStyle);
        g.appendChild(shapeEl);

        const coords = getLabelCoords(node);
        const lbl = svgEl('text', {
            x: coords.x,
            y: coords.y,
            'text-anchor': coords.textAnchor,
            'dominant-baseline': coords.dominantBaseline,
            class: 'node-label',
        });
        lbl.textContent = node.label || '';
        applyFontStyle(lbl, node, { size: 13 });
        g.appendChild(lbl);
    }

    // Resize handles (only when selected in select mode)
    if (sel && state.tool === 'select') {
        const handles = [
            { name: 'nw', x: node.x, y: node.y },
            { name: 'n', x: node.x + node.width / 2, y: node.y },
            { name: 'ne', x: node.x + node.width, y: node.y },
            { name: 'e', x: node.x + node.width, y: node.y + node.height / 2 },
            { name: 'se', x: node.x + node.width, y: node.y + node.height },
            { name: 's', x: node.x + node.width / 2, y: node.y + node.height },
            { name: 'sw', x: node.x, y: node.y + node.height },
            { name: 'w', x: node.x, y: node.y + node.height / 2 },
        ];
        for (const h of handles) {
            g.appendChild(
                svgEl('rect', {
                    x: h.x - 4,
                    y: h.y - 4,
                    width: 8,
                    height: 8,
                    class: 'resize-handle',
                    'data-handle': h.name,
                }),
            );
        }
    }

    return g;
}

/** Build and return an SVG <g> for a single edge (returns null if endpoints missing). */
function renderEdgeGroup(edge) {
    const pts = edgePoints(edge);
    if (!pts) return null;
    const sel = state.selected.has(edge.id);
    const dir = edge.direction || 'forward';
    const curved = edge.curveStyle === 'curved';

    const g = svgEl('g', { 'data-id': edge.id, 'data-type': 'edge' });
    if (isLayerLocked(state.nodes.get(edge.from)?.layerId)) g.classList.add('layer-locked');

    const defaultStroke = '#64748b';
    const selStroke = '#2563eb';
    const strokeColor = sel ? selStroke : edge.stroke || defaultStroke;
    const strokeWidth = sel ? '2' : '1.5';
    const endUrl = sel ? 'url(#arrowhead-sel)' : 'url(#arrowhead)';
    const startUrl = sel
        ? 'url(#arrowhead-start-sel)'
        : 'url(#arrowhead-start)';

    if (curved) {
        const pathD = buildPathD(pts, true);

        // Wide invisible hit area
        const hitPath = svgEl('path', { d: pathD, class: 'edge-hit' });
        g.appendChild(hitPath);

        const pathAttrs = {
            d: pathD,
            class: 'edge-line' + (sel ? ' selected' : ''),
            fill: 'none',
        };
        if (dir === 'forward' || dir === 'both')
            pathAttrs['marker-end'] = endUrl;
        if (dir === 'back' || dir === 'both')
            pathAttrs['marker-start'] = startUrl;

        const lineEl = svgEl('path', pathAttrs);
        lineEl.style.stroke = strokeColor;
        lineEl.style.strokeWidth = strokeWidth;
        lineEl.style.color = strokeColor;
        applyStrokeStyle(lineEl, edge.strokeStyle);
        g.appendChild(lineEl);

        if (edge.label) {
            const mid = curvedMidpoint(pts);
            const lblEl = svgEl(
                'text',
                {
                    x: mid.x,
                    y: mid.y - 5,
                    'text-anchor': 'middle',
                    class: 'edge-label',
                },
                edge.label,
            );
            applyFontStyle(lblEl, edge, { size: 11 });
            g.appendChild(lblEl);
        }
    } else {
        const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');

        // Wide invisible hit area
        g.appendChild(
            svgEl('polyline', { points: pointsStr, class: 'edge-hit' }),
        );

        const lineAttrs = {
            points: pointsStr,
            class: 'edge-line' + (sel ? ' selected' : ''),
        };
        if (dir === 'forward' || dir === 'both')
            lineAttrs['marker-end'] = endUrl;
        if (dir === 'back' || dir === 'both')
            lineAttrs['marker-start'] = startUrl;

        const lineEl = svgEl('polyline', lineAttrs);
        lineEl.style.stroke = strokeColor;
        lineEl.style.strokeWidth = strokeWidth;
        lineEl.style.color = strokeColor;
        applyStrokeStyle(lineEl, edge.strokeStyle);
        g.appendChild(lineEl);

        if (edge.label) {
            const mid = pathMidpoint(pts);
            const lblEl = svgEl(
                'text',
                {
                    x: mid.x,
                    y: mid.y - 5,
                    'text-anchor': 'middle',
                    class: 'edge-label',
                },
                edge.label,
            );
            applyFontStyle(lblEl, edge, { size: 11 });
            g.appendChild(lblEl);
        }
    }

    if (sel && edge.waypoints && edge.waypoints.length > 0) {
        for (const wp of edge.waypoints) {
            g.appendChild(
                svgEl('circle', {
                    cx: wp.x,
                    cy: wp.y,
                    r: 5,
                    class: 'waypoint-handle',
                    'data-wp-id': wp.id,
                }),
            );
        }
    }

    // Endpoint anchor handles (always shown when selected)
    if (sel && pts && pts.length >= 2) {
        const p1 = pts[0];
        const p2 = pts[pts.length - 1];
        g.appendChild(svgEl('circle', { cx: p1.x, cy: p1.y, r: 6, class: 'edge-endpoint-handle', 'data-which': 'from' }));
        g.appendChild(svgEl('circle', { cx: p2.x, cy: p2.y, r: 6, class: 'edge-endpoint-handle', 'data-which': 'to' }));
    }

    return g;
}

/**
 * Unified render pass: sorts ALL visible elements (nodes, edges, lines,
 * annotations) by (layerIndex, withinLayerZ) and appends them all to
 * shapesLayer. Higher layer index = rendered on top. Within the same layer,
 * Map insertion order determines Z. bg-annotations always render at the back
 * of their layer; fg-annotations (default) render at the front.
 *
 * The old separate linesLayer / annotationsLayer / bgAnnotationsLayer <g>
 * elements are cleared but no longer written to — all content goes into
 * shapesLayer so that inter-layer ordering works correctly.
 */
function renderAll() {
    shapesLayer.innerHTML = '';
    linesLayer.innerHTML = '';
    annotationsLayer.innerHTML = '';
    bgAnnotationsLayer.innerHTML = '';

    // Build layerIdx lookup (position in state.layers = Z priority; last = top)
    const layerIndex = new Map();
    (state.layers || []).forEach((l, i) => layerIndex.set(l.id, i));
    const getLayerIdx = (layerId) => layerIndex.get(layerId) ?? 0;

    // Per-layer, per-type counters for within-layer Z (Map insertion order)
    const layerTypeCounter = new Map();
    const nextZ = (layerId, type) => {
        const key = `${layerId || 'layer-1'}:${type}`;
        const z = layerTypeCounter.get(key) ?? 0;
        layerTypeCounter.set(key, z + 1);
        return z;
    };

    // Pre-compute per-layer node Z (edges need it to inherit their node's Z)
    const nodeLayerZ = new Map();
    for (const node of state.nodes.values()) {
        nodeLayerZ.set(node.id, nextZ(node.layerId, 'node'));
    }

    const items = [];

    for (const node of state.nodes.values()) {
        if (!isLayerVisible(node.layerId)) continue;
        items.push({ kind: 'node', item: node,
            layerIdx: getLayerIdx(node.layerId),
            withinZ: nodeLayerZ.get(node.id) ?? 0 });
    }
    for (const edge of state.edges.values()) {
        if (!isLayerVisible(edge.layerId)) continue;
        const lid = edge.layerId || 'layer-1';
        const fNode = state.nodes.get(edge.from);
        const tNode = state.nodes.get(edge.to);
        const fz = (fNode && (fNode.layerId || 'layer-1') === lid) ? (nodeLayerZ.get(edge.from) ?? 0) : 0;
        const tz = (tNode && (tNode.layerId || 'layer-1') === lid) ? (nodeLayerZ.get(edge.to) ?? 0) : 0;
        items.push({ kind: 'edge', item: edge,
            layerIdx: getLayerIdx(lid),
            withinZ: Math.max(fz, tz) });
    }
    for (const line of state.lines.values()) {
        if (!isLayerVisible(line.layerId)) continue;
        items.push({ kind: 'line', item: line,
            layerIdx: getLayerIdx(line.layerId),
            withinZ: nextZ(line.layerId, 'line') });
    }
    for (const ann of state.annotations.values()) {
        if (!isLayerVisible(ann.layerId)) continue;
        const isBg = ann.zLayer === 'bg';
        items.push({ kind: 'annotation', item: ann,
            layerIdx: getLayerIdx(ann.layerId),
            withinZ: isBg ? -1 : nextZ(ann.layerId, 'ann'),
            isBg });
    }

    // Sort ascending: layerIdx (back→front), then withinZ, then type rank
    // Type rank within same (layerIdx, withinZ): edge < node < line < fg-annotation
    const typeRank = { edge: 0, node: 1, line: 2, annotation: 3 };
    items.sort((a, b) => {
        if (a.layerIdx !== b.layerIdx) return a.layerIdx - b.layerIdx;
        if (a.withinZ !== b.withinZ) return a.withinZ - b.withinZ;
        // bg annotations always before everything else in same layer/Z
        if (a.isBg && !b.isBg) return -1;
        if (!a.isBg && b.isBg) return 1;
        return (typeRank[a.kind] ?? 1) - (typeRank[b.kind] ?? 1);
    });

    for (const { kind, item } of items) {
        let g;
        if (kind === 'node') g = renderNodeGroup(item);
        else if (kind === 'edge') g = renderEdgeGroup(item);
        else if (kind === 'line') g = renderLineGroup(item);
        else if (kind === 'annotation') g = renderAnnotationGroup(item);
        if (g) shapesLayer.appendChild(g);
    }
}

/** Build and return a <g> SVG element for a single line. */
function renderLineGroup(line) {
    const sel = state.selected.has(line.id);
    const curved = line.curveStyle === 'curved';
    const pts = linePoints(line);
    const defaultStroke = '#64748b';
    const selStroke = '#2563eb';
    const strokeColor = sel ? selStroke : line.stroke || defaultStroke;
    const strokeWidth = sel ? '2' : '1.5';

    const startSym = line.startSymbol || 'none';
    const endSym = line.endSymbol || 'none';

    const g = svgEl('g', { 'data-id': line.id, 'data-type': 'line' });
    if (isLayerLocked(line.layerId)) g.classList.add('layer-locked');

    if (curved) {
        const pathD = buildPathD(pts, true);
        g.appendChild(svgEl('path', { d: pathD, class: 'edge-hit' }));
        const pathAttrs = {
            d: pathD,
            class: 'edge-line' + (sel ? ' selected' : ''),
            fill: 'none',
        };
        if (startSym !== 'none')
            pathAttrs['marker-start'] = sel ? `url(#${startSym}-marker-sel)` : `url(#${startSym}-marker)`;
        if (endSym !== 'none')
            pathAttrs['marker-end'] = sel ? `url(#${endSym}-marker-sel)` : `url(#${endSym}-marker)`;
        const lineEl = svgEl('path', pathAttrs);
        lineEl.style.stroke = strokeColor;
        lineEl.style.strokeWidth = strokeWidth;
        lineEl.style.color = strokeColor;
        applyStrokeStyle(lineEl, line.strokeStyle);
        g.appendChild(lineEl);
        if (line.label) {
            const mid = curvedMidpoint(pts);
            const lblEl = svgEl('text', { x: mid.x, y: mid.y - 5, 'text-anchor': 'middle', class: 'edge-label' }, line.label);
            applyFontStyle(lblEl, line, { size: 11 });
            g.appendChild(lblEl);
        }
    } else {
        const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
        g.appendChild(svgEl('polyline', { points: pointsStr, class: 'edge-hit' }));
        const lineAttrs = {
            points: pointsStr,
            class: 'edge-line' + (sel ? ' selected' : ''),
        };
        if (startSym !== 'none')
            lineAttrs['marker-start'] = sel ? `url(#${startSym}-marker-sel)` : `url(#${startSym}-marker)`;
        if (endSym !== 'none')
            lineAttrs['marker-end'] = sel ? `url(#${endSym}-marker-sel)` : `url(#${endSym}-marker)`;
        const lineEl = svgEl('polyline', lineAttrs);
        lineEl.style.stroke = strokeColor;
        lineEl.style.strokeWidth = strokeWidth;
        lineEl.style.color = strokeColor;
        applyStrokeStyle(lineEl, line.strokeStyle);
        g.appendChild(lineEl);
        if (line.label) {
            const mid = pathMidpoint(pts);
            const lblEl = svgEl('text', { x: mid.x, y: mid.y - 5, 'text-anchor': 'middle', class: 'edge-label' }, line.label);
            applyFontStyle(lblEl, line, { size: 11 });
            g.appendChild(lblEl);
        }
    }

    if (sel) {
        if (line.waypoints && line.waypoints.length > 0) {
            for (const wp of line.waypoints) {
                g.appendChild(svgEl('circle', { cx: wp.x, cy: wp.y, r: 5, class: 'waypoint-handle', 'data-wp-id': wp.id }));
            }
        }
        g.appendChild(svgEl('circle', { cx: line.x1, cy: line.y1, r: 5, class: 'line-endpoint-handle', 'data-which': 'start' }));
        g.appendChild(svgEl('circle', { cx: line.x2, cy: line.y2, r: 5, class: 'line-endpoint-handle', 'data-which': 'end' }));
    }
    return g;
}

/** Build and return a <g> SVG element for a single annotation. */
function renderAnnotationGroup(ann) {
    const sel = state.selected.has(ann.id);
    const fontSize = ann.fontSize || 13;
    const lineHeight = fontSize * 1.4;
    const align = ann.align || 'left';
    const textAnchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const pad = 6;
    const bb = annBBox(ann);

    const g = svgEl('g', { 'data-id': ann.id, 'data-type': 'annotation' });
    if (isLayerLocked(ann.layerId)) g.classList.add('layer-locked');

    if (ann.fill || ann.stroke) {
        const rect = svgEl('rect', {
            x: bb.x - pad, y: bb.y - pad,
            width: bb.w + pad * 2, height: bb.h + pad * 2,
            rx: 3, ry: 3, class: 'annotation-bg',
        });
        if (ann.fill) {
            rect.style.fill = ann.fill;
            rect.style.fillOpacity = (ann.fillOpacity ?? 100) / 100;
        }
        if (ann.stroke) {
            rect.style.stroke = ann.stroke;
            rect.style.strokeWidth = '1.5';
            applyStrokeStyle(rect, ann.strokeStyle);
        }
        g.appendChild(rect);
    }

    if (sel) {
        g.appendChild(svgEl('rect', {
            x: bb.x - pad, y: bb.y - pad,
            width: bb.w + pad * 2, height: bb.h + pad * 2,
            rx: 3, ry: 3, class: 'annotation-selection',
        }));
        const handles = [
            { name: 'nw', x: bb.x - pad, y: bb.y - pad },
            { name: 'n',  x: bb.x + bb.w / 2, y: bb.y - pad },
            { name: 'ne', x: bb.x + bb.w + pad, y: bb.y - pad },
            { name: 'e',  x: bb.x + bb.w + pad, y: bb.y + bb.h / 2 },
            { name: 'se', x: bb.x + bb.w + pad, y: bb.y + bb.h + pad },
            { name: 's',  x: bb.x + bb.w / 2, y: bb.y + bb.h + pad },
            { name: 'sw', x: bb.x - pad, y: bb.y + bb.h + pad },
            { name: 'w',  x: bb.x - pad, y: bb.y + bb.h / 2 },
        ];
        for (const h of handles) {
            g.appendChild(svgEl('rect', { x: h.x - 4, y: h.y - 4, width: 8, height: 8, class: 'resize-handle', 'data-handle': h.name }));
        }
    }

    const textEl = svgEl('text', { x: ann.x, y: ann.y, 'text-anchor': textAnchor, class: 'annotation-text' });
    textEl.style.fill = ann.color || '#7c3aed';
    applyFontStyle(textEl, ann, { size: 13, italic: true });

    const wrappedLines = wrapTextToLines(ann.text || '', bb.w, fontSize);
    wrappedLines.forEach((line, i) => {
        const tspan = svgEl('tspan', { x: ann.x, dy: i === 0 ? '0' : `${lineHeight}` }, line || '\u200b');
        textEl.appendChild(tspan);
    });
    g.appendChild(textEl);
    return g;
}

/** Returns polyline points for a line: [start, ...waypoints, end]. */
function linePoints(line) {
    const pts = [{ x: line.x1, y: line.y1 }];
    if (line.waypoints) pts.push(...line.waypoints);
    pts.push({ x: line.x2, y: line.y2 });
    return pts;
}

function getLineAt(x, y, threshold = 8) {
    for (const line of state.lines.values()) {
        if (!isLayerVisible(line.layerId)) continue;
        if (isLayerLocked(line.layerId)) continue;
        const pts = linePoints(line);
        for (let i = 0; i < pts.length - 1; i++) {
            if (
                segmentDist(
                    x,
                    y,
                    pts[i].x,
                    pts[i].y,
                    pts[i + 1].x,
                    pts[i + 1].y,
                ) < threshold
            )
                return line;
        }
    }
    return null;
}

// ============================================================
// Interaction — drag state machine
// ============================================================
let drag = null; // Active draw/move/resize drag descriptor
let panDrag = null; // Active pan descriptor (right-mouse-button)

function svgCoords(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

/**
 * Hit-test at (x, y). Returns:
 *   {type:'resize', handle, nodeId, node}
 *   {type:'ann-resize', handle, annId, ann}
 *   {type:'line-endpoint', which, lineId}
 *   {type:'waypoint', edgeId, waypointId}
 *   {type:'line-waypoint', lineId, waypointId}
 *   {type:'node', id, node}
 *   {type:'edge', id, edge}
 *   {type:'line', id, line}
 *   {type:'annotation', id, ann}
 *   {type:'canvas'}
 */
function hitTest(x, y) {
    if (state.tool === 'select') {
        for (const node of state.nodes.values()) {
            if (!state.selected.has(node.id)) continue;
            const h = getResizeHandle(node, x, y);
            if (h) return { type: 'resize', handle: h, nodeId: node.id, node };
        }
        // Annotation resize handles (checked before waypoints / body hits)
        for (const id of state.selected) {
            const ann = state.annotations.get(id);
            if (!ann) continue;
            const h = getAnnResizeHandle(ann, x, y);
            if (h) return { type: 'ann-resize', handle: h, annId: id, ann };
        }
        // Line endpoint handles (when line is selected)
        for (const lineId of state.selected) {
            const line = state.lines.get(lineId);
            if (!line) continue;
            if (Math.hypot(x - line.x1, y - line.y1) <= 7)
                return { type: 'line-endpoint', which: 'start', lineId };
            if (Math.hypot(x - line.x2, y - line.y2) <= 7)
                return { type: 'line-endpoint', which: 'end', lineId };
        }
        // Edge endpoint (anchor) handles (when edge is selected and not on locked layer)
        for (const selId of state.selected) {
            const edge = state.edges.get(selId);
            if (!edge) continue;
            const fromNode = state.nodes.get(edge.from);
            if (fromNode && isLayerLocked(fromNode.layerId)) continue;
            const pts = edgePoints(edge);
            if (!pts || pts.length < 2) continue;
            const p1 = pts[0], p2 = pts[pts.length - 1];
            if (Math.hypot(x - p1.x, y - p1.y) <= 8)
                return { type: 'edge-endpoint', edgeId: selId, which: 'from' };
            if (Math.hypot(x - p2.x, y - p2.y) <= 8)
                return { type: 'edge-endpoint', edgeId: selId, which: 'to' };
        }
        // Waypoint handles on selected edges and lines
        for (const selId of state.selected) {
            const edge = state.edges.get(selId);
            if (edge && edge.waypoints) {
                for (const wp of edge.waypoints) {
                    if (Math.hypot(x - wp.x, y - wp.y) <= 7)
                        return {
                            type: 'waypoint',
                            edgeId: selId,
                            waypointId: wp.id,
                        };
                }
            }
            const line = state.lines.get(selId);
            if (line && line.waypoints) {
                for (const wp of line.waypoints) {
                    if (Math.hypot(x - wp.x, y - wp.y) <= 7)
                        return {
                            type: 'line-waypoint',
                            lineId: selId,
                            waypointId: wp.id,
                        };
                }
            }
        }
    }
    // Hit-test in visual z-order (top to bottom):
    // 1. fg annotations (annotations-layer — above shapes)
    const fgAnn = getAnnotationAt(x, y, 'fg');
    if (fgAnn) {
        if (fgAnn.groupId) return { type: 'group', id: fgAnn.groupId };
        return { type: 'annotation', id: fgAnn.id, ann: fgAnn };
    }
    // 2. lines (lines-layer — above shapes)
    const line = getLineAt(x, y);
    if (line) return { type: 'line', id: line.id, line };
    // 3. nodes then edges (shapes-layer — interleaved by z-order)
    const node = getNodeAt(x, y);
    if (node) {
        if (node.groupId) return { type: 'group', id: node.groupId };
        return { type: 'node', id: node.id, node };
    }
    const edge = getEdgeAt(x, y);
    if (edge) return { type: 'edge', id: edge.id, edge };
    // 4. bg annotations (bg-annotations-layer — below shapes)
    const bgAnn = getAnnotationAt(x, y, 'bg');
    if (bgAnn) {
        if (bgAnn.groupId) return { type: 'group', id: bgAnn.groupId };
        return { type: 'annotation', id: bgAnn.id, ann: bgAnn };
    }
    return { type: 'canvas' };
}

function onMouseDown(e) {
    // Right-click: start pan (allowed even in presentation mode)
    if (e.button === 2) {
        e.preventDefault();
        panDrag = {
            startScreenX: e.clientX,
            startScreenY: e.clientY,
            startCenterX: state.viewCenterX,
            startCenterY: state.viewCenterY,
        };
        svg.style.cursor = 'grabbing';
        return;
    }

    // Block all left-click editing in presentation mode
    if (state.presentationMode) return;

    if (e.button !== 0) return;
    e.preventDefault();
    const p = svgCoords(e);
    const hit = hitTest(p.x, p.y);

    switch (state.tool) {
        case 'select':
            selectMouseDown(p, hit, e);
            break;
        case 'box':
            boxMouseDown(p);
            break;
        case 'connector':
            connectorMouseDown(p, hit);
            break;
        case 'line':
            lineMouseDown(p);
            break;
        case 'text':
            textMouseDown(p, hit);
            break;
    }
}

function onMouseMove(e) {
    // Pan takes priority
    if (panDrag) {
        state.viewCenterX =
            panDrag.startCenterX -
            (e.clientX - panDrag.startScreenX) / state.zoom;
        state.viewCenterY =
            panDrag.startCenterY -
            (e.clientY - panDrag.startScreenY) / state.zoom;
        updateViewBox();
        return;
    }

    const p = svgCoords(e);
    if (!drag) {
        updateCursor(p);
        return;
    }
    dragMove(p);
}

function onMouseUp(e) {
    // End pan on right-button release
    if (e.button === 2 && panDrag) {
        panDrag = null;
        svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
        return;
    }

    if (!drag) return;
    const p = svgCoords(e);
    dragEnd(p);
}

// --- Select tool ---
function selectMouseDown(p, hit, e) {
    if (hit.type === 'resize') {
        const node = hit.node;
        drag = {
            type: 'resize',
            handle: hit.handle,
            nodeId: hit.nodeId,
            startX: p.x,
            startY: p.y,
            orig: { x: node.x, y: node.y, w: node.width, h: node.height },
            moved: false,
        };
        return;
    }

    if (hit.type === 'ann-resize') {
        const bb = annBBox(hit.ann);
        drag = {
            type: 'resize-ann',
            handle: hit.handle,
            annId: hit.annId,
            startX: p.x,
            startY: p.y,
            orig: { x: bb.x, y: bb.y, w: bb.w, h: bb.h },
            moved: false,
        };
        return;
    }

    if (hit.type === 'waypoint') {
        state.selectedWaypoint = {
            edgeId: hit.edgeId,
            waypointId: hit.waypointId,
        };
        drag = {
            type: 'move-waypoint',
            edgeId: hit.edgeId,
            waypointId: hit.waypointId,
            moved: false,
        };
        return;
    }

    if (hit.type === 'line-waypoint') {
        state.selectedWaypoint = {
            lineId: hit.lineId,
            waypointId: hit.waypointId,
        };
        drag = {
            type: 'move-waypoint',
            lineId: hit.lineId,
            waypointId: hit.waypointId,
            moved: false,
        };
        return;
    }

    if (hit.type === 'line-endpoint') {
        state.selectedWaypoint = null;
        drag = {
            type: 'move-line-endpoint',
            lineId: hit.lineId,
            which: hit.which,
            moved: false,
        };
        return;
    }

    if (hit.type === 'edge-endpoint') {
        state.selectedWaypoint = null;
        drag = {
            type: 'move-edge-endpoint',
            edgeId: hit.edgeId,
            which: hit.which,
            moved: false,
        };
        return;
    }

    if (hit.type === 'node') {
        state.selectedWaypoint = null;
        if (e.shiftKey) {
            state.selected.add(hit.id);
        } else if (!state.selected.has(hit.id)) {
            state.selected.clear();
            state.selected.add(hit.id);
        }
        render();
        updatePropertiesPanel();
        drag = startMoveDrag(p);
        return;
    }

    if (hit.type === 'edge') {
        state.selectedWaypoint = null;
        if (!e.shiftKey) state.selected.clear();
        state.selected.add(hit.id);
        render();
        updatePropertiesPanel();
        return; // edges aren't draggable
    }

    if (hit.type === 'line') {
        state.selectedWaypoint = null;
        if (e.shiftKey) {
            state.selected.add(hit.id);
        } else if (!state.selected.has(hit.id)) {
            state.selected.clear();
            state.selected.add(hit.id);
        }
        render();
        updatePropertiesPanel();
        const ln = hit.line;
        drag = {
            type: 'move-line',
            lineId: hit.id,
            startX: p.x,
            startY: p.y,
            origX1: ln.x1,
            origY1: ln.y1,
            origX2: ln.x2,
            origY2: ln.y2,
            origWaypoints: (ln.waypoints || []).map((wp) => ({ ...wp })),
            moved: false,
        };
        return;
    }

    if (hit.type === 'annotation') {
        state.selectedWaypoint = null;
        if (e.shiftKey) {
            state.selected.add(hit.id);
        } else if (!state.selected.has(hit.id)) {
            state.selected.clear();
            state.selected.add(hit.id);
        }
        render();
        updatePropertiesPanel();
        drag = startMoveDrag(p);
        return;
    }

    if (hit.type === 'group') {
        state.selectedWaypoint = null;
        if (e.shiftKey) {
            state.selected.add(hit.id);
        } else if (!state.selected.has(hit.id)) {
            state.selected.clear();
            state.selected.add(hit.id);
        }
        render();
        updatePropertiesPanel();
        drag = startMoveDrag(p);
        return;
    }

    // Canvas: start rubber-band selection
    state.selectedWaypoint = null;
    if (!e.shiftKey) {
        state.selected.clear();
        render();
        updatePropertiesPanel();
    }
    drag = { type: 'rubber', startX: p.x, startY: p.y };
}

// --- Box tool ---
function boxMouseDown(p) {
    if (isLayerLocked(state.activeLayerId)) return;
    const sx = snapVal(p.x), sy = snapVal(p.y);
    drag = { type: 'draw-box', startX: sx, startY: sy };
    uiLayer.appendChild(
        svgEl('rect', {
            id: 'tmp',
            class: 'temp-shape',
            x: sx,
            y: sy,
            width: 0,
            height: 0,
        }),
    );
}

// --- Connector tool ---
function connectorMouseDown(p, hit) {
    if (isLayerLocked(state.activeLayerId)) return;
    const node = getNodeAt(p.x, p.y);
    if (!node) return;
    drag = { type: 'draw-edge', fromId: node.id, startX: p.x, startY: p.y };
    const fc = nodeCenter(node);
    uiLayer.appendChild(
        svgEl('line', {
            id: 'tmp',
            class: 'temp-connector',
            x1: fc.x,
            y1: fc.y,
            x2: fc.x,
            y2: fc.y,
        }),
    );
}

// --- Line tool ---
function lineMouseDown(p) {
    if (isLayerLocked(state.activeLayerId)) return;
    drag = { type: 'draw-line', startX: p.x, startY: p.y };
    uiLayer.appendChild(
        svgEl('line', {
            id: 'tmp',
            class: 'temp-connector',
            x1: p.x,
            y1: p.y,
            x2: p.x,
            y2: p.y,
        }),
    );
}

// --- Text tool ---
function textMouseDown(p, hit) {
    if (
        hit.type === 'node' ||
        hit.type === 'edge' ||
        hit.type === 'line' ||
        hit.type === 'annotation'
    ) {
        state.selected.clear();
        state.selected.add(hit.id);
        render();
        updatePropertiesPanel();
        startInlineEdit(hit.id, hit.type);
        return;
    }
    // Create annotation on canvas
    if (isLayerLocked(state.activeLayerId)) return;
    const id = genId();
    state.annotations.set(id, { id, x: p.x, y: p.y + 5, text: 'Text', layerId: state.activeLayerId });
    state.selected.clear();
    state.selected.add(id);
    render();
    updatePropertiesPanel();
    startInlineEdit(id, 'annotation');
    pushHistory();
}

// Build the appropriate drag descriptor for a move operation.
// If multiple movable items are selected, returns a move-multi drag.
// Otherwise returns a single-item move-node or move-ann drag.
function startMoveDrag(p) {
    // Expand group IDs to their member node/annotation IDs
    const movable = [];
    for (const id of state.selected) {
        if (state.nodes.has(id) || state.annotations.has(id)) {
            movable.push(id);
        } else if (state.groups.has(id)) {
            const group = state.groups.get(id);
            for (const memberId of group.memberIds) {
                if (
                    state.nodes.has(memberId) ||
                    state.annotations.has(memberId)
                ) {
                    movable.push(memberId);
                }
            }
        }
    }

    if (movable.length > 1) {
        const origins = {};
        for (const id of movable) {
            const item = state.nodes.get(id) || state.annotations.get(id);
            origins[id] = { x: item.x, y: item.y };
        }
        return {
            type: 'move-multi',
            startX: p.x,
            startY: p.y,
            origins,
            moved: false,
        };
    }

    // Single item
    const id = movable[0];
    if (state.nodes.has(id)) {
        const node = state.nodes.get(id);
        return {
            type: 'move-node',
            nodeId: id,
            startX: p.x,
            startY: p.y,
            origX: node.x,
            origY: node.y,
            moved: false,
        };
    }
    const ann = state.annotations.get(id);
    return {
        type: 'move-ann',
        annId: id,
        startX: p.x,
        startY: p.y,
        origX: ann.x,
        origY: ann.y,
        moved: false,
    };
}

// --- Drag move ---
function dragMove(p) {
    if (drag.type === 'move-multi') {
        const dx = p.x - drag.startX,
            dy = p.y - drag.startY;
        for (const [id, orig] of Object.entries(drag.origins)) {
            const item = state.nodes.get(id) || state.annotations.get(id);
            if (item) {
                item.x = snapVal(orig.x + dx);
                item.y = snapVal(orig.y + dy);
            }
        }
        drag.moved = true;
        render();
        return;
    }

    if (drag.type === 'move-waypoint') {
        if (drag.edgeId) {
            const edge = state.edges.get(drag.edgeId);
            if (edge && edge.waypoints) {
                const wp = edge.waypoints.find((w) => w.id === drag.waypointId);
                if (wp) {
                    wp.x = p.x;
                    wp.y = p.y;
                    drag.moved = true;
                    render();
                }
            }
        } else if (drag.lineId) {
            const line = state.lines.get(drag.lineId);
            if (line && line.waypoints) {
                const wp = line.waypoints.find((w) => w.id === drag.waypointId);
                if (wp) {
                    wp.x = p.x;
                    wp.y = p.y;
                    drag.moved = true;
                    render();
                }
            }
        }
        return;
    }

    if (drag.type === 'move-node') {
        const dx = p.x - drag.startX,
            dy = p.y - drag.startY;
        const node = state.nodes.get(drag.nodeId);
        node.x = snapVal(drag.origX + dx);
        node.y = snapVal(drag.origY + dy);
        drag.moved = true;
        render();
        return;
    }

    if (drag.type === 'move-line-endpoint') {
        const line = state.lines.get(drag.lineId);
        if (line) {
            if (drag.which === 'start') {
                line.x1 = p.x;
                line.y1 = p.y;
            } else {
                line.x2 = p.x;
                line.y2 = p.y;
            }
            drag.moved = true;
            render();
        }
        return;
    }

    if (drag.type === 'move-edge-endpoint') {
        const edge = state.edges.get(drag.edgeId);
        if (edge) {
            const nodeId = drag.which === 'from' ? edge.from : edge.to;
            const node = state.nodes.get(nodeId);
            if (node) {
                const c = nodeCenter(node);
                const offset = { dx: p.x - c.x, dy: p.y - c.y };
                if (drag.which === 'from') edge.fromAnchorOffset = offset;
                else edge.toAnchorOffset = offset;
                drag.moved = true;
                render();
            }
        }
        return;
    }

    if (drag.type === 'move-line') {
        const dx = p.x - drag.startX,
            dy = p.y - drag.startY;
        const line = state.lines.get(drag.lineId);
        if (line) {
            line.x1 = drag.origX1 + dx;
            line.y1 = drag.origY1 + dy;
            line.x2 = drag.origX2 + dx;
            line.y2 = drag.origY2 + dy;
            if (line.waypoints) {
                line.waypoints.forEach((wp, i) => {
                    wp.x = drag.origWaypoints[i].x + dx;
                    wp.y = drag.origWaypoints[i].y + dy;
                });
            }
            drag.moved = true;
            render();
        }
        return;
    }

    if (drag.type === 'draw-line') {
        const tmp = document.getElementById('tmp');
        if (tmp) {
            tmp.setAttribute('x2', p.x);
            tmp.setAttribute('y2', p.y);
        }
        return;
    }

    if (drag.type === 'move-ann') {
        const dx = p.x - drag.startX,
            dy = p.y - drag.startY;
        const ann = state.annotations.get(drag.annId);
        ann.x = snapVal(drag.origX + dx);
        ann.y = snapVal(drag.origY + dy);
        drag.moved = true;
        render();
        return;
    }

    if (drag.type === 'resize-ann') {
        applyAnnResize(p);
        drag.moved = true;
        render();
        return;
    }

    if (drag.type === 'resize') {
        applyResize(p);
        drag.moved = true;
        render();
        return;
    }

    if (drag.type === 'draw-box') {
        const tmp = document.getElementById('tmp');
        if (!tmp) return;
        const px = snapVal(p.x), py = snapVal(p.y);
        tmp.setAttribute('x', Math.min(px, drag.startX));
        tmp.setAttribute('y', Math.min(py, drag.startY));
        tmp.setAttribute('width', Math.abs(px - drag.startX));
        tmp.setAttribute('height', Math.abs(py - drag.startY));
        return;
    }

    if (drag.type === 'draw-edge') {
        const tmp = document.getElementById('tmp');
        if (!tmp) return;
        const from = state.nodes.get(drag.fromId);
        if (!from) return;
        const p1 = borderIntersect(from, p);
        tmp.setAttribute('x1', p1.x);
        tmp.setAttribute('y1', p1.y);
        tmp.setAttribute('x2', p.x);
        tmp.setAttribute('y2', p.y);
        // Highlight hovered target
        clearClass('connector-hover');
        const target = getNodeAt(p.x, p.y);
        if (target && target.id !== drag.fromId)
            addClassToNode(target.id, 'connector-hover');
        return;
    }

    if (drag.type === 'rubber') {
        uiLayer.innerHTML = '';
        const x = Math.min(p.x, drag.startX);
        const y = Math.min(p.y, drag.startY);
        const w = Math.abs(p.x - drag.startX);
        const h = Math.abs(p.y - drag.startY);
        uiLayer.appendChild(
            svgEl('rect', {
                x,
                y,
                width: w,
                height: h,
                class: 'selection-box',
            }),
        );
        return;
    }
}

function dragEnd(p) {
    const d = drag;
    drag = null;

    if (d.type === 'move-waypoint') {
        if (d.moved) pushHistory();
        return;
    }

    if (
        d.type === 'move-node' ||
        d.type === 'move-ann' ||
        d.type === 'move-multi'
    ) {
        if (d.moved) pushHistory();
        return;
    }

    if (d.type === 'move-line' || d.type === 'move-line-endpoint') {
        if (d.moved) pushHistory();
        return;
    }

    if (d.type === 'move-edge-endpoint') {
        if (d.moved) pushHistory();
        return;
    }

    if (d.type === 'resize') {
        if (d.moved) pushHistory();
        return;
    }

    if (d.type === 'resize-ann') {
        if (d.moved) {
            pushHistory();
            updatePropertiesPanel();
        }
        return;
    }

    if (d.type === 'draw-box') {
        uiLayer.innerHTML = '';
        const px = snapVal(p.x), py = snapVal(p.y);
        const w = Math.abs(px - d.startX);
        const h = Math.abs(py - d.startY);
        if (w < 20 || h < 10) return;
        const id = genId();
        const shape = state.currentShape;
        const defaultLabels = {
            box: 'Box',
            circle: 'Circle',
            oval: 'Oval',
            diamond: 'Diamond',
            triangle: 'Triangle',
            parallelogram: 'Step',
            document: 'Document',
            database: 'Database',
            wait: 'Wait',
            merge: 'Merge',
        };
        state.nodes.set(id, {
            id,
            x: Math.min(px, d.startX),
            y: Math.min(py, d.startY),
            width: w,
            height: h,
            label: defaultLabels[shape] || 'Shape',
            shape,
            layerId: state.activeLayerId,
        });
        state.selected.clear();
        state.selected.add(id);
        pushHistory();
        render();
        updatePropertiesPanel();
        updateToolbarStatus();
        return;
    }

    if (d.type === 'draw-edge') {
        uiLayer.innerHTML = '';
        clearClass('connector-hover');
        const target = getNodeAt(p.x, p.y);
        if (!target || target.id === d.fromId) return;
        const id = genId();
        state.edges.set(id, {
            id,
            from: d.fromId,
            to: target.id,
            label: '',
            direction: 'forward',
            layerId: state.activeLayerId,
        });
        state.selected.clear();
        state.selected.add(id);
        pushHistory();
        render();
        updatePropertiesPanel();
        updateToolbarStatus();
        return;
    }

    if (d.type === 'draw-line') {
        uiLayer.innerHTML = '';
        if (Math.hypot(p.x - d.startX, p.y - d.startY) < 5) return; // too short
        const id = genId();
        state.lines.set(id, {
            id,
            x1: d.startX,
            y1: d.startY,
            x2: p.x,
            y2: p.y,
            waypoints: [],
            startSymbol: 'none',
            endSymbol: 'none',
            label: '',
            layerId: state.activeLayerId,
        });
        state.selected.clear();
        state.selected.add(id);
        pushHistory();
        render();
        updatePropertiesPanel();
        updateToolbarStatus();
        return;
    }

    if (d.type === 'rubber') {
        uiLayer.innerHTML = '';
        const x1 = Math.min(p.x, d.startX),
            y1 = Math.min(p.y, d.startY);
        const x2 = Math.max(p.x, d.startX),
            y2 = Math.max(p.y, d.startY);
        for (const node of state.nodes.values()) {
            if (isLayerLocked(node.layerId)) continue;
            if (
                node.x >= x1 &&
                node.y >= y1 &&
                node.x + node.width <= x2 &&
                node.y + node.height <= y2
            ) {
                // Select group instead of individual member
                state.selected.add(node.groupId || node.id);
            }
        }
        render();
        updatePropertiesPanel();
        return;
    }
}

function applyResize(p) {
    const node = state.nodes.get(drag.nodeId);
    const { x, y, w, h } = drag.orig;
    const dx = p.x - drag.startX,
        dy = p.y - drag.startY;
    const handle = drag.handle;

    let nx = x,
        ny = y,
        nw = w,
        nh = h;
    if (handle.includes('e')) nw = Math.max(40, snapVal(w + dx));
    if (handle.includes('s')) nh = Math.max(20, snapVal(h + dy));
    if (handle.includes('w')) {
        const snappedX = snapVal(x + dx);
        nx = snappedX;
        nw = Math.max(40, x + w - snappedX);
        if (nw === 40) nx = x + w - 40;
    }
    if (handle.includes('n')) {
        const snappedY = snapVal(y + dy);
        ny = snappedY;
        nh = Math.max(20, y + h - snappedY);
        if (nh === 20) ny = y + h - 20;
    }

    node.x = nx;
    node.y = ny;
    node.width = nw;
    node.height = nh;
}

function applyAnnResize(p) {
    const ann = state.annotations.get(drag.annId);
    if (!ann) return;
    const { x, y, w, h } = drag.orig;
    const dx = p.x - drag.startX,
        dy = p.y - drag.startY;
    const handle = drag.handle;
    const fontSize = ann.fontSize || 13;
    const minW = 40,
        minH = fontSize * 1.4;

    let nx = x,
        ny = y,
        nw = w,
        nh = h;
    if (handle.includes('e')) nw = Math.max(minW, w + dx);
    if (handle.includes('s')) nh = Math.max(minH, h + dy);
    if (handle.includes('w')) {
        nx = x + dx;
        nw = Math.max(minW, w - dx);
        if (nw === minW) nx = x + w - minW;
    }
    if (handle.includes('n')) {
        ny = y + dy;
        nh = Math.max(minH, h - dy);
        if (nh === minH) ny = y + h - minH;
    }

    ann.width = nw;
    ann.height = nh;

    // Recompute anchor point from new top-left (nx, ny) and alignment
    const align = ann.align || 'left';
    if (align === 'center') ann.x = nx + nw / 2;
    else if (align === 'right') ann.x = nx + nw;
    else ann.x = nx;
    ann.y = ny + fontSize; // baseline = top of box + one line height
}

function clearClass(cls) {
    svg.querySelectorAll('.' + cls).forEach((el) => el.classList.remove(cls));
}

function addClassToNode(nodeId, cls) {
    const el = shapesLayer.querySelector(`[data-id="${nodeId}"] .node-shape`);
    if (el) el.classList.add(cls);
}

// ============================================================
// Inline Editing
// ============================================================
function startInlineEdit(id, type) {
    clearInlineEditor();

    // Annotations use a resizable textarea to support multi-line text
    if (type === 'annotation') {
        const ann = state.annotations.get(id);
        if (!ann) return;
        const bb = annBBox(ann);
        const pad = 8;
        const fw = Math.max(160, bb.w + pad * 2);
        const fh = Math.max(60, bb.h + pad * 2 + 10);
        const fo = svgEl('foreignObject', {
            id: 'inline-editor',
            x: bb.x - pad,
            y: bb.y - pad,
            width: fw,
            height: fh,
        });
        const ta = document.createElement('textarea');
        ta.className = 'inline-input inline-textarea';
        ta.value = ann.text || '';
        ta.style.cssText = `width:100%;height:100%;resize:both;box-sizing:border-box;font-size:${ann.fontSize || 13}px;text-align:${ann.align || 'left'};`;
        fo.appendChild(ta);
        uiLayer.appendChild(fo);
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
        });
        const commit = () => {
            const val = ta.value;
            clearInlineEditor();
            if (state.annotations.has(id)) state.annotations.get(id).text = val;
            pushHistory();
            render();
            updatePropertiesPanel();
        };
        ta.addEventListener('blur', commit);
        ta.addEventListener('keydown', (e) => {
            // Ctrl+Enter commits; plain Enter inserts newline (default textarea behaviour)
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                ta.removeEventListener('blur', commit);
                commit();
            }
            if (e.key === 'Escape') {
                ta.removeEventListener('blur', commit);
                clearInlineEditor();
            }
            e.stopPropagation();
        });
        return;
    }

    // Nodes and edges use a single-line input
    let item, cx, cy, w;
    if (type === 'node') {
        item = state.nodes.get(id);
        if (!item) return;
        cx = item.x + item.width / 2;
        cy = item.y + item.height / 2;
        w = Math.max(80, item.width - 8);
    } else if (type === 'edge') {
        item = state.edges.get(id);
        if (!item) return;
        const pts = edgePoints(item);
        if (!pts) return;
        const mid = pathMidpoint(pts);
        cx = mid.x;
        cy = mid.y;
        w = 140;
    } else if (type === 'line') {
        item = state.lines.get(id);
        if (!item) return;
        const pts = linePoints(item);
        const mid = pathMidpoint(pts);
        cx = mid.x;
        cy = mid.y;
        w = 140;
    }

    const fo = svgEl('foreignObject', {
        id: 'inline-editor',
        x: cx - w / 2,
        y: cy - 14,
        width: w,
        height: 28,
    });
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-input';
    input.value = item.label || '';
    input.style.cssText = 'width:100%;height:100%;';
    fo.appendChild(input);
    uiLayer.appendChild(fo);
    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });

    const commit = () => {
        const val = input.value;
        clearInlineEditor();
        if (type === 'node') {
            if (state.nodes.has(id)) state.nodes.get(id).label = val;
        } else if (type === 'edge') {
            if (state.edges.has(id)) state.edges.get(id).label = val;
        } else if (type === 'line') {
            if (state.lines.has(id)) state.lines.get(id).label = val;
        }
        pushHistory();
        render();
        updatePropertiesPanel();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        }
        if (e.key === 'Escape') {
            input.removeEventListener('blur', commit);
            clearInlineEditor();
        }
        e.stopPropagation();
    });
}

function clearInlineEditor() {
    const el = document.getElementById('inline-editor');
    if (el) el.remove();
}

// ============================================================
// Double-click → insert waypoint on edge, or inline edit for nodes/annotations
// ============================================================
function onDblClick(e) {
    e.preventDefault();
    const p = svgCoords(e);
    const hit = hitTest(p.x, p.y);

    if (hit.type === 'edge') {
        // Insert a waypoint at the projected point on the nearest segment
        const edge = state.edges.get(hit.id);
        const pts = edgePoints(edge);
        if (!pts) return;

        let bestSeg = 0,
            bestDist = Infinity,
            bestPt = { x: p.x, y: p.y };
        for (let i = 0; i < pts.length - 1; i++) {
            const dx = pts[i + 1].x - pts[i].x,
                dy = pts[i + 1].y - pts[i].y;
            const lenSq = dx * dx + dy * dy;
            const t =
                lenSq > 0
                    ? Math.max(
                          0,
                          Math.min(
                              1,
                              ((p.x - pts[i].x) * dx + (p.y - pts[i].y) * dy) /
                                  lenSq,
                          ),
                      )
                    : 0;
            const proj = { x: pts[i].x + t * dx, y: pts[i].y + t * dy };
            const d = Math.hypot(p.x - proj.x, p.y - proj.y);
            if (d < bestDist) {
                bestDist = d;
                bestSeg = i;
                bestPt = proj;
            }
        }

        if (!edge.waypoints) edge.waypoints = [];
        edge.waypoints.splice(bestSeg, 0, {
            id: genId(),
            x: bestPt.x,
            y: bestPt.y,
        });

        state.selected.clear();
        state.selected.add(edge.id);
        pushHistory();
        render();
        updatePropertiesPanel();
        return;
    }

    if (hit.type === 'line') {
        const line = state.lines.get(hit.id);
        const pts = linePoints(line);

        let bestSeg = 0,
            bestDist = Infinity,
            bestPt = { x: p.x, y: p.y };
        for (let i = 0; i < pts.length - 1; i++) {
            const dx = pts[i + 1].x - pts[i].x,
                dy = pts[i + 1].y - pts[i].y;
            const lenSq = dx * dx + dy * dy;
            const t =
                lenSq > 0
                    ? Math.max(
                          0,
                          Math.min(
                              1,
                              ((p.x - pts[i].x) * dx + (p.y - pts[i].y) * dy) /
                                  lenSq,
                          ),
                      )
                    : 0;
            const proj = { x: pts[i].x + t * dx, y: pts[i].y + t * dy };
            const d = Math.hypot(p.x - proj.x, p.y - proj.y);
            if (d < bestDist) {
                bestDist = d;
                bestSeg = i;
                bestPt = proj;
            }
        }

        if (!line.waypoints) line.waypoints = [];
        line.waypoints.splice(bestSeg, 0, {
            id: genId(),
            x: bestPt.x,
            y: bestPt.y,
        });

        state.selected.clear();
        state.selected.add(line.id);
        pushHistory();
        render();
        updatePropertiesPanel();
        return;
    }

    if (hit.type === 'node' || hit.type === 'annotation') {
        state.selected.clear();
        state.selected.add(hit.id);
        render();
        updatePropertiesPanel();
        startInlineEdit(hit.id, hit.type);
    }
}

// ============================================================
// Keyboard
// ============================================================
function onKeyDown(e) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Presentation mode: only Escape (exit) and arrow keys (tab nav) allowed
    if (state.presentationMode) {
        if (e.key === 'Escape') { exitPresentationMode(); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            const n = state.tabs.length;
            if (n > 1) { switchToTab((state.activeTabIndex - 1 + n) % n); fitWindow(); updatePresentationLabel(); }
            return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            const n = state.tabs.length;
            if (n > 1) { switchToTab((state.activeTabIndex + 1) % n); fitWindow(); updatePresentationLabel(); }
            return;
        }
        return; // block all other shortcuts
    }

    // Tool shortcuts
    const toolKeys = {
        s: 'select',
        b: 'box',
        c: 'connector',
        l: 'line',
        t: 'text',
    };
    if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        toolKeys[e.key.toLowerCase()]
    ) {
        const targetTool = toolKeys[e.key.toLowerCase()];
        if (targetTool === 'box') {
            if (state.tool === 'box') {
                // Already on box tool — toggle pop-out for shape type selection
                if (isShapePopoutOpen()) closeShapePopout(); else openShapePopout();
            } else {
                setTool('box');
                closeShapePopout();
            }
        } else {
            closeShapePopout();
            setTool(targetTool);
        }
        return;
    }

    // Icon library toggle
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'i') {
        document.getElementById('btn-toggle-icons').click();
        return;
    }

    // Presentation mode toggle
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'p') {
        enterPresentationMode();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
    }
    if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.shiftKey && e.key === 'z'))
    ) {
        e.preventDefault();
        redo();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveDiagram();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newDiagram();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        document.getElementById('file-input')?.click();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelected();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        cutSelected();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'g') {
        e.preventDefault();
        groupItems();
        return;
    }
    if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'G' || e.key === 'g')
    ) {
        e.preventDefault();
        ungroupItems();
        return;
    }

    // Zoom shortcuts
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        zoomOut();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '0') {
        e.preventDefault();
        setZoom(1.0);
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '0') {
        e.preventDefault();
        fitWindow();
        return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete focused waypoint first, otherwise delete selected elements
        if (state.selectedWaypoint) {
            e.preventDefault();
            if (state.selectedWaypoint.edgeId) {
                const { edgeId, waypointId } = state.selectedWaypoint;
                const edge = state.edges.get(edgeId);
                if (edge && edge.waypoints) {
                    edge.waypoints = edge.waypoints.filter(
                        (wp) => wp.id !== waypointId,
                    );
                    state.selectedWaypoint = null;
                    pushHistory();
                    render();
                }
            } else if (state.selectedWaypoint.lineId) {
                const { lineId, waypointId } = state.selectedWaypoint;
                const line = state.lines.get(lineId);
                if (line && line.waypoints) {
                    line.waypoints = line.waypoints.filter(
                        (wp) => wp.id !== waypointId,
                    );
                    state.selectedWaypoint = null;
                    pushHistory();
                    render();
                }
            }
            return;
        }
        if (state.selected.size === 0) return;
        e.preventDefault();
        deleteSelected();
        return;
    }

    if (e.key === 'Escape') {
        clearInlineEditor();
        if (drag) {
            drag = null;
            uiLayer.innerHTML = '';
            clearClass('connector-hover');
        }
        state.selected.clear();
        render();
        updatePropertiesPanel();
        return;
    }
}

function deleteSelected() {
    if (state.selected.size === 0) return;
    const toDelete = new Set(state.selected);

    // Remove any elements that are on a locked layer
    for (const id of [...toDelete]) {
        const el = state.nodes.get(id) || state.edges.get(id) ||
                   state.lines.get(id) || state.annotations.get(id);
        if (el && isLayerLocked(el.layerId)) toDelete.delete(id);
    }
    if (toDelete.size === 0) return;

    // Expand group IDs: delete members and the group record
    for (const id of [...toDelete]) {
        const group = state.groups.get(id);
        if (group) {
            group.memberIds.forEach((mid) => toDelete.add(mid));
            state.groups.delete(id);
            toDelete.delete(id);
        }
    }

    for (const id of toDelete) {
        state.nodes.delete(id);
        state.edges.delete(id);
        state.lines.delete(id);
        state.annotations.delete(id);
        // Cascade: remove edges whose endpoints were deleted
        for (const [eid, edge] of state.edges) {
            if (edge.from === id || edge.to === id) state.edges.delete(eid);
        }
    }
    state.selected.clear();
    state.selectedWaypoint = null;
    pushHistory();
    render();
    updatePropertiesPanel();
    updateToolbarStatus();
}

// ============================================================
// Align & Distribute
// ============================================================

/** Bounding box of a node or annotation for alignment purposes. */
function itemBounds(item) {
    return { x: item.x, y: item.y, w: item.width || 0, h: item.height || 0 };
}

/**
 * Returns the selected nodes and annotations as [{item, type}] pairs.
 * Edges are excluded — they have no independent position.
 */
function getAlignItems() {
    const items = [];
    for (const id of state.selected) {
        const node = state.nodes.get(id);
        const ann = state.annotations.get(id);
        if (node) items.push({ item: node, type: 'node' });
        else if (ann) items.push({ item: ann, type: 'annotation' });
    }
    return items;
}

function setItemPos(entry, x, y) {
    entry.item.x = x;
    entry.item.y = y;
}

// ============================================================
// Group / Ungroup
// ============================================================

/** Compute the bounding box of all members of a group. */
function groupBounds(group) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const memberId of group.memberIds) {
        const item =
            state.nodes.get(memberId) || state.annotations.get(memberId);
        if (!item) continue;
        minX = Math.min(minX, item.x);
        minY = Math.min(minY, item.y);
        maxX = Math.max(maxX, item.x + (item.width || 0));
        maxY = Math.max(maxY, item.y + (item.height || 0));
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function groupItems() {
    // Only group ungrouped nodes and annotations
    const candidates = [];
    for (const id of state.selected) {
        const node = state.nodes.get(id);
        const ann = state.annotations.get(id);
        if (node && !node.groupId) candidates.push(node);
        else if (ann && !ann.groupId) candidates.push(ann);
    }
    if (candidates.length < 2) return;

    const gid = genId();
    state.groups.set(gid, { id: gid, memberIds: candidates.map((c) => c.id) });
    candidates.forEach((c) => {
        c.groupId = gid;
    });
    state.selected.clear();
    state.selected.add(gid);
    pushHistory();
    render();
    updatePropertiesPanel();
    updateToolbarStatus();
}

function ungroupItems() {
    const newSel = new Set();
    for (const id of [...state.selected]) {
        const group = state.groups.get(id);
        if (!group) continue;
        for (const memberId of group.memberIds) {
            const item =
                state.nodes.get(memberId) || state.annotations.get(memberId);
            if (item) {
                delete item.groupId;
                newSel.add(memberId);
            }
        }
        state.groups.delete(id);
    }
    if (newSel.size === 0) return;
    state.selected.clear();
    newSel.forEach((id) => state.selected.add(id));
    pushHistory();
    render();
    updatePropertiesPanel();
    updateToolbarStatus();
}

function alignLeft() {
    const items = getAlignItems();
    if (items.length < 2) return;
    const minX = Math.min(...items.map((e) => e.item.x));
    items.forEach((e) => setItemPos(e, minX, e.item.y));
    pushHistory();
    render();
}

function alignRight() {
    const items = getAlignItems();
    if (items.length < 2) return;
    const maxRight = Math.max(
        ...items.map((e) => e.item.x + (e.item.width || 0)),
    );
    items.forEach((e) =>
        setItemPos(e, maxRight - (e.item.width || 0), e.item.y),
    );
    pushHistory();
    render();
}

function alignCenterH() {
    const items = getAlignItems();
    if (items.length < 2) return;
    const meanCX =
        items.reduce((s, e) => s + e.item.x + (e.item.width || 0) / 2, 0) /
        items.length;
    items.forEach((e) =>
        setItemPos(e, meanCX - (e.item.width || 0) / 2, e.item.y),
    );
    pushHistory();
    render();
}

function alignTop() {
    const items = getAlignItems();
    if (items.length < 2) return;
    const minY = Math.min(...items.map((e) => e.item.y));
    items.forEach((e) => setItemPos(e, e.item.x, minY));
    pushHistory();
    render();
}

function alignBottom() {
    const items = getAlignItems();
    if (items.length < 2) return;
    const maxBottom = Math.max(
        ...items.map((e) => e.item.y + (e.item.height || 0)),
    );
    items.forEach((e) =>
        setItemPos(e, e.item.x, maxBottom - (e.item.height || 0)),
    );
    pushHistory();
    render();
}

function alignCenterV() {
    const items = getAlignItems();
    if (items.length < 2) return;
    const meanCY =
        items.reduce((s, e) => s + e.item.y + (e.item.height || 0) / 2, 0) /
        items.length;
    items.forEach((e) =>
        setItemPos(e, e.item.x, meanCY - (e.item.height || 0) / 2),
    );
    pushHistory();
    render();
}

function distributeH() {
    const items = getAlignItems();
    if (items.length < 3) return;
    items.sort((a, b) => a.item.x - b.item.x);
    const totalSpan =
        items[items.length - 1].item.x +
        (items[items.length - 1].item.width || 0) -
        items[0].item.x;
    const totalW = items.reduce((s, e) => s + (e.item.width || 0), 0);
    const gap = (totalSpan - totalW) / (items.length - 1);
    let cursor = items[0].item.x + (items[0].item.width || 0);
    for (let i = 1; i < items.length - 1; i++) {
        setItemPos(items[i], cursor + gap, items[i].item.y);
        cursor = items[i].item.x + (items[i].item.width || 0);
    }
    pushHistory();
    render();
}

function distributeV() {
    const items = getAlignItems();
    if (items.length < 3) return;
    items.sort((a, b) => a.item.y - b.item.y);
    const totalSpan =
        items[items.length - 1].item.y +
        (items[items.length - 1].item.height || 0) -
        items[0].item.y;
    const totalH = items.reduce((s, e) => s + (e.item.height || 0), 0);
    const gap = (totalSpan - totalH) / (items.length - 1);
    let cursor = items[0].item.y + (items[0].item.height || 0);
    for (let i = 1; i < items.length - 1; i++) {
        setItemPos(items[i], items[i].item.x, cursor + gap);
        cursor = items[i].item.y + (items[i].item.height || 0);
    }
    pushHistory();
    render();
}

function sameWidth() {
    const items = getAlignItems();
    if (items.length < 2) return;
    // Reference: last item in selection order (Set preserves insertion order)
    const ref = items[items.length - 1];
    const targetW = ref.item.width || 0;
    items.forEach((e) => {
        if (e !== ref) e.item.width = targetW;
    });
    pushHistory();
    render();
}

function sameHeight() {
    const items = getAlignItems();
    if (items.length < 2) return;
    const ref = items[items.length - 1];
    const targetH = ref.item.height || 0;
    items.forEach((e) => {
        if (e !== ref) e.item.height = targetH;
    });
    pushHistory();
    render();
}

// ============================================================
// Z-order — Bring to Front / Send to Back
// ============================================================

function mapForId(id) {
    if (state.nodes.has(id)) return state.nodes;
    if (state.edges.has(id)) return state.edges;
    if (state.lines.has(id)) return state.lines;
    if (state.annotations.has(id)) return state.annotations;
    return null;
}

function bringToFront() {
    if (state.selected.size === 0) return;
    for (const id of state.selected) {
        const map = mapForId(id);
        if (!map) continue;
        const item = map.get(id);
        if (isLayerLocked(item?.layerId)) continue;
        if (state.annotations.has(id)) item.zLayer = 'fg';
        map.delete(id);
        map.set(id, item); // re-insert at end = rendered on top
    }
    pushHistory();
    render();
}

function sendToBack() {
    if (state.selected.size === 0) return;
    for (const id of state.selected) {
        const map = mapForId(id);
        if (!map) continue;
        const item = map.get(id);
        if (isLayerLocked(item?.layerId)) continue;
        if (state.annotations.has(id)) item.zLayer = 'bg';
        map.delete(id);
        // Prepend by rebuilding the map
        const rest = [...map.entries()];
        map.clear();
        map.set(id, item);
        rest.forEach(([k, v]) => map.set(k, v));
    }
    pushHistory();
    render();
}

// ============================================================
// Clipboard — Copy, Cut, Paste, Duplicate
// ============================================================
function copySelected() {
    if (state.selected.size === 0) return;
    state.clipboard.nodes = [];
    state.clipboard.edges = [];
    state.clipboard.lines = [];
    state.clipboard.annotations = [];
    state.clipboard.groups = [];
    state.pasteOffset = 0;

    // Expand group IDs to their members; record group structure
    const expandedNodeIds = new Set();
    for (const id of state.selected) {
        const group = state.groups.get(id);
        if (group) {
            // Copy members and record the group
            const cbGroup = { id, memberIds: [...group.memberIds] };
            state.clipboard.groups.push(cbGroup);
            group.memberIds.forEach((mid) => expandedNodeIds.add(mid));
        }
    }

    for (const id of state.selected) {
        const node = state.nodes.get(id);
        const edge = state.edges.get(id);
        const line = state.lines.get(id);
        const ann = state.annotations.get(id);
        if (node) state.clipboard.nodes.push({ ...node });
        if (edge) state.clipboard.edges.push({ ...edge });
        if (line)
            state.clipboard.lines.push({
                ...line,
                waypoints: (line.waypoints || []).map((wp) => ({ ...wp })),
            });
        if (ann) state.clipboard.annotations.push({ ...ann });
    }
    // Add group members not already directly selected
    for (const mid of expandedNodeIds) {
        if (state.selected.has(mid)) continue; // already added above
        const node = state.nodes.get(mid);
        const ann = state.annotations.get(mid);
        if (node) state.clipboard.nodes.push({ ...node });
        if (ann) state.clipboard.annotations.push({ ...ann });
    }
    updateEditButtons();
}

function cutSelected() {
    if (state.selected.size === 0) return;
    copySelected();
    deleteSelected();
}

function pasteClipboard() {
    if (isLayerLocked(state.activeLayerId)) return;
    const cb = state.clipboard;
    if (
        !cb.nodes.length &&
        !cb.edges.length &&
        !cb.lines.length &&
        !cb.annotations.length
    )
        return;

    state.pasteOffset += 20;
    const off = state.pasteOffset;

    // Build old→new ID map for nodes so edges and groups can be reconnected
    const idMap = new Map();
    const newIds = [];

    // Track which old IDs are part of clipboard groups (so we select the group, not members)
    const groupMemberOldIds = new Set();
    (cb.groups || []).forEach((g) =>
        g.memberIds.forEach((mid) => groupMemberOldIds.add(mid)),
    );

    for (const node of cb.nodes) {
        const newId = genId();
        idMap.set(node.id, newId);
        const pasted = { ...node, id: newId, x: node.x + off, y: node.y + off, layerId: state.activeLayerId };
        delete pasted.groupId; // will be reassigned below
        state.nodes.set(newId, pasted);
        if (!groupMemberOldIds.has(node.id)) newIds.push(newId);
    }

    for (const edge of cb.edges) {
        const newId = genId();
        state.edges.set(newId, {
            ...edge,
            id: newId,
            from: idMap.get(edge.from) || edge.from,
            to: idMap.get(edge.to) || edge.to,
            layerId: state.activeLayerId,
            waypoints: (edge.waypoints || []).map((wp) => ({
                ...wp,
                id: genId(),
            })),
        });
        newIds.push(newId);
    }

    for (const line of cb.lines) {
        const newId = genId();
        state.lines.set(newId, {
            ...line,
            id: newId,
            x1: line.x1 + off,
            y1: line.y1 + off,
            x2: line.x2 + off,
            y2: line.y2 + off,
            layerId: state.activeLayerId,
            waypoints: (line.waypoints || []).map((wp) => ({
                ...wp,
                id: genId(),
                x: wp.x + off,
                y: wp.y + off,
            })),
        });
        newIds.push(newId);
    }

    for (const ann of cb.annotations) {
        const newId = genId();
        idMap.set(ann.id, newId);
        const pasted = { ...ann, id: newId, x: ann.x + off, y: ann.y + off, layerId: state.activeLayerId };
        delete pasted.groupId;
        state.annotations.set(newId, pasted);
        if (!groupMemberOldIds.has(ann.id)) newIds.push(newId);
    }

    // Reconstitute groups with new IDs
    for (const cbGroup of cb.groups || []) {
        const newGid = genId();
        const newMemberIds = cbGroup.memberIds
            .map((mid) => idMap.get(mid))
            .filter(Boolean);
        state.groups.set(newGid, { id: newGid, memberIds: newMemberIds });
        newMemberIds.forEach((mid) => {
            const item = state.nodes.get(mid) || state.annotations.get(mid);
            if (item) item.groupId = newGid;
        });
        newIds.push(newGid);
    }

    state.selected.clear();
    newIds.forEach((id) => state.selected.add(id));
    pushHistory();
    render();
    updatePropertiesPanel();
    updateToolbarStatus();
    updateEditButtons();
}

function duplicateSelected() {
    if (state.selected.size === 0) return;
    copySelected();
    pasteClipboard();
}

// ============================================================
// Cursor
// ============================================================
const resizeCursors = {
    n: 'n-resize',
    s: 's-resize',
    e: 'e-resize',
    w: 'w-resize',
    ne: 'ne-resize',
    nw: 'nw-resize',
    se: 'se-resize',
    sw: 'sw-resize',
};

function updateCursor(p) {
    if (state.tool !== 'select') {
        svg.style.cursor = 'crosshair';
        return;
    }
    const hit = hitTest(p.x, p.y);
    if (hit.type === 'resize')
        svg.style.cursor = resizeCursors[hit.handle] || 'pointer';
    else if (hit.type === 'ann-resize')
        svg.style.cursor = resizeCursors[hit.handle] || 'pointer';
    else if (hit.type === 'line-endpoint') svg.style.cursor = 'move';
    else if (hit.type === 'waypoint' || hit.type === 'line-waypoint')
        svg.style.cursor = 'move';
    else if (
        hit.type === 'node' ||
        hit.type === 'annotation' ||
        hit.type === 'line' ||
        hit.type === 'group'
    )
        svg.style.cursor = isHitLocked(hit) ? 'default' : 'move';
    else if (hit.type === 'edge') svg.style.cursor = isHitLocked(hit) ? 'default' : 'pointer';
    else svg.style.cursor = 'default';
}

/** Returns true if the object under the hit is on a locked layer. */
function isHitLocked(hit) {
    if (hit.type === 'node')
        return isLayerLocked(hit.node.layerId);
    if (hit.type === 'annotation')
        return isLayerLocked(hit.ann.layerId);
    if (hit.type === 'line')
        return isLayerLocked(hit.line.layerId);
    if (hit.type === 'edge') {
        const edge = state.edges.get(hit.id);
        if (!edge) return false;
        const fromNode = state.nodes.get(edge.from);
        return fromNode ? isLayerLocked(fromNode.layerId) : false;
    }
    if (hit.type === 'group') {
        const group = state.groups.get(hit.id);
        if (!group) return false;
        const firstMember = group.memberIds
            .map((id) => state.nodes.get(id) || state.annotations.get(id))
            .find(Boolean);
        return firstMember ? isLayerLocked(firstMember.layerId) : false;
    }
    return false;
}

// ============================================================
// Properties Panel
// ============================================================
function updatePropertiesPanel() {
    updateEditButtons(); // keep toolbar edit buttons in sync with selection
    const content = document.getElementById('properties-content');

    if (state.selected.size === 0) {
        const activeLayer = (state.layers || []).find((l) => l.id === state.activeLayerId);
        const layerName = activeLayer ? activeLayer.name : 'Background';
        const lockedTag = activeLayer?.locked ? ' <span style="color:#f59e0b;font-size:10px;">🔒 Locked</span>' : '';
        content.innerHTML = `<p class="no-selection">Nothing selected</p><p class="active-layer-hint">Active layer: <strong>${layerName}</strong>${lockedTag}</p>`;
        return;
    }
    if (state.selected.size > 1) {
        content.innerHTML = `<p class="no-selection">${state.selected.size} items selected</p>`;
        return;
    }

    const id = [...state.selected][0];

    // Group selected
    const group = state.groups.get(id);
    if (group) {
        content.innerHTML = `
      <div class="prop-group">
        <label>Group</label>
        <p class="prop-value">${group.memberIds.length} shapes</p>
      </div>
      <div class="prop-group">
        <button id="p-ungroup" class="shape-btn" style="width:100%;justify-content:center">Ungroup</button>
      </div>`;
        document
            .getElementById('p-ungroup')
            .addEventListener('click', () => ungroupItems());
        return;
    }

    const node = state.nodes.get(id);
    const edge = state.edges.get(id);
    const line = state.lines.get(id);
    const ann = state.annotations.get(id);

    // If element is on a locked layer, show a read-only banner
    const element = node || edge || line || ann;
    if (element && isLayerLocked(element.layerId)) {
        const lockedLayer = (state.layers || []).find((l) => l.id === element.layerId);
        const lockedName = lockedLayer ? lockedLayer.name : 'this layer';
        content.innerHTML = `<div class="locked-layer-banner">
            <svg width="14" height="14" viewBox="0 0 16 16" style="flex-shrink:0">
                <rect x="3" y="7" width="10" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
                <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span><strong>${lockedName}</strong> is locked. Unlock the layer to edit properties.</span>
        </div>`;
        return;
    }

    if (node) {
        if (node.type === 'symbol') {
            renderSymbolProps(content, node);
        } else {
            renderNodeProps(content, node);
        }
    } else if (edge) {
        renderEdgeProps(content, edge);
    } else if (line) {
        renderLineProps(content, line);
    } else if (ann) {
        renderAnnProps(content, ann);
    }
}

/** Helper: render a colour picker row and bind it to an object property. */
function colorRow(id, currentValue, defaultValue) {
    const val = currentValue || defaultValue;
    return `<div class="color-row">
    <input type="color" id="${id}" value="${val}">
    <span class="color-hex" id="${id}-hex">${val}</span>
    <button class="color-reset" id="${id}-reset" title="Reset to default">Reset</button>
  </div>`;
}

/** Generate a layer <select> dropdown pre-selected to the element's current layer. */
function layerDropdownHtml(element) {
    const opts = (state.layers || [])
        .map(
            (l) =>
                `<option value="${l.id}"${element.layerId === l.id ? ' selected' : ''}${l.locked && element.layerId !== l.id ? ' disabled' : ''}>${esc(l.name)}${l.locked ? ' 🔒' : ''}</option>`,
        )
        .join('');
    return `<select id="p-layer">${opts}</select>`;
}

/** Wire the layer dropdown to move the element to the chosen layer. */
function bindLayerDropdown(element) {
    const sel = document.getElementById('p-layer');
    if (!sel) return;
    sel.addEventListener('change', () => {
        element.layerId = sel.value;
        pushHistory();
        render();
        renderLayersPanel();
    });
}

function bindColorInput(id, defaultValue, setter) {
    const input = document.getElementById(id);
    const hex = document.getElementById(`${id}-hex`);
    const reset = document.getElementById(`${id}-reset`);
    if (!input) return;
    input.addEventListener('input', () => {
        hex.textContent = input.value;
        setter(input.value);
        render();
    });
    input.addEventListener('change', () => pushHistory());
    reset.addEventListener('click', () => {
        setter(null);
        input.value = defaultValue;
        hex.textContent = defaultValue;
        pushHistory();
        render();
        updatePropertiesPanel();
    });
}

/** Generate the 3×3 label-position picker HTML. */
function labelPosPickerHtml(current) {
    const positions = ['tl', 'tm', 'tr', 'ml', 'mm', 'mr', 'bl', 'bm', 'br'];
    const titles = {
        tl: 'Top left',
        tm: 'Top centre',
        tr: 'Top right',
        ml: 'Middle left',
        mm: 'Centre',
        mr: 'Middle right',
        bl: 'Bottom left',
        bm: 'Bottom centre',
        br: 'Bottom right',
    };
    return `<div class="pos-picker">${positions
        .map(
            (p) =>
                `<button class="pos-btn${current === p ? ' active' : ''}" data-pos="${p}" title="${titles[p]}"></button>`,
        )
        .join('')}</div>`;
}

/** Wire click events for the label-position picker. */
function bindLabelPosPicker(node, defaultPos) {
    document.querySelectorAll('.pos-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            node.labelPos = btn.dataset.pos;
            document
                .querySelectorAll('.pos-btn')
                .forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            pushHistory();
            render();
        });
    });
}

function renderSymbolProps(container, node) {
    const iconName = node.iconPath
        ? node.iconPath
              .split('/')
              .pop()
              .replace(/\.svg$/i, '')
        : '';
    const curPos = node.labelPos || 'bm';
    container.innerHTML = `
    <div class="prop-group"><label>Icon</label><p class="prop-value" style="font-size:11px;word-break:break-all">${esc(iconName)}</p></div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(node.label || '')}"></div>
    <div class="prop-group"><label>Label pos</label>${labelPosPickerHtml(curPos)}</div>
    <div class="prop-group"><label>Font</label>${fontControlsHtml(node, { size: 11 })}</div>
    <div class="prop-group"><label>X</label><input type="number" id="p-x" value="${Math.round(node.x)}"></div>
    <div class="prop-group"><label>Y</label><input type="number" id="p-y" value="${Math.round(node.y)}"></div>
    <div class="prop-group"><label>Width</label><input type="number" id="p-w" value="${Math.round(node.width)}"></div>
    <div class="prop-group"><label>Height</label><input type="number" id="p-h" value="${Math.round(node.height)}"></div>
    <div class="prop-group"><label>Layer</label>${layerDropdownHtml(node)}</div>
  `;
    bindFontControls(node, { size: 11 });
    bindPropInput('p-label', (v) => {
        node.label = v;
    });
    bindLabelPosPicker(node, 'bm');
    bindPropInput(
        'p-x',
        (v) => {
            node.x = +v || 0;
        },
        true,
    );
    bindPropInput(
        'p-y',
        (v) => {
            node.y = +v || 0;
        },
        true,
    );
    bindPropInput(
        'p-w',
        (v) => {
            node.width = Math.max(16, +v || 16);
        },
        true,
    );
    bindPropInput(
        'p-h',
        (v) => {
            node.height = Math.max(16, +v || 16);
        },
        true,
    );
    bindLayerDropdown(node);
}

function renderNodeProps(container, node) {
    const shapeOpts = [
        'box',
        'circle',
        'oval',
        'diamond',
        'triangle',
        'parallelogram',
        'document',
        'database',
        'wait',
        'merge',
    ]
        .map(
            (s) =>
                `<option value="${s}"${(node.shape || 'box') === s ? ' selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`,
        )
        .join('');
    const dashOpts = [
        ['solid', 'Solid'],
        ['dashed', 'Dashed'],
        ['dotted', 'Dotted'],
    ]
        .map(
            ([v, l]) =>
                `<option value="${v}"${(node.strokeStyle || 'solid') === v ? ' selected' : ''}>${l}</option>`,
        )
        .join('');
    const curPos = node.labelPos || 'mm';
    container.innerHTML = `
    <div class="prop-group"><label>Shape</label><select id="p-shape">${shapeOpts}</select></div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(node.label || '')}"></div>
    <div class="prop-group"><label>Label pos</label>${labelPosPickerHtml(curPos)}</div>
    <div class="prop-group"><label>Font</label>${fontControlsHtml(node, { size: 13 })}</div>
    <div class="prop-group"><label>Fill</label>${colorRow('p-fill', node.fill, '#ffffff')}</div>
    <div class="prop-group"><label>Stroke</label>${colorRow('p-stroke', node.stroke, '#475569')}</div>
    <div class="prop-group"><label>Line style</label><select id="p-stroke-style">${dashOpts}</select></div>
    <div class="prop-group">
      <label>Opacity</label>
      <div class="opacity-row">
        <input type="range" id="p-opacity" min="0" max="100" step="1" value="${node.opacity ?? 100}">
        <span id="p-opacity-val">${node.opacity ?? 100}%</span>
      </div>
    </div>
    <div class="prop-group"><label>X</label><input type="number" id="p-x" value="${Math.round(node.x)}"></div>
    <div class="prop-group"><label>Y</label><input type="number" id="p-y" value="${Math.round(node.y)}"></div>
    <div class="prop-group"><label>Width</label><input type="number" id="p-w" value="${Math.round(node.width)}"></div>
    <div class="prop-group"><label>Height</label><input type="number" id="p-h" value="${Math.round(node.height)}"></div>
    <div class="prop-group"><label>Layer</label>${layerDropdownHtml(node)}</div>
  `;
    document.getElementById('p-shape').addEventListener('change', (e) => {
        node.shape = e.target.value;
        pushHistory();
        render();
    });
    document
        .getElementById('p-stroke-style')
        .addEventListener('change', (e) => {
            node.strokeStyle = e.target.value;
            pushHistory();
            render();
        });
    bindFontControls(node, { size: 13 });
    bindColorInput('p-fill', '#ffffff', (v) => {
        node.fill = v || undefined;
    });
    bindColorInput('p-stroke', '#475569', (v) => {
        node.stroke = v || undefined;
    });
    // Opacity slider
    const opacitySlider = document.getElementById('p-opacity');
    const opacityVal = document.getElementById('p-opacity-val');
    opacitySlider.addEventListener('input', () => {
        node.opacity = parseInt(opacitySlider.value, 10);
        opacityVal.textContent = node.opacity + '%';
        render();
    });
    opacitySlider.addEventListener('change', () => pushHistory());
    bindPropInput('p-label', (v) => {
        node.label = v;
    });
    bindLabelPosPicker(node, 'mm');
    bindPropInput(
        'p-x',
        (v) => {
            node.x = +v || 0;
        },
        true,
    );
    bindPropInput(
        'p-y',
        (v) => {
            node.y = +v || 0;
        },
        true,
    );
    bindPropInput(
        'p-w',
        (v) => {
            node.width = Math.max(40, +v || 40);
        },
        true,
    );
    bindPropInput(
        'p-h',
        (v) => {
            node.height = Math.max(20, +v || 20);
        },
        true,
    );
    bindLayerDropdown(node);
}

function renderEdgeProps(container, edge) {
    const fromNode = state.nodes.get(edge.from);
    const toNode = state.nodes.get(edge.to);
    const dir = edge.direction || 'forward';
    const curveStyle = edge.curveStyle || 'straight';
    const dirOpts = [
        ['forward', '→ Forward'],
        ['back', '← Backward'],
        ['both', '↔ Both'],
        ['none', '— None'],
    ]
        .map(
            ([v, label]) =>
                `<option value="${v}"${dir === v ? ' selected' : ''}>${label}</option>`,
        )
        .join('');
    const dashOpts = [
        ['solid', 'Solid'],
        ['dashed', 'Dashed'],
        ['dotted', 'Dotted'],
    ]
        .map(
            ([v, l]) =>
                `<option value="${v}"${(edge.strokeStyle || 'solid') === v ? ' selected' : ''}>${l}</option>`,
        )
        .join('');
    const curveOpts = [
        ['straight', 'Straight'],
        ['curved', 'Curved'],
    ]
        .map(
            ([v, l]) =>
                `<option value="${v}"${curveStyle === v ? ' selected' : ''}>${l}</option>`,
        )
        .join('');

    container.innerHTML = `
    <div class="prop-group"><label>Direction</label><select id="p-dir">${dirOpts}</select></div>
    <div class="prop-group"><label>Connector</label><select id="p-curve-style">${curveOpts}</select></div>
    <div class="prop-group"><label>Line style</label><select id="p-stroke-style">${dashOpts}</select></div>
    <div class="prop-group"><label>Stroke</label>${colorRow('p-stroke', edge.stroke, '#64748b')}</div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(edge.label || '')}"></div>
    <div class="prop-group"><label>Label Font</label>${fontControlsHtml(edge, { size: 11 })}</div>
    <div class="prop-group"><label>From</label><span class="prop-value">${esc(fromNode ? fromNode.label || fromNode.id : edge.from)}</span></div>
    <div class="prop-group"><label>To</label><span class="prop-value">${esc(toNode ? toNode.label || toNode.id : edge.to)}</span></div>
    <div class="prop-group"><label>Layer</label>${layerDropdownHtml(edge)}</div>
  `;
    document.getElementById('p-dir').addEventListener('change', (e) => {
        edge.direction = e.target.value;
        pushHistory();
        render();
    });
    document.getElementById('p-curve-style').addEventListener('change', (e) => {
        edge.curveStyle = e.target.value;
        pushHistory();
        render();
    });
    document
        .getElementById('p-stroke-style')
        .addEventListener('change', (e) => {
            edge.strokeStyle = e.target.value;
            pushHistory();
            render();
        });
    bindColorInput('p-stroke', '#64748b', (v) => {
        edge.stroke = v || undefined;
    });
    bindPropInput('p-label', (v) => {
        edge.label = v;
    });
    bindFontControls(edge, { size: 11 });
    bindLayerDropdown(edge);
}

function renderLineProps(container, line) {
    const curveStyle = line.curveStyle || 'straight';
    const dashOpts = [
        ['solid', 'Solid'],
        ['dashed', 'Dashed'],
        ['dotted', 'Dotted'],
    ]
        .map(
            ([v, l]) =>
                `<option value="${v}"${(line.strokeStyle || 'solid') === v ? ' selected' : ''}>${l}</option>`,
        )
        .join('');
    const curveOpts = [
        ['straight', 'Straight'],
        ['curved', 'Curved'],
    ]
        .map(
            ([v, l]) =>
                `<option value="${v}"${curveStyle === v ? ' selected' : ''}>${l}</option>`,
        )
        .join('');
    const symOpts = (field) =>
        [
            ['none', 'None'],
            ['dot', 'Dot'],
            ['square', 'Square'],
        ]
            .map(
                ([v, l]) =>
                    `<option value="${v}"${(line[field] || 'none') === v ? ' selected' : ''}>${l}</option>`,
            )
            .join('');

    container.innerHTML = `
    <div class="prop-group"><label>Connector</label><select id="p-curve-style">${curveOpts}</select></div>
    <div class="prop-group"><label>Stroke</label>${colorRow('p-stroke', line.stroke, '#64748b')}</div>
    <div class="prop-group"><label>Line style</label><select id="p-stroke-style">${dashOpts}</select></div>
    <div class="prop-group"><label>Start</label><select id="p-start-sym">${symOpts('startSymbol')}</select></div>
    <div class="prop-group"><label>End</label><select id="p-end-sym">${symOpts('endSymbol')}</select></div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(line.label || '')}"></div>
    <div class="prop-group"><label>Label Font</label>${fontControlsHtml(line, { size: 11 })}</div>
    <div class="prop-group"><label>Layer</label>${layerDropdownHtml(line)}</div>
  `;
    document.getElementById('p-curve-style').addEventListener('change', (e) => {
        line.curveStyle = e.target.value;
        pushHistory();
        render();
    });
    document
        .getElementById('p-stroke-style')
        .addEventListener('change', (e) => {
            line.strokeStyle = e.target.value;
            pushHistory();
            render();
        });
    document.getElementById('p-start-sym').addEventListener('change', (e) => {
        line.startSymbol = e.target.value;
        pushHistory();
        render();
    });
    document.getElementById('p-end-sym').addEventListener('change', (e) => {
        line.endSymbol = e.target.value;
        pushHistory();
        render();
    });
    bindColorInput('p-stroke', '#64748b', (v) => {
        line.stroke = v || undefined;
    });
    bindPropInput('p-label', (v) => {
        line.label = v;
    });
    bindFontControls(line, { size: 11 });
    bindLayerDropdown(line);
}

function renderAnnProps(container, ann) {
    const align = ann.align || 'left';
    const dashOpts = [
        ['solid', 'Solid'],
        ['dashed', 'Dashed'],
        ['dotted', 'Dotted'],
    ]
        .map(
            ([v, l]) =>
                `<option value="${v}"${(ann.strokeStyle || 'solid') === v ? ' selected' : ''}>${l}</option>`,
        )
        .join('');

    container.innerHTML = `
    <div class="prop-group">
      <label>Text</label>
      <textarea id="p-text" rows="3" style="width:100%;resize:vertical;box-sizing:border-box;font-family:inherit;font-size:12px;padding:4px">${esc(ann.text || '')}</textarea>
    </div>
    <div class="prop-group">
      <label>Align</label>
      <div class="font-controls">
        <button class="font-btn${align === 'left' ? ' active' : ''}" id="p-align-left"   title="Left">⬅</button>
        <button class="font-btn${align === 'center' ? ' active' : ''}" id="p-align-center" title="Centre">↔</button>
        <button class="font-btn${align === 'right' ? ' active' : ''}" id="p-align-right"  title="Right">➡</button>
      </div>
    </div>
    <div class="prop-group"><label>Font</label>${fontControlsHtml(ann, { size: 13 })}</div>
    <div class="prop-group"><label>Color</label>${colorRow('p-color', ann.color, '#7c3aed')}</div>
    <div class="prop-group"><label>Background</label>${colorRow('p-fill', ann.fill, '#ffffff')}</div>
    <div class="prop-group">
      <label>Bg opacity</label>
      <div class="opacity-row">
        <input type="range" id="p-fill-opacity" min="0" max="100" step="1" value="${ann.fillOpacity ?? 100}">
        <span id="p-fill-opacity-val">${ann.fillOpacity ?? 100}%</span>
      </div>
    </div>
    <div class="prop-group"><label>Border</label>${colorRow('p-stroke', ann.stroke, '#475569')}</div>
    <div class="prop-group"><label>Border style</label><select id="p-stroke-style">${dashOpts}</select></div>
    <div class="prop-group"><label>X</label><input type="number" id="p-x" value="${Math.round(ann.x)}"></div>
    <div class="prop-group"><label>Y</label><input type="number" id="p-y" value="${Math.round(ann.y)}"></div>
    <div class="prop-group"><label>Width</label><input type="number" id="p-ann-w" value="${Math.round(ann.width || annBBox(ann).w)}" min="40"></div>
    <div class="prop-group"><label>Height</label><input type="number" id="p-ann-h" value="${Math.round(ann.height || annBBox(ann).h)}" min="10"></div>
    <div class="prop-group"><label>Layer</label>${layerDropdownHtml(ann)}</div>
  `;

    // Text (textarea works with bindPropInput since it fires 'input' and 'change')
    bindPropInput('p-text', (v) => {
        ann.text = v;
    });

    // Alignment buttons
    ['left', 'center', 'right'].forEach((a) => {
        const btn = document.getElementById(`p-align-${a}`);
        if (!btn) return;
        btn.addEventListener('click', () => {
            ann.align = a;
            pushHistory();
            render();
            updatePropertiesPanel();
        });
    });

    bindFontControls(ann, { size: 13 });
    bindColorInput('p-color', '#7c3aed', (v) => {
        ann.color = v || undefined;
    });
    bindColorInput('p-fill', '#ffffff', (v) => {
        ann.fill = v || undefined;
    });

    const fillOpacitySlider = document.getElementById('p-fill-opacity');
    const fillOpacityVal = document.getElementById('p-fill-opacity-val');
    if (fillOpacitySlider) {
        fillOpacitySlider.addEventListener('input', () => {
            ann.fillOpacity = parseInt(fillOpacitySlider.value, 10);
            fillOpacityVal.textContent = ann.fillOpacity + '%';
            render();
        });
        fillOpacitySlider.addEventListener('change', () => pushHistory());
    }

    bindColorInput('p-stroke', '#475569', (v) => {
        ann.stroke = v || undefined;
    });

    const strokeStyleEl = document.getElementById('p-stroke-style');
    if (strokeStyleEl)
        strokeStyleEl.addEventListener('change', (e) => {
            ann.strokeStyle = e.target.value;
            pushHistory();
            render();
        });

    bindPropInput(
        'p-x',
        (v) => {
            ann.x = +v || 0;
        },
        true,
    );
    bindPropInput(
        'p-y',
        (v) => {
            ann.y = +v || 0;
        },
        true,
    );
    bindPropInput(
        'p-ann-w',
        (v) => {
            const nw = Math.max(40, +v || 40);
            const bb = annBBox(ann);
            const nx = bb.x; // keep top-left fixed when typing into width field
            ann.width = nw;
            const align = ann.align || 'left';
            if (align === 'center') ann.x = nx + nw / 2;
            else if (align === 'right') ann.x = nx + nw;
            else ann.x = nx;
        },
        true,
    );
    bindPropInput(
        'p-ann-h',
        (v) => {
            ann.height = Math.max(10, +v || 10);
        },
        true,
    );
    bindLayerDropdown(ann);
}

function bindPropInput(id, setter, isNumber) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
        setter(el.value);
        render();
    });
    el.addEventListener('change', () => pushHistory());
}

/** Generate HTML for font control row (size select + B/I/U buttons). */
function fontControlsHtml(item, defaults = {}) {
    const curSize =
        item.fontSize !== undefined ? item.fontSize : defaults.size || 13;
    const bold =
        item.fontBold !== undefined ? item.fontBold : defaults.bold || false;
    const italic =
        item.fontItalic !== undefined
            ? item.fontItalic
            : defaults.italic || false;
    const under =
        item.fontUnderline !== undefined
            ? item.fontUnderline
            : defaults.underline || false;

    const sizes = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];
    const sizeOpts = sizes
        .map(
            (s) =>
                `<option value="${s}"${s === curSize ? ' selected' : ''}>${s}</option>`,
        )
        .join('');

    return `<div class="font-controls">
    <select class="font-size-select" id="p-fontsize">${sizeOpts}</select>
    <button class="font-btn${bold ? ' active' : ''}" id="p-bold"      title="Bold"><b>B</b></button>
    <button class="font-btn${italic ? ' active' : ''}" id="p-italic"    title="Italic"><i>I</i></button>
    <button class="font-btn${under ? ' active' : ''}" id="p-underline" title="Underline"><u>U</u></button>
  </div>`;
}

/** Wire up font control inputs, calling setter(field, value) on change. */
function bindFontControls(item, defaults = {}) {
    const sizeEl = document.getElementById('p-fontsize');
    const boldEl = document.getElementById('p-bold');
    const italEl = document.getElementById('p-italic');
    const underEl = document.getElementById('p-underline');
    if (!sizeEl) return;

    sizeEl.addEventListener('change', () => {
        item.fontSize = parseInt(sizeEl.value, 10);
        pushHistory();
        render();
    });

    const toggle = (el, field, defVal) => {
        el.addEventListener('click', () => {
            const cur =
                item[field] !== undefined ? item[field] : defVal || false;
            item[field] = !cur;
            el.classList.toggle('active', item[field]);
            pushHistory();
            render();
        });
    };
    toggle(boldEl, 'fontBold', defaults.bold || false);
    toggle(italEl, 'fontItalic', defaults.italic || false);
    toggle(underEl, 'fontUnderline', defaults.underline || false);
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ============================================================
// Toolbar & Status
// ============================================================
function setTool(tool) {
    state.tool = tool;
    clearInlineEditor();
    clearClass('connector-hover');
    document.querySelectorAll('.tool-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    svg.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    render();
}

// SVG inner markup for each shape type — used to update the Shape tool button icon
const SHAPE_SVGS = {
    box:           '<rect x="2" y="4" width="12" height="8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    circle:        '<ellipse cx="8" cy="8" rx="6" ry="6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    oval:          '<ellipse cx="8" cy="8" rx="7" ry="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    diamond:       '<polygon points="8,1 15,8 8,15 1,8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    triangle:      '<polygon points="8,1 15,14 1,14" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    parallelogram: '<polygon points="4,3 15,3 12,13 1,13" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    document:      '<path d="M2,3 L14,3 L14,10 C10.5,10 10.5,13 7,13 C3.5,13 3.5,10 2,10 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    database:      '<path d="M2,5 A6,2 0 0 1 14,5 L14,11 A6,2 0 0 1 2,11 Z M2,5 A6,2 0 0 0 14,5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    wait:          '<path d="M2,3 L9,3 C14,3 14,13 9,13 L2,13 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    merge:         '<polygon points="1,2 15,2 8,14" fill="none" stroke="currentColor" stroke-width="1.5"/>',
};

function setCurrentShape(shape) {
    state.currentShape = shape;
    // Update active state on pop-out buttons
    document.querySelectorAll('.shape-popout-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.shape === shape);
    });
    // Update the Shape tool button icon to show the selected shape
    const iconEl = document.getElementById('shape-tool-icon');
    if (iconEl && SHAPE_SVGS[shape]) {
        iconEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16">${SHAPE_SVGS[shape]}</svg>`;
    }
}

function openShapePopout() {
    const popout = document.getElementById('shape-popout');
    const btn = document.getElementById('btn-shape-tool');
    if (!popout || !btn) return;
    const rect = btn.getBoundingClientRect();
    popout.style.left = `${rect.right + 6}px`;
    popout.style.top = `${rect.top}px`;
    popout.classList.add('open');
}

function closeShapePopout() {
    const popout = document.getElementById('shape-popout');
    if (popout) popout.classList.remove('open');
}

function isShapePopoutOpen() {
    const popout = document.getElementById('shape-popout');
    return popout ? popout.classList.contains('open') : false;
}

function updateToolbarStatus() {
    const el = document.getElementById('toolbar-status');
    const n = state.nodes.size,
        e = state.edges.size,
        a = state.annotations.size;
    el.textContent = `${n} box${n !== 1 ? 'es' : ''}  ·  ${e} connector${e !== 1 ? 's' : ''}  ·  ${a} annotation${a !== 1 ? 's' : ''}`;
}

function updateTitleDisplay() {
    const el = document.getElementById('diagram-title');
    if (!el) return;
    const name = state.diagramName || 'Untitled diagram';
    if (state.dirty) {
        el.innerHTML = '<span class="dirty-indicator">●</span> ' + name;
    } else {
        el.textContent = name;
    }
}

// ============================================================
// Zoom
// ============================================================
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4.0;
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const GRID_SIZE = 20;

function getCanvasSize() {
    const canvas = document.getElementById('canvas');
    return { w: canvas.clientWidth, h: canvas.clientHeight };
}

function updateViewBox() {
    const { w, h } = getCanvasSize();
    const vw = w / state.zoom;
    const vh = h / state.zoom;
    const vx = state.viewCenterX - vw / 2;
    const vy = state.viewCenterY - vh / 2;
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
}

function setZoom(z) {
    state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    updateViewBox();
    syncZoomSelect();
}

function updateSnapButton() {
    const btn = document.getElementById('btn-snap');
    if (!btn) return;
    btn.classList.toggle('btn-active', state.snapToGrid);
    btn.setAttribute('aria-pressed', String(state.snapToGrid));
    btn.title = state.snapToGrid ? 'Snap to grid: ON (click to disable)' : 'Snap to grid: OFF (click to enable)';
}

function syncZoomSelect() {
    const sel = document.getElementById('zoom-select');
    if (!sel) return;
    const pct = Math.round(state.zoom * 100);
    // Try to match a preset option value
    const match = [...sel.options].find(
        (o) =>
            o.value !== 'fit' && Math.round(parseFloat(o.value) * 100) === pct,
    );
    if (match) {
        sel.value = match.value;
    } else {
        // No preset match — show custom percentage via a temporary option or just deselect
        let custom = sel.querySelector('option.zoom-custom');
        if (!custom) {
            custom = document.createElement('option');
            custom.className = 'zoom-custom';
            sel.insertBefore(custom, sel.firstChild);
        }
        custom.value = state.zoom;
        custom.textContent = `${pct}%`;
        sel.value = custom.value;
    }
}

function zoomIn() {
    // Snap to next 10% step above current
    const next = Math.round((state.zoom + 0.1) * 10) / 10;
    setZoom(next);
}

function zoomOut() {
    const next = Math.round((state.zoom - 0.1) * 10) / 10;
    setZoom(next);
}

function fitWindow() {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const n of state.nodes.values()) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
    }
    for (const a of state.annotations.values()) {
        minX = Math.min(minX, a.x);
        minY = Math.min(minY, a.y - 16);
        maxX = Math.max(maxX, a.x + 200);
        maxY = Math.max(maxY, a.y + 10);
    }
    for (const l of state.lines.values()) {
        const pts = linePoints(l);
        for (const pt of pts) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
        }
    }

    const { w, h } = getCanvasSize();

    if (!isFinite(minX)) {
        // Empty canvas — reset to 100%
        state.viewCenterX = w / 2;
        state.viewCenterY = h / 2;
        state.zoom = 1.0;
        updateViewBox();
        syncZoomSelect();
        return;
    }

    const PADDING = 40;
    const contentW = maxX - minX + PADDING * 2;
    const contentH = maxY - minY + PADDING * 2;
    const zoomX = w / contentW;
    const zoomY = h / contentH;
    state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(zoomX, zoomY)));
    state.viewCenterX = (minX + maxX) / 2;
    state.viewCenterY = (minY + maxY) / 2;
    updateViewBox();
    syncZoomSelect();
}

function initZoom() {
    const { w, h } = getCanvasSize();
    state.viewCenterX = w / 2;
    state.viewCenterY = h / 2;
    updateViewBox();

    // Re-apply viewBox on container resize
    const ro = new ResizeObserver(() => updateViewBox());
    ro.observe(document.getElementById('canvas-container'));
}

// ============================================================
// Presentation Mode
// ============================================================

function updatePresentationLabel() {
    const label = document.getElementById('pres-tab-label');
    const prev = document.getElementById('pres-prev');
    const next = document.getElementById('pres-next');
    if (!label) return;
    const n = state.tabs.length;
    const i = state.activeTabIndex;
    const name = state.tabs[i]?.name || `Tab ${i + 1}`;
    if (n > 1) {
        label.textContent = `${name} (${i + 1} / ${n})`;
        if (prev) prev.style.visibility = '';
        if (next) next.style.visibility = '';
    } else {
        label.textContent = name;
        if (prev) prev.style.visibility = 'hidden';
        if (next) next.style.visibility = 'hidden';
    }
}

function requestBrowserFullscreen() {
    const el = document.documentElement;
    try {
        const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
        if (fn) fn.call(el);
    } catch (_) { /* unsupported or blocked — continue without native fullscreen */ }
}

function exitBrowserFullscreen() {
    try {
        const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (fn && (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement)) {
            fn.call(document);
        }
    } catch (_) { /* ignore */ }
}

function enterPresentationMode() {
    state.presentationMode = true;
    // Close any open popouts
    closeShapePopout();
    const iconPanel = document.getElementById('icon-panel');
    if (iconPanel) iconPanel.className = 'icon-panel-closed';
    document.body.classList.add('presentation-mode');
    updatePresentationLabel();
    requestBrowserFullscreen();
    // Fit after layout reflow so canvas has its new full dimensions
    requestAnimationFrame(() => {
        updateViewBox();
        fitWindow();
    });
}

function exitPresentationMode() {
    state.presentationMode = false;
    document.body.classList.remove('presentation-mode');
    exitBrowserFullscreen();
    requestAnimationFrame(() => updateViewBox());
}

function syncUndoRedoMenu() {
    const miUndo = document.getElementById('mi-undo');
    const miRedo = document.getElementById('mi-redo');
    if (miUndo) miUndo.disabled = state.historyIndex <= 0;
    if (miRedo)
        miRedo.disabled = state.historyIndex >= state.history.length - 1;
}

function updateEditButtons() {
    const hasSel = state.selected.size > 0;
    const hasCb =
        state.clipboard.nodes.length > 0 ||
        state.clipboard.edges.length > 0 ||
        state.clipboard.lines.length > 0 ||
        state.clipboard.annotations.length > 0;
    const btnCut = document.getElementById('btn-cut');
    const btnCopy = document.getElementById('btn-copy');
    const btnPaste = document.getElementById('btn-paste');
    const btnDupe = document.getElementById('btn-duplicate');
    if (btnCut) btnCut.disabled = !hasSel;
    if (btnCopy) btnCopy.disabled = !hasSel;
    if (btnPaste) btnPaste.disabled = !hasCb;
    if (btnDupe) btnDupe.disabled = !hasSel;
    const btnDel = document.getElementById('btn-delete');
    if (btnDel) btnDel.disabled = !hasSel;

    // Align toggle: enabled when ≥2 positional items selectable
    const alignCount = getAlignItems().length;
    const canAlign = alignCount >= 2;
    const canDist = alignCount >= 3;
    const btnAlignToggle = document.getElementById('btn-align-toggle');
    if (btnAlignToggle) btnAlignToggle.disabled = !canAlign;

    // Update popup buttons' disabled state (popup may be open)
    [
        'btn-align-left',
        'btn-align-center-h',
        'btn-align-right',
        'btn-align-top',
        'btn-align-center-v',
        'btn-align-bottom',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !canAlign;
    });
    ['btn-dist-h', 'btn-dist-v'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !canDist;
    });
    ['btn-same-width', 'btn-same-height'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !canAlign;
    });

    // Bring to front / Send to back require any selection
    const btnFront = document.getElementById('btn-bring-front');
    const btnBack = document.getElementById('btn-send-back');
    if (btnFront) btnFront.disabled = !hasSel;
    if (btnBack) btnBack.disabled = !hasSel;

    // Group: enabled when ≥2 ungrouped nodes/annotations selected
    const groupCandidates = [...state.selected].filter((id) => {
        const n = state.nodes.get(id);
        const a = state.annotations.get(id);
        return (n && !n.groupId) || (a && !a.groupId);
    });
    const canGroup = groupCandidates.length >= 2;
    // Ungroup: enabled when any selected ID is a group
    const canUngroup = [...state.selected].some((id) => state.groups.has(id));
    const btnGroup = document.getElementById('btn-group');
    const btnUngroup = document.getElementById('btn-ungroup');
    if (btnGroup) btnGroup.disabled = !canGroup;
    if (btnUngroup) btnUngroup.disabled = !canUngroup;

    // Sync menu item disabled states
    const mi = (id, dis) => {
        const el = document.getElementById(id);
        if (el) el.disabled = dis;
    };
    mi('mi-cut', !hasSel);
    mi('mi-copy', !hasSel);
    mi('mi-paste', !hasCb);
    mi('mi-duplicate', !hasSel);
    mi('mi-delete', !hasSel);
    mi('mi-group', !canGroup);
    mi('mi-ungroup', !canUngroup);
    mi('mi-bring-front', !hasSel);
    mi('mi-send-back', !hasSel);
    mi('mi-align-left', !canAlign);
    mi('mi-align-center-h', !canAlign);
    mi('mi-align-right', !canAlign);
    mi('mi-align-top', !canAlign);
    mi('mi-align-center-v', !canAlign);
    mi('mi-align-bottom', !canAlign);
    mi('mi-dist-h', !canDist);
    mi('mi-dist-v', !canDist);
    mi('mi-same-width', !canAlign);
    mi('mi-same-height', !canAlign);
}

// ============================================================
// Icon Library
// ============================================================

/** Convert a raw filename to a human-readable label. */
function iconLabel(filename) {
    return filename
        .replace(/\.svg$/i, '')
        .replace(/^\d+-icon-service-/i, '') // strip Azure numeric prefix
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

let iconManifest = null; // loaded once from icons/manifest.json

function buildIconPanel(manifest) {
    const tree = document.getElementById('icon-tree');
    tree.innerHTML = '';

    for (const [provider, categories] of Object.entries(manifest)) {
        const providerDiv = document.createElement('div');
        providerDiv.className = 'icon-provider';

        const providerHeader = document.createElement('div');
        providerHeader.className = 'icon-provider-header';
        providerHeader.innerHTML = `<span class="icon-chevron open">▶</span><span>${provider}</span>`;
        providerDiv.appendChild(providerHeader);

        const providerBody = document.createElement('div');
        providerBody.className = 'icon-provider-body';

        for (const [category, files] of Object.entries(categories)) {
            const catDiv = document.createElement('div');
            catDiv.className = 'icon-category';

            const catHeader = document.createElement('div');
            catHeader.className = 'icon-category-header';
            catHeader.innerHTML = `<span class="icon-chevron">▶</span><span>${category}</span><span style="color:#334155;margin-left:auto;font-size:10px">${files.length}</span>`;
            catDiv.appendChild(catHeader);

            const grid = document.createElement('div');
            grid.className = 'icon-grid hidden';

            for (const entry of files) {
                // entry is { name, data } (new format) or a plain string (legacy)
                const filename = typeof entry === 'string' ? entry : entry.name;
                const dataURI = typeof entry === 'object' ? entry.data : null;
                const iconPath = `icons/${provider}/${category}/${filename}`;
                const label = iconLabel(filename);

                // Populate the export cache from manifest data — no fetch/canvas needed
                if (dataURI) iconDataURICache.set(iconPath, dataURI);

                const item = document.createElement('div');
                item.className = 'icon-item';
                item.draggable = true;
                item.dataset.iconPath = iconPath;
                item.dataset.label = label;
                item.title = label;

                const img = document.createElement('img');
                // Use embedded data URI for display too — avoids file:// image load issues
                img.src = dataURI || iconPath;
                img.alt = label;
                img.loading = 'lazy';

                const span = document.createElement('span');
                span.textContent = label;

                item.appendChild(img);
                item.appendChild(span);

                item.addEventListener('dragstart', (e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/icon-path', iconPath);
                    e.dataTransfer.setData('text/icon-label', label);
                    item.classList.add('dragging');
                });
                item.addEventListener('dragend', () =>
                    item.classList.remove('dragging'),
                );

                grid.appendChild(item);
            }

            catDiv.appendChild(grid);
            providerBody.appendChild(catDiv);

            // Toggle category expand/collapse
            catHeader.addEventListener('click', () => {
                const open = !grid.classList.contains('hidden');
                grid.classList.toggle('hidden', open);
                catHeader
                    .querySelector('.icon-chevron')
                    .classList.toggle('open', !open);
            });
        }

        providerDiv.appendChild(providerBody);
        tree.appendChild(providerDiv);

        // Toggle provider expand/collapse
        const providerBodyEl = providerBody;
        providerHeader.addEventListener('click', () => {
            const hidden = providerBodyEl.style.display === 'none';
            providerBodyEl.style.display = hidden ? '' : 'none';
            providerHeader
                .querySelector('.icon-chevron')
                .classList.toggle('open', hidden);
        });
    }
}

function filterIconPanel(query) {
    const q = query.trim().toLowerCase();
    const tree = document.getElementById('icon-tree');
    if (!q) {
        // Restore default collapsed state
        tree.querySelectorAll('.icon-item').forEach(
            (el) => (el.style.display = ''),
        );
        tree.querySelectorAll('.icon-grid').forEach((el) =>
            el.classList.add('hidden'),
        );
        tree.querySelectorAll('.icon-category-header .icon-chevron').forEach(
            (el) => el.classList.remove('open'),
        );
        tree.querySelectorAll('.icon-provider-body').forEach(
            (el) => (el.style.display = ''),
        );
        tree.querySelectorAll('.icon-provider-header .icon-chevron').forEach(
            (el) => el.classList.add('open'),
        );
        return;
    }

    // Show all categories and expand them; hide non-matching icons
    tree.querySelectorAll('.icon-grid').forEach((el) =>
        el.classList.remove('hidden'),
    );
    tree.querySelectorAll('.icon-category-header .icon-chevron').forEach((el) =>
        el.classList.add('open'),
    );
    tree.querySelectorAll('.icon-provider-body').forEach(
        (el) => (el.style.display = ''),
    );

    tree.querySelectorAll('.icon-item').forEach((item) => {
        const matches = item.dataset.label.toLowerCase().includes(q);
        item.style.display = matches ? '' : 'none';
    });

    // Hide empty categories
    tree.querySelectorAll('.icon-category').forEach((cat) => {
        const visible = [...cat.querySelectorAll('.icon-item')].some(
            (el) => el.style.display !== 'none',
        );
        cat.style.display = visible ? '' : 'none';
    });
}

function initIconLibrary() {
    if (window.ICON_MANIFEST) {
        iconManifest = window.ICON_MANIFEST;
        buildIconPanel(iconManifest);
    } else {
        document.getElementById('icon-tree').innerHTML =
            '<p style="color:#475569;font-size:11px;padding:12px">Icon manifest not found.<br>Run: node scripts/generate-manifest.js</p>';
    }

    // Toggle panel open/close
    document
        .getElementById('btn-toggle-icons')
        .addEventListener('click', () => {
            const panel = document.getElementById('icon-panel');
            const btn = document.getElementById('btn-toggle-icons');
            const closed = panel.classList.toggle('icon-panel-closed');
            btn.classList.toggle('active', !closed);
        });

    // Search
    document.getElementById('icon-search').addEventListener('input', (e) => {
        filterIconPanel(e.target.value);
    });

    // Canvas drag-and-drop
    const canvasContainer = document.getElementById('canvas-container');
    canvasContainer.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/icon-path')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    });
    canvasContainer.addEventListener('drop', (e) => {
        const iconPath = e.dataTransfer.getData('text/icon-path');
        if (!iconPath) return;
        e.preventDefault();

        // Convert screen coordinates to diagram coordinates
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const diagramPt = pt.matrixTransform(svg.getScreenCTM().inverse());

        const SIZE = 64;
        const id = genId();
        const label = e.dataTransfer.getData('text/icon-label') || '';
        state.nodes.set(id, {
            id,
            type: 'symbol',
            iconPath,
            label,
            x: diagramPt.x - SIZE / 2,
            y: diagramPt.y - SIZE / 2,
            width: SIZE,
            height: SIZE,
            layerId: state.activeLayerId,
        });
        // Pre-cache the icon's data URI for export
        loadIconAsDataURI(iconPath);
        state.selected.clear();
        state.selected.add(id);
        pushHistory();
        render();
        updatePropertiesPanel();
        updateToolbarStatus();
    });
}

// ============================================================
// Layers Panel
// ============================================================

function renderLayersPanel() {
    const list = document.getElementById('layers-list');
    if (!list) return;
    list.innerHTML = '';
    const layers = state.layers || [];
    let dragSrcId = null;

    // Display in reverse order so top of list = frontmost (highest layerIdx)
    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        const isActive = layer.id === state.activeLayerId;
        const row = document.createElement('div');
        row.className = 'layer-row' + (isActive ? ' layer-active' : '') + (!layer.visible ? ' layer-hidden' : '') + (layer.locked ? ' layer-locked' : '');
        row.dataset.layerId = layer.id;
        row.draggable = true;

        // Eye toggle
        const eye = document.createElement('button');
        eye.className = 'layer-eye';
        eye.title = layer.visible ? 'Hide layer' : 'Show layer';
        eye.innerHTML = layer.visible
            ? '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5S11.5 3 8 3zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>'
            : '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M13.36 2.64 2.64 13.36M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5S11.5 3 8 3z" stroke="currentColor" stroke-width="1.2" fill="none"/><line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.2"/></svg>';
        eye.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLayerVisibility(layer.id);
        });

        // Lock toggle
        const lock = document.createElement('button');
        lock.className = 'layer-lock';
        lock.title = layer.locked ? 'Unlock layer' : 'Lock layer';
        // Closed padlock = locked; open padlock = unlocked
        lock.innerHTML = layer.locked
            ? '<svg viewBox="0 0 16 16" width="13" height="13"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
            : '<svg viewBox="0 0 16 16" width="13" height="13"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        lock.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLayerLock(layer.id);
        });

        // Layer name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'layer-name';
        nameSpan.textContent = layer.name;
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            startLayerRename(layer.id);
        });

        // Delete button
        const del = document.createElement('button');
        del.className = 'layer-delete';
        del.title = 'Delete layer';
        del.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>';
        del.disabled = layers.length <= 1 || layer.locked;
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteLayer(layer.id);
        });

        row.appendChild(eye);
        row.appendChild(lock);
        row.appendChild(nameSpan);
        row.appendChild(del);
        row.addEventListener('click', () => setActiveLayer(layer.id));

        // Drag-to-reorder events
        row.addEventListener('dragstart', (e) => {
            dragSrcId = layer.id;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', layer.id);
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            list.querySelectorAll('.drag-over-above,.drag-over-below').forEach((el) => {
                el.classList.remove('drag-over-above', 'drag-over-below');
            });
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (layer.id === dragSrcId) return;
            list.querySelectorAll('.drag-over-above,.drag-over-below').forEach((el) => {
                el.classList.remove('drag-over-above', 'drag-over-below');
            });
            const rect = row.getBoundingClientRect();
            const isAbove = e.clientY < rect.top + rect.height / 2;
            row.classList.add(isAbove ? 'drag-over-above' : 'drag-over-below');
        });
        row.addEventListener('dragleave', (e) => {
            // Only remove if leaving the row entirely (not entering a child)
            if (!row.contains(e.relatedTarget)) {
                row.classList.remove('drag-over-above', 'drag-over-below');
            }
        });
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            const wasAbove = row.classList.contains('drag-over-above');
            row.classList.remove('drag-over-above', 'drag-over-below');
            const srcId = e.dataTransfer.getData('text/plain') || dragSrcId;
            if (!srcId || srcId === layer.id) return;

            // Panel is reversed: top of panel = last element of state.layers
            // 'above' in panel = higher position in array; 'below' = lower position
            const layers = state.layers;
            const srcIdx = layers.findIndex((l) => l.id === srcId);
            const tgtIdx = layers.findIndex((l) => l.id === layer.id);
            if (srcIdx < 0 || tgtIdx < 0) return;

            const moved = layers.splice(srcIdx, 1)[0];
            // Recalculate tgtIdx after removing src
            const newTgtIdx = layers.findIndex((l) => l.id === layer.id);
            // wasAbove in panel = insert AFTER target in array (higher layerIdx)
            // wasBelow in panel = insert BEFORE target in array (lower layerIdx)
            const insertAt = wasAbove ? newTgtIdx + 1 : newTgtIdx;
            layers.splice(insertAt, 0, moved);

            flushTabState();
            render();
            renderLayersPanel();
            pushHistory();
            saveToLocalStorage();
        });

        list.appendChild(row);
    }
}

function setActiveLayer(layerId) {
    if (!state.layers.find((l) => l.id === layerId)) return;
    state.activeLayerId = layerId;
    if (state.tabs[state.activeTabIndex]) {
        state.tabs[state.activeTabIndex].activeLayerId = layerId;
    }
    renderLayersPanel();
    updatePropertiesPanel();
}

function toggleLayerVisibility(layerId) {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return;
    layer.visible = !layer.visible;
    // Deselect elements on hidden layer
    if (!layer.visible) {
        for (const id of [...state.selected]) {
            const el = state.nodes.get(id) || state.edges.get(id) || state.lines.get(id) || state.annotations.get(id);
            if (el && el.layerId === layerId) state.selected.delete(id);
        }
    }
    render();
    renderLayersPanel();
    updatePropertiesPanel();
    saveToLocalStorage();
}

function toggleLayerLock(layerId) {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return;
    layer.locked = !layer.locked;
    // Deselect elements on newly locked layer
    if (layer.locked) {
        for (const id of [...state.selected]) {
            const el = state.nodes.get(id) || state.edges.get(id) || state.lines.get(id) || state.annotations.get(id);
            if (el && el.layerId === layerId) state.selected.delete(id);
        }
    }
    flushTabState();
    render();
    renderLayersPanel();
    updatePropertiesPanel();
    saveToLocalStorage();
}

function addLayer() {
    const newLayer = {
        id: `layer-${Date.now()}`,
        name: `Layer ${state.layers.length + 1}`,
        visible: true,
        locked: false,
    };
    state.layers.push(newLayer);
    state.activeLayerId = newLayer.id;
    if (state.tabs[state.activeTabIndex]) {
        state.tabs[state.activeTabIndex].layers = state.layers;
        state.tabs[state.activeTabIndex].activeLayerId = state.activeLayerId;
    }
    renderLayersPanel();
    saveToLocalStorage();
}

function deleteLayer(layerId) {
    if (state.layers.length <= 1) return;
    if (isLayerLocked(layerId)) return;
    const idx = state.layers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;
    // Remove all elements on this layer
    for (const [id, node] of state.nodes) {
        if (node.layerId === layerId) state.nodes.delete(id);
    }
    for (const [id, edge] of state.edges) {
        if (edge.layerId === layerId) state.edges.delete(id);
    }
    for (const [id, line] of state.lines) {
        if (line.layerId === layerId) state.lines.delete(id);
    }
    for (const [id, ann] of state.annotations) {
        if (ann.layerId === layerId) state.annotations.delete(id);
    }
    state.layers.splice(idx, 1);
    // If active layer was deleted, switch to first available
    if (state.activeLayerId === layerId) {
        state.activeLayerId = state.layers[0].id;
    }
    if (state.tabs[state.activeTabIndex]) {
        state.tabs[state.activeTabIndex].layers = state.layers;
        state.tabs[state.activeTabIndex].activeLayerId = state.activeLayerId;
    }
    state.selected.clear();
    pushHistory();
    render();
    renderLayersPanel();
    updatePropertiesPanel();
}

function renameLayer(layerId, newName) {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const trimmed = newName.trim();
    if (trimmed) layer.name = trimmed;
    renderLayersPanel();
    updatePropertiesPanel();
    saveToLocalStorage();
}

function startLayerRename(layerId) {
    // Find the current nameSpan from the live DOM (the single-click may have
    // triggered renderLayersPanel() before dblclick fired, detaching the old span)
    const row = document.querySelector(`.layer-row[data-layer-id="${layerId}"]`);
    if (!row) return;
    const nameSpan = row.querySelector('.layer-name');
    if (!nameSpan) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = nameSpan.textContent;
    input.className = 'layer-rename-input';
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
        renameLayer(layerId, input.value);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.removeEventListener('blur', commit); renderLayersPanel(); }
    });
}

// ============================================================
// Init
// ============================================================

/** Wire a click handler to an element by ID — silently skips if the element doesn't exist. */
function on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
}

function switchToTab(index) {
    if (index === state.activeTabIndex) return;
    flushTabState();
    drag = null;
    panDrag = null;
    clearInlineEditor();
    if (uiLayer) uiLayer.innerHTML = '';
    loadTabToLiveState(index);
    if (svg)
        svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
    render();
    updateViewBox();
    syncZoomSelect();
    updatePropertiesPanel();
    updateToolbarStatus();
    updateEditButtons();
    syncUndoRedoMenu();
    renderTabBar();
    saveToLocalStorage();
}

function addTab() {
    flushTabState();
    drag = null;
    panDrag = null;
    clearInlineEditor();
    if (uiLayer) uiLayer.innerHTML = '';
    const defaultNames = state.tabs
        .map((tab) => /^tab-(\d+)$/.exec(tab.name))
        .filter(Boolean)
        .map((match) => parseInt(match[1], 10));
    const n = defaultNames.length
        ? Math.max(...defaultNames) + 1
        : state.tabs.length + 1;
    const tab = createTab(`tab-${n}`);
    state.tabs.push(tab);
    loadTabToLiveState(state.tabs.length - 1);
    pushHistory();
    render();
    updateViewBox();
    syncZoomSelect();
    updatePropertiesPanel();
    updateToolbarStatus();
    updateEditButtons();
    syncUndoRedoMenu();
    renderTabBar();
    saveToLocalStorage();
}

function removeTab(index) {
    if (state.tabs.length <= 1) return;
    flushTabState();
    drag = null;
    panDrag = null;
    clearInlineEditor();
    if (uiLayer) uiLayer.innerHTML = '';
    const prevActive = state.activeTabIndex;
    state.tabs.splice(index, 1);
    const newIndex =
        prevActive === index
            ? Math.min(index, state.tabs.length - 1)
            : prevActive > index
              ? prevActive - 1
              : prevActive;
    loadTabToLiveState(newIndex);
    pushHistory();
    render();
    updateViewBox();
    syncZoomSelect();
    updatePropertiesPanel();
    updateToolbarStatus();
    updateEditButtons();
    syncUndoRedoMenu();
    renderTabBar();
    saveToLocalStorage();
}

function renameTab(index, newName) {
    const name = newName.trim();
    if (!name) {
        renderTabBar();
        return;
    }
    state.tabs[index].name = name;
    renderTabBar();
    saveToLocalStorage();
}

function renderTabBar() {
    const bar = document.getElementById('tab-bar');
    if (!bar) return;
    bar.innerHTML = '';

    state.tabs.forEach((tab, i) => {
        const tabEl = document.createElement('div');
        tabEl.className =
            'tab-btn' + (i === state.activeTabIndex ? ' active' : '');

        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = tab.name;
        label.title = 'Double-click to rename';
        tabEl.appendChild(label);

        if (state.tabs.length > 1) {
            const close = document.createElement('button');
            close.className = 'tab-close';
            close.type = 'button';
            close.innerHTML = '&times;';
            close.title = `Close "${tab.name}"`;
            close.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.confirm(`Close tab "${tab.name}"?`)) removeTab(i);
            });
            tabEl.appendChild(close);
        }

        tabEl.addEventListener('click', () => switchToTab(i));
        label.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            startTabRename(i, label);
        });

        bar.appendChild(tabEl);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add-btn';
    addBtn.type = 'button';
    addBtn.textContent = '+';
    addBtn.title = 'New tab';
    addBtn.addEventListener('click', addTab);
    bar.appendChild(addBtn);

    const barLinks = document.createElement('div');
    barLinks.className = 'tab-bar-links';

    const faqLink = document.createElement('a');
    faqLink.className = 'tab-privacy-link';
    faqLink.href = '#';
    faqLink.textContent = 'FAQ';
    faqLink.title = 'Frequently Asked Questions';
    faqLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(
            'faq.html',
            'diagram-faq',
            'width=800,height=700,resizable=yes',
        );
    });
    barLinks.appendChild(faqLink);

    const termsLink = document.createElement('a');
    termsLink.className = 'tab-privacy-link';
    termsLink.href = '#';
    termsLink.textContent = 'Terms';
    termsLink.title = 'Terms of Use';
    termsLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(
            'terms.html',
            'diagram-terms',
            'width=900,height=700,resizable=yes',
        );
    });
    barLinks.appendChild(termsLink);

    const privacyLink = document.createElement('a');
    privacyLink.className = 'tab-privacy-link';
    privacyLink.href = '#';
    privacyLink.textContent = 'Privacy Policy';
    privacyLink.title = 'Privacy Policy';
    privacyLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(
            'privacy.html',
            'diagram-privacy',
            'width=900,height=700,resizable=yes',
        );
    });
    barLinks.appendChild(privacyLink);

    const contactLink = document.createElement('a');
    contactLink.className = 'tab-privacy-link';
    contactLink.href = '#';
    contactLink.textContent = 'Contact';
    contactLink.title = 'Contact';
    contactLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(
            'contact.html',
            'diagram-contact',
            'width=780,height=660,resizable=yes',
        );
    });
    barLinks.appendChild(contactLink);

    const blogLink = document.createElement('a');
    blogLink.className = 'tab-privacy-link';
    blogLink.href = '#';
    blogLink.textContent = 'Blog';
    blogLink.title = 'Blog';
    blogLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(
            'blog.html',
            'diagram-blog',
            'width=860,height=700,resizable=yes',
        );
    });
    barLinks.appendChild(blogLink);

    bar.appendChild(barLinks);
}

function startTabRename(index, labelEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = state.tabs[index].name;
    labelEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => renameTab(index, input.value);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        }
        if (e.key === 'Escape') {
            input.removeEventListener('blur', commit);
            renderTabBar();
        }
    });
}

// ============================================================
// Menu bar
// ============================================================
function initMenuBar() {
    const menuBar = document.getElementById('menu-bar');
    if (!menuBar) return;

    // Sync version number from the left-toolbar element into the Help menu
    const versionEl = document.getElementById('app-version');
    const miVersionText = document.getElementById('mi-version-text');
    if (versionEl && miVersionText)
        miVersionText.textContent = versionEl.textContent;

    const menus = Array.from(menuBar.querySelectorAll('.menu'));

    function closeAll() {
        menus.forEach((m) => m.classList.remove('open'));
    }

    menus.forEach((menuEl) => {
        const titleBtn = menuEl.querySelector('.menu-title');

        titleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menuEl.classList.contains('open');
            closeAll();
            if (!isOpen) menuEl.classList.add('open');
        });

        // Hover-open when another menu is already open
        titleBtn.addEventListener('mouseenter', () => {
            if (menus.some((m) => m.classList.contains('open'))) {
                closeAll();
                menuEl.classList.add('open');
            }
        });
    });

    const menuActions = {
        'new': () => newDiagram(),
        'open': () => document.getElementById('file-input')?.click(),
        'open-gdrive': () =>
            window.openFromGoogleDrive && window.openFromGoogleDrive(),
        'save': () => saveDiagram(),
        'save-gdrive': () =>
            window.saveToGoogleDrive && window.saveToGoogleDrive(),
        'export-png': () => exportPNG(),
        'export-svg': () => exportSVG(),
        'undo': () => undo(),
        'redo': () => redo(),
        'cut': () => cutSelected(),
        'copy': () => copySelected(),
        'paste': () => pasteClipboard(),
        'duplicate': () => duplicateSelected(),
        'delete': () => deleteSelected(),
        'group': () => groupItems(),
        'ungroup': () => ungroupItems(),
        'zoom-in': () => zoomIn(),
        'zoom-out': () => zoomOut(),
        'zoom-100': () => setZoom(1.0),
        'zoom-fit': () => fitWindow(),
        'zoom-25': () => setZoom(0.25),
        'zoom-50': () => setZoom(0.5),
        'zoom-75': () => setZoom(0.75),
        'zoom-125': () => setZoom(1.25),
        'zoom-150': () => setZoom(1.5),
        'zoom-200': () => setZoom(2.0),
        'bring-front': () => bringToFront(),
        'send-back': () => sendToBack(),
        'align-left': () => alignLeft(),
        'align-center-h': () => alignCenterH(),
        'align-right': () => alignRight(),
        'align-top': () => alignTop(),
        'align-center-v': () => alignCenterV(),
        'align-bottom': () => alignBottom(),
        'dist-h': () => distributeH(),
        'dist-v': () => distributeV(),
        'same-width': () => sameWidth(),
        'same-height': () => sameHeight(),
        'show-help': () => {
            window.open(
                'help.html',
                'diagram-help',
                'width=1000,height=720,resizable=yes',
            );
        },
        'show-about': () => {
            window.open(
                'about.html',
                'diagram-about',
                'width=680,height=620,resizable=yes',
            );
        },
        'show-version': () => {}, // display-only; version shown in menu text
    };

    menuBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.menu-item');
        if (!btn || btn.disabled) return;
        e.stopPropagation();
        closeAll();
        const fn = menuActions[btn.dataset.action];
        if (fn) fn();
    });

    document.addEventListener('click', closeAll);
}

function init() {
    const initTab = createTab('tab-1');
    initTab.nodes = state.nodes;
    initTab.edges = state.edges;
    initTab.lines = state.lines;
    initTab.annotations = state.annotations;
    initTab.history = state.history;
    initTab.historyIndex = state.historyIndex;
    initTab.nextId = state.nextId;
    initTab.zoom = state.zoom;
    initTab.viewCenterX = state.viewCenterX;
    initTab.viewCenterY = state.viewCenterY;
    initTab.selected = state.selected;
    initTab.selectedWaypoint = state.selectedWaypoint;
    // layers already set by createTab default
    state.layers = initTab.layers;
    state.activeLayerId = initTab.activeLayerId;
    state.tabs = [initTab];
    state.activeTabIndex = 0;

    initSVG();

    // Toolbar tool buttons — Shape button gets special pop-out handling
    document.querySelectorAll('.tool-btn').forEach((btn) => {
        if (!btn.dataset.tool) return;
        if (btn.id === 'btn-shape-tool') {
            btn.addEventListener('click', () => {
                setTool('box');
                if (isShapePopoutOpen()) {
                    closeShapePopout();
                } else {
                    openShapePopout();
                }
            });
        } else {
            btn.addEventListener('click', () => {
                closeShapePopout();
                setTool(btn.dataset.tool);
            });
        }
    });

    // Shape pop-out buttons
    document.querySelectorAll('.shape-popout-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            setCurrentShape(btn.dataset.shape);
            setTool('box');
            closeShapePopout();
        });
    });

    // Close shape pop-out when clicking outside it
    document.addEventListener('mousedown', (e) => {
        const popout = document.getElementById('shape-popout');
        const shapeBtn = document.getElementById('btn-shape-tool');
        if (popout && isShapePopoutOpen() &&
            !popout.contains(e.target) && e.target !== shapeBtn && !shapeBtn?.contains(e.target)) {
            closeShapePopout();
        }
    });

    // Undo / Redo
    on('btn-undo', 'click', undo);
    on('btn-redo', 'click', redo);

    // Cut / Copy / Paste / Duplicate
    on('btn-cut', 'click', cutSelected);
    on('btn-copy', 'click', copySelected);
    on('btn-paste', 'click', pasteClipboard);
    on('btn-duplicate', 'click', duplicateSelected);
    on('btn-delete', 'click', deleteSelected);

    // Align / Distribute — floating popup
    (function () {
        const toggleBtn = document.getElementById('btn-align-toggle');
        const popup = document.getElementById('align-popup');
        if (!toggleBtn || !popup) return;

        function openPopup() {
            const rect = toggleBtn.getBoundingClientRect();
            popup.style.left = rect.left + 'px';
            popup.style.top = rect.bottom + 4 + 'px';
            popup.hidden = false;
            toggleBtn.classList.add('active');
        }

        function closePopup() {
            popup.hidden = true;
            toggleBtn.classList.remove('active');
        }

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            popup.hidden ? openPopup() : closePopup();
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (
                !popup.hidden &&
                !popup.contains(e.target) &&
                e.target !== toggleBtn
            ) {
                closePopup();
            }
        });

        // Wire each popup action: run alignment, then close
        function wrapAlign(fn) {
            return () => {
                fn();
                closePopup();
            };
        }
        on('btn-align-left', 'click', wrapAlign(alignLeft));
        on('btn-align-center-h', 'click', wrapAlign(alignCenterH));
        on('btn-align-right', 'click', wrapAlign(alignRight));
        on('btn-align-top', 'click', wrapAlign(alignTop));
        on('btn-align-center-v', 'click', wrapAlign(alignCenterV));
        on('btn-align-bottom', 'click', wrapAlign(alignBottom));
        on('btn-dist-h', 'click', wrapAlign(distributeH));
        on('btn-dist-v', 'click', wrapAlign(distributeV));
        on('btn-same-width', 'click', wrapAlign(sameWidth));
        on('btn-same-height', 'click', wrapAlign(sameHeight));
    })();

    // Z-order
    on('btn-bring-front', 'click', bringToFront);
    on('btn-send-back', 'click', sendToBack);

    // Group / Ungroup
    on('btn-group', 'click', groupItems);
    on('btn-ungroup', 'click', ungroupItems);

    // Open / Save / Export
    on('btn-new', 'click', newDiagram);
    on('btn-save', 'click', saveDiagram);
    on(
        'btn-gdrive-save',
        'click',
        () => window.saveToGoogleDrive && window.saveToGoogleDrive(),
    );
    on('btn-open', 'click', () =>
        document.getElementById('file-input')?.click(),
    );
    on('btn-export-svg', 'click', exportSVG);
    on('btn-export-png', 'click', exportPNG);
    on('file-input', 'change', (e) => {
        if (e.target.files[0]) {
            importDiagram(e.target.files[0]);
            e.target.value = '';
        }
    });

    // Zoom
    on('btn-zoom-in', 'click', zoomIn);
    on('btn-zoom-out', 'click', zoomOut);

    // Presentation mode
    on('btn-present', 'click', enterPresentationMode);

    // Exit presentation mode if the user leaves browser fullscreen externally (F11, browser button, etc.)
    const onFullscreenChange = () => {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (!fsEl && state.presentationMode) exitPresentationMode();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('mozfullscreenchange', onFullscreenChange);
    document.addEventListener('MSFullscreenChange', onFullscreenChange);
    on('pres-exit', 'click', exitPresentationMode);
    on('pres-prev', 'click', () => {
        const n = state.tabs.length;
        switchToTab((state.activeTabIndex - 1 + n) % n);
        fitWindow();
        updatePresentationLabel();
    });
    on('pres-next', 'click', () => {
        const n = state.tabs.length;
        switchToTab((state.activeTabIndex + 1) % n);
        fitWindow();
        updatePresentationLabel();
    });

    // Snap to grid
    on('btn-snap', 'click', () => {
        state.snapToGrid = !state.snapToGrid;
        updateSnapButton();
        saveToLocalStorage();
    });
    on('btn-add-layer', 'click', addLayer);
    on('zoom-select', 'change', (e) => {
        const val = e.target.value;
        if (val === 'fit') {
            fitWindow();
        } else {
            const z = parseFloat(val);
            if (!isNaN(z)) {
                state.zoom = z;
                updateViewBox();
                syncZoomSelect();
            }
        }
    });

    // Canvas events
    svg.addEventListener('mousedown', onMouseDown);
    svg.addEventListener('mousemove', onMouseMove);
    svg.addEventListener('mouseup', onMouseUp);
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('mouseleave', () => {
        if (drag) {
            dragEnd({ x: 0, y: 0 });
        }
        if (panDrag) {
            panDrag = null;
            svg.style.cursor =
                state.tool === 'select' ? 'default' : 'crosshair';
        }
    });

    // Suppress context menu so right-click pan doesn't trigger the browser menu
    svg.addEventListener('contextmenu', (e) => e.preventDefault());

    // Wheel zoom: Ctrl+scroll zooms in/out centred on pointer
    svg.addEventListener(
        'wheel',
        (e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const pt = svgCoords(e); // diagram coords under pointer before zoom
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            const newZoom = Math.min(
                ZOOM_MAX,
                Math.max(ZOOM_MIN, Math.round((state.zoom + delta) * 10) / 10),
            );
            if (newZoom === state.zoom) return;
            // Adjust viewCenter so the pointer stays over the same diagram point
            const { w, h } = getCanvasSize();
            const fracX = (e.clientX - svg.getBoundingClientRect().left) / w;
            const fracY = (e.clientY - svg.getBoundingClientRect().top) / h;
            const vwOld = w / state.zoom,
                vhOld = h / state.zoom;
            const vwNew = w / newZoom,
                vhNew = h / newZoom;
            state.viewCenterX += (vwOld - vwNew) * (fracX - 0.5);
            state.viewCenterY += (vhOld - vhNew) * (fracY - 0.5);
            state.zoom = newZoom;
            updateViewBox();
            syncZoomSelect();
        },
        { passive: false },
    );

    // Keyboard
    document.addEventListener('keydown', onKeyDown);

    // Set initial tool
    setTool('select');

    // Initialise zoom (sets viewBox and wires ResizeObserver)
    initZoom();

    // Initialise icon library panel
    initIconLibrary();

    // Initialise menu bar
    initMenuBar();

    // Restore last diagram from localStorage (before seeding history)
    loadFromLocalStorage();
    updateTitleDisplay();
    updateSnapButton();
    renderLayersPanel();
    setCurrentShape(state.currentShape); // sync pop-out active state + tool icon

    // Pre-cache data URIs for any symbol icons loaded from localStorage
    cacheAllSymbolIcons();

    pushHistory(); // history[0] = initial/restored state — also calls syncUndoRedoMenu

    render();
    updateViewBox();
    syncZoomSelect();
    updatePropertiesPanel();
    updateToolbarStatus();
    updateEditButtons();
    renderTabBar();

    // Expose internals for gdrive.js (set after state is fully initialised)
    window._editorState = state;
    window._updateTitleDisplay = updateTitleDisplay;
    window._saveToLocalStorage = saveToLocalStorage;
    window._importDiagramData = importDiagramData;
}

document.addEventListener('DOMContentLoaded', init);

// Expose internals for gdrive.js
window._editorState = null; // set after DOMContentLoaded via init
window._buildDiagramBlob = buildDiagramBlob;
window._importDiagramData = null; // set after DOMContentLoaded via init
window._updateTitleDisplay = null;
window._saveToLocalStorage = null;
