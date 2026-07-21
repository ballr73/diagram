// editor.js — HTML Diagram Editor

// ============================================================
// State
// ============================================================
const state = {
  nodes: new Map(),       // id → {id, x, y, width, height, label, shape}
  edges: new Map(),       // id → {id, from, to, label}
  annotations: new Map(), // id → {id, x, y, text}
  selected: new Set(),
  tool: 'select',
  currentShape: 'box',
  nextId: 1,
  history: [],
  historyIndex: -1,
};

function genId() {
  return `id-${state.nextId++}`;
}

// ============================================================
// History (snapshot-based undo/redo)
// ============================================================
function snapshot() {
  return {
    nodes: new Map([...state.nodes].map(([k, v]) => [k, { ...v }])),
    edges: new Map([...state.edges].map(([k, v]) => [k, { ...v }])),
    annotations: new Map([...state.annotations].map(([k, v]) => [k, { ...v }])),
    nextId: state.nextId,
  };
}

function pushHistory() {
  // Truncate redo branch, add current state, cap at 100
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot());
  if (state.history.length > 100) state.history.shift();
  state.historyIndex = state.history.length - 1;
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreSnapshot(state.history[state.historyIndex]);
  updateToolbarStatus();
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  restoreSnapshot(state.history[state.historyIndex]);
  updateToolbarStatus();
}

function restoreSnapshot(snap) {
  state.nodes = new Map([...snap.nodes].map(([k, v]) => [k, { ...v }]));
  state.edges = new Map([...snap.edges].map(([k, v]) => [k, { ...v }]));
  state.annotations = new Map([...snap.annotations].map(([k, v]) => [k, { ...v }]));
  state.nextId = snap.nextId;
  state.selected.clear();
  render();
  updatePropertiesPanel();
}

// ============================================================
// JSON Serialization
// ============================================================
function exportDiagram() {
  const data = {
    version: 1,
    nodes: [...state.nodes.values()],
    edges: [...state.edges.values()],
    annotations: [...state.annotations.values()],
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diagram.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importDiagram(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (typeof data.version === 'undefined') throw new Error('Missing version field');
      pushHistory();
      state.nodes.clear();
      state.edges.clear();
      state.annotations.clear();
      state.selected.clear();
      (data.nodes || []).forEach(n => state.nodes.set(n.id, { ...n }));
      (data.edges || []).forEach(e => state.edges.set(e.id, { ...e }));
      (data.annotations || []).forEach(a => state.annotations.set(a.id, { ...a }));
      // Advance nextId past all imported ids
      const allNums = [...state.nodes.keys(), ...state.edges.keys(), ...state.annotations.keys()]
        .map(id => parseInt(id.replace('id-', ''), 10))
        .filter(n => !isNaN(n));
      state.nextId = allNums.length > 0 ? Math.max(...allNums) + 1 : 1;
      pushHistory(); // save imported state as new history entry
      render();
      updatePropertiesPanel();
      updateToolbarStatus();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
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
  const cx = x + w / 2, cy = y + h / 2;
  switch (node.shape) {
    case 'diamond':
      return [{ x: cx, y }, { x: x + w, y: cy }, { x: cx, y: y + h }, { x, y: cy }];
    case 'triangle':
      return [{ x: cx, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    case 'parallelogram': {
      const sk = w * 0.2;
      return [{ x: x + sk, y }, { x: x + w, y }, { x: x + w - sk, y: y + h }, { x, y: y + h }];
    }
    default: return null;
  }
}

/** Intersection of ray from (cx,cy) toward (px,py) with an ellipse of semi-axes (rx,ry). */
function ellipseIntersect(cx, cy, rx, ry, px, py) {
  const dx = px - cx, dy = py - cy;
  if (dx === 0 && dy === 0) return { x: cx + rx, y: cy };
  const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Intersection of ray from (cx,cy) toward (px,py) with a polygon defined by vertices[]. */
function rayPolygonIntersect(cx, cy, px, py, vertices) {
  const dx = px - cx, dy = py - cy;
  let bestT = Infinity;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i], v2 = vertices[(i + 1) % n];
    const ex = v2.x - v1.x, ey = v2.y - v1.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-10) continue;
    const fx = v1.x - cx, fy = v1.y - cy;
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
    return ellipseIntersect(cx, cy, node.width / 2, node.height / 2, p.x, p.y);
  }

  const verts = shapeVertices(node);
  if (verts) return rayPolygonIntersect(cx, cy, p.x, p.y, verts);

  // Default: bounding-box rectangle (box shape)
  const hw = node.width / 2, hh = node.height / 2;
  const dx = p.x - cx, dy = p.y - cy;
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
    if (x >= node.x && x <= node.x + node.width &&
        y >= node.y && y <= node.y + node.height) {
      return node;
    }
  }
  return null;
}

function getAnnotationAt(x, y) {
  // Approximate: within bounding box of text
  const entries = [...state.annotations.entries()];
  for (let i = entries.length - 1; i >= 0; i--) {
    const [, ann] = entries[i];
    if (x >= ann.x - 4 && x <= ann.x + 200 &&
        y >= ann.y - 16 && y <= ann.y + 4) {
      return ann;
    }
  }
  return null;
}

function getEdgeAt(x, y, threshold = 8) {
  for (const edge of state.edges.values()) {
    const from = state.nodes.get(edge.from);
    const to = state.nodes.get(edge.to);
    if (!from || !to) continue;
    const tc = nodeCenter(to);
    const fc = nodeCenter(from);
    const p1 = borderIntersect(from, tc);
    const p2 = borderIntersect(to, fc);
    if (segmentDist(x, y, p1.x, p1.y, p2.x, p2.y) < threshold) return edge;
  }
  return null;
}

function segmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Returns resize handle name ('n','s','e','w','ne','nw','se','sw') or null */
function getResizeHandle(node, x, y, threshold = 6) {
  const handles = [
    { name: 'nw', x: node.x,                  y: node.y },
    { name: 'n',  x: node.x + node.width / 2,  y: node.y },
    { name: 'ne', x: node.x + node.width,       y: node.y },
    { name: 'e',  x: node.x + node.width,       y: node.y + node.height / 2 },
    { name: 'se', x: node.x + node.width,       y: node.y + node.height },
    { name: 's',  x: node.x + node.width / 2,   y: node.y + node.height },
    { name: 'sw', x: node.x,                   y: node.y + node.height },
    { name: 'w',  x: node.x,                   y: node.y + node.height / 2 },
  ];
  for (const h of handles) {
    if (Math.abs(x - h.x) <= threshold && Math.abs(y - h.y) <= threshold) return h.name;
  }
  return null;
}

// ============================================================
// Rendering
// ============================================================
let svg, edgesLayer, nodesLayer, annotationsLayer, uiLayer;

function initSVG() {
  svg = document.getElementById('canvas');
  edgesLayer = document.getElementById('edges-layer');
  nodesLayer = document.getElementById('nodes-layer');
  annotationsLayer = document.getElementById('annotations-layer');
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
  renderEdges();
  renderNodes();
  renderAnnotations();
}

/** Create the correct SVG shape element for a node. */
function createShapeEl(node, sel) {
  const { x, y, width: w, height: h } = node;
  const cx = x + w / 2, cy = y + h / 2;
  const cls = 'node-shape' + (sel ? ' selected' : '');
  switch (node.shape || 'box') {
    case 'circle':
      return svgEl('ellipse', { cx, cy, rx: w / 2, ry: h / 2, class: cls });
    case 'oval':
      return svgEl('ellipse', { cx, cy, rx: w / 2, ry: h / 2, class: cls });
    case 'diamond': {
      const pts = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
      return svgEl('polygon', { points: pts, class: cls });
    }
    case 'triangle': {
      const pts = `${cx},${y} ${x + w},${y + h} ${x},${y + h}`;
      return svgEl('polygon', { points: pts, class: cls });
    }
    case 'parallelogram': {
      const sk = w * 0.2;
      const pts = `${x + sk},${y} ${x + w},${y} ${x + w - sk},${y + h} ${x},${y + h}`;
      return svgEl('polygon', { points: pts, class: cls });
    }
    default: // box
      return svgEl('rect', { x, y, width: w, height: h, rx: 4, ry: 4, class: cls });
  }
}

function renderNodes() {
  nodesLayer.innerHTML = '';
  for (const node of state.nodes.values()) {
    const sel = state.selected.has(node.id);
    const g = svgEl('g', { 'data-id': node.id, 'data-type': 'node' });

    g.appendChild(createShapeEl(node, sel));

    const lbl = svgEl('text', {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      class: 'node-label',
    });
    lbl.textContent = node.label || '';
    g.appendChild(lbl);

    // Resize handles (only when selected in select mode)
    if (sel && state.tool === 'select') {
      const handles = [
        { name: 'nw', x: node.x,                  y: node.y },
        { name: 'n',  x: node.x + node.width / 2,  y: node.y },
        { name: 'ne', x: node.x + node.width,       y: node.y },
        { name: 'e',  x: node.x + node.width,       y: node.y + node.height / 2 },
        { name: 'se', x: node.x + node.width,       y: node.y + node.height },
        { name: 's',  x: node.x + node.width / 2,   y: node.y + node.height },
        { name: 'sw', x: node.x,                   y: node.y + node.height },
        { name: 'w',  x: node.x,                   y: node.y + node.height / 2 },
      ];
      for (const h of handles) {
        g.appendChild(svgEl('rect', {
          x: h.x - 4, y: h.y - 4, width: 8, height: 8,
          class: 'resize-handle',
          'data-handle': h.name,
        }));
      }
    }

    nodesLayer.appendChild(g);
  }
}

function renderEdges() {
  edgesLayer.innerHTML = '';
  for (const edge of state.edges.values()) {
    const from = state.nodes.get(edge.from);
    const to = state.nodes.get(edge.to);
    if (!from || !to) continue;
    const sel = state.selected.has(edge.id);

    const tc = nodeCenter(to);
    const fc = nodeCenter(from);
    const p1 = borderIntersect(from, tc);
    const p2 = borderIntersect(to, fc);

    const g = svgEl('g', { 'data-id': edge.id, 'data-type': 'edge' });

    // Wide invisible hit area
    g.appendChild(svgEl('line', {
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      class: 'edge-hit',
    }));

    g.appendChild(svgEl('line', {
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      class: 'edge-line' + (sel ? ' selected' : ''),
    }));

    if (edge.label) {
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      // Small background pill for readability
      g.appendChild(svgEl('text', {
        x: mx, y: my - 5,
        'text-anchor': 'middle',
        class: 'edge-label',
      }, edge.label));
    }

    edgesLayer.appendChild(g);
  }
}

function renderAnnotations() {
  annotationsLayer.innerHTML = '';
  for (const ann of state.annotations.values()) {
    const sel = state.selected.has(ann.id);
    const g = svgEl('g', { 'data-id': ann.id, 'data-type': 'annotation' });
    g.appendChild(svgEl('text', {
      x: ann.x, y: ann.y,
      class: 'annotation-text' + (sel ? ' selected' : ''),
    }, ann.text || ''));
    annotationsLayer.appendChild(g);
  }
}

// ============================================================
// Interaction — drag state machine
// ============================================================
let drag = null; // Active drag descriptor

function svgCoords(e) {
  const rect = svg.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/**
 * Hit-test at (x, y). Returns:
 *   {type:'resize', handle, nodeId, node}
 *   {type:'node', id, node}
 *   {type:'edge', id, edge}
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
  }
  const node = getNodeAt(x, y);
  if (node) return { type: 'node', id: node.id, node };
  const edge = getEdgeAt(x, y);
  if (edge) return { type: 'edge', id: edge.id, edge };
  const ann = getAnnotationAt(x, y);
  if (ann) return { type: 'annotation', id: ann.id, ann };
  return { type: 'canvas' };
}

function onMouseDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  const p = svgCoords(e);
  const hit = hitTest(p.x, p.y);

  switch (state.tool) {
    case 'select':    selectMouseDown(p, hit, e); break;
    case 'box':       boxMouseDown(p); break;
    case 'connector': connectorMouseDown(p, hit); break;
    case 'text':      textMouseDown(p, hit); break;
  }
}

function onMouseMove(e) {
  const p = svgCoords(e);
  if (!drag) {
    updateCursor(p);
    return;
  }
  dragMove(p);
}

function onMouseUp(e) {
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
      startX: p.x, startY: p.y,
      orig: { x: node.x, y: node.y, w: node.width, h: node.height },
      moved: false,
    };
    return;
  }

  if (hit.type === 'node') {
    if (!e.shiftKey) state.selected.clear();
    state.selected.add(hit.id);
    render();
    updatePropertiesPanel();
    drag = {
      type: 'move-node',
      nodeId: hit.id,
      startX: p.x, startY: p.y,
      origX: hit.node.x, origY: hit.node.y,
      moved: false,
    };
    return;
  }

  if (hit.type === 'edge') {
    if (!e.shiftKey) state.selected.clear();
    state.selected.add(hit.id);
    render();
    updatePropertiesPanel();
    return; // edges aren't draggable
  }

  if (hit.type === 'annotation') {
    if (!e.shiftKey) state.selected.clear();
    state.selected.add(hit.id);
    render();
    updatePropertiesPanel();
    drag = {
      type: 'move-ann',
      annId: hit.id,
      startX: p.x, startY: p.y,
      origX: hit.ann.x, origY: hit.ann.y,
      moved: false,
    };
    return;
  }

  // Canvas: start rubber-band selection
  if (!e.shiftKey) { state.selected.clear(); render(); updatePropertiesPanel(); }
  drag = { type: 'rubber', startX: p.x, startY: p.y };
}

// --- Box tool ---
function boxMouseDown(p) {
  drag = { type: 'draw-box', startX: p.x, startY: p.y };
  uiLayer.appendChild(svgEl('rect', {
    id: 'tmp', class: 'temp-shape',
    x: p.x, y: p.y, width: 0, height: 0,
  }));
}

// --- Connector tool ---
function connectorMouseDown(p, hit) {
  const node = getNodeAt(p.x, p.y);
  if (!node) return;
  drag = { type: 'draw-edge', fromId: node.id, startX: p.x, startY: p.y };
  const fc = nodeCenter(node);
  uiLayer.appendChild(svgEl('line', {
    id: 'tmp', class: 'temp-connector',
    x1: fc.x, y1: fc.y, x2: fc.x, y2: fc.y,
  }));
}

// --- Text tool ---
function textMouseDown(p, hit) {
  if (hit.type === 'node' || hit.type === 'edge' || hit.type === 'annotation') {
    state.selected.clear();
    state.selected.add(hit.id);
    render();
    updatePropertiesPanel();
    startInlineEdit(hit.id, hit.type);
    return;
  }
  // Create annotation on canvas
  const id = genId();
  state.annotations.set(id, { id, x: p.x, y: p.y + 5, text: 'Text' });
  state.selected.clear();
  state.selected.add(id);
  render();
  updatePropertiesPanel();
  startInlineEdit(id, 'annotation');
  pushHistory();
}

// --- Drag move ---
function dragMove(p) {
  if (drag.type === 'move-node') {
    const dx = p.x - drag.startX, dy = p.y - drag.startY;
    const node = state.nodes.get(drag.nodeId);
    node.x = drag.origX + dx;
    node.y = drag.origY + dy;
    drag.moved = true;
    render();
    return;
  }

  if (drag.type === 'move-ann') {
    const dx = p.x - drag.startX, dy = p.y - drag.startY;
    const ann = state.annotations.get(drag.annId);
    ann.x = drag.origX + dx;
    ann.y = drag.origY + dy;
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
    tmp.setAttribute('x', Math.min(p.x, drag.startX));
    tmp.setAttribute('y', Math.min(p.y, drag.startY));
    tmp.setAttribute('width', Math.abs(p.x - drag.startX));
    tmp.setAttribute('height', Math.abs(p.y - drag.startY));
    return;
  }

  if (drag.type === 'draw-edge') {
    const tmp = document.getElementById('tmp');
    if (!tmp) return;
    const from = state.nodes.get(drag.fromId);
    if (!from) return;
    const p1 = borderIntersect(from, p);
    tmp.setAttribute('x1', p1.x); tmp.setAttribute('y1', p1.y);
    tmp.setAttribute('x2', p.x);  tmp.setAttribute('y2', p.y);
    // Highlight hovered target
    clearClass('connector-hover');
    const target = getNodeAt(p.x, p.y);
    if (target && target.id !== drag.fromId) addClassToNode(target.id, 'connector-hover');
    return;
  }

  if (drag.type === 'rubber') {
    uiLayer.innerHTML = '';
    const x = Math.min(p.x, drag.startX);
    const y = Math.min(p.y, drag.startY);
    const w = Math.abs(p.x - drag.startX);
    const h = Math.abs(p.y - drag.startY);
    uiLayer.appendChild(svgEl('rect', { x, y, width: w, height: h, class: 'selection-box' }));
    return;
  }
}

function dragEnd(p) {
  const d = drag;
  drag = null;

  if (d.type === 'move-node' || d.type === 'move-ann') {
    if (d.moved) pushHistory();
    return;
  }

  if (d.type === 'resize') {
    if (d.moved) pushHistory();
    return;
  }

  if (d.type === 'draw-box') {
    uiLayer.innerHTML = '';
    const w = Math.abs(p.x - d.startX);
    const h = Math.abs(p.y - d.startY);
    if (w < 20 || h < 10) return;
    const id = genId();
    const shape = state.currentShape;
    const defaultLabels = { box: 'Box', circle: 'Circle', oval: 'Oval',
      diamond: 'Diamond', triangle: 'Triangle', parallelogram: 'Step' };
    state.nodes.set(id, {
      id,
      x: Math.min(p.x, d.startX),
      y: Math.min(p.y, d.startY),
      width: w, height: h,
      label: defaultLabels[shape] || 'Shape',
      shape,
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
    state.edges.set(id, { id, from: d.fromId, to: target.id, label: '' });
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
    const x1 = Math.min(p.x, d.startX), y1 = Math.min(p.y, d.startY);
    const x2 = Math.max(p.x, d.startX), y2 = Math.max(p.y, d.startY);
    for (const node of state.nodes.values()) {
      if (node.x >= x1 && node.y >= y1 &&
          node.x + node.width <= x2 && node.y + node.height <= y2) {
        state.selected.add(node.id);
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
  const dx = p.x - drag.startX, dy = p.y - drag.startY;
  const handle = drag.handle;

  let nx = x, ny = y, nw = w, nh = h;
  if (handle.includes('e')) nw = Math.max(40, w + dx);
  if (handle.includes('s')) nh = Math.max(20, h + dy);
  if (handle.includes('w')) { nx = x + dx; nw = Math.max(40, w - dx); if (nw === 40) nx = x + w - 40; }
  if (handle.includes('n')) { ny = y + dy; nh = Math.max(20, h - dy); if (nh === 20) ny = y + h - 20; }

  node.x = nx; node.y = ny; node.width = nw; node.height = nh;
}

function clearClass(cls) {
  svg.querySelectorAll('.' + cls).forEach(el => el.classList.remove(cls));
}

function addClassToNode(nodeId, cls) {
  const el = nodesLayer.querySelector(`[data-id="${nodeId}"] .node-shape`);
  if (el) el.classList.add(cls);
}

// ============================================================
// Inline Editing
// ============================================================
function startInlineEdit(id, type) {
  clearInlineEditor();

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
    const from = state.nodes.get(item.from);
    const to = state.nodes.get(item.to);
    if (!from || !to) return;
    cx = (nodeCenter(from).x + nodeCenter(to).x) / 2;
    cy = (nodeCenter(from).y + nodeCenter(to).y) / 2;
    w = 140;
  } else if (type === 'annotation') {
    item = state.annotations.get(id);
    if (!item) return;
    cx = item.x + 75;
    cy = item.y - 8;
    w = 160;
  }

  const fo = svgEl('foreignObject', {
    id: 'inline-editor',
    x: cx - w / 2, y: cy - 14,
    width: w, height: 28,
  });
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-input';
  input.value = type === 'annotation' ? (item.text || '') : (item.label || '');
  input.style.cssText = 'width:100%;height:100%;';
  fo.appendChild(input);
  uiLayer.appendChild(fo);
  requestAnimationFrame(() => { input.focus(); input.select(); });

  const commit = () => {
    const val = input.value;
    clearInlineEditor();
    if (type === 'node') { if (state.nodes.has(id)) state.nodes.get(id).label = val; }
    else if (type === 'edge') { if (state.edges.has(id)) state.edges.get(id).label = val; }
    else if (type === 'annotation') { if (state.annotations.has(id)) state.annotations.get(id).text = val; }
    pushHistory();
    render();
    updatePropertiesPanel();
  };

  const cancel = () => clearInlineEditor();

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
    e.stopPropagation();
  });
}

function clearInlineEditor() {
  const el = document.getElementById('inline-editor');
  if (el) el.remove();
}

// ============================================================
// Double-click → inline edit
// ============================================================
function onDblClick(e) {
  e.preventDefault();
  const p = svgCoords(e);
  const hit = hitTest(p.x, p.y);
  if (hit.type === 'node' || hit.type === 'edge' || hit.type === 'annotation') {
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

  // Tool shortcuts
  const toolKeys = { s: 'select', b: 'box', c: 'connector', t: 'text' };
  if (!e.ctrlKey && !e.metaKey && !e.altKey && toolKeys[e.key.toLowerCase()]) {
    setTool(toolKeys[e.key.toLowerCase()]);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selected.size === 0) return;
    e.preventDefault();
    deleteSelected();
    return;
  }

  if (e.key === 'Escape') {
    clearInlineEditor();
    if (drag) { drag = null; uiLayer.innerHTML = ''; clearClass('connector-hover'); }
    state.selected.clear();
    render();
    updatePropertiesPanel();
    return;
  }
}

function deleteSelected() {
  if (state.selected.size === 0) return;
  const toDelete = new Set(state.selected);
  for (const id of toDelete) {
    state.nodes.delete(id);
    state.edges.delete(id);
    state.annotations.delete(id);
    // Cascade: remove edges whose endpoints were deleted
    for (const [eid, edge] of state.edges) {
      if (edge.from === id || edge.to === id) state.edges.delete(eid);
    }
  }
  state.selected.clear();
  pushHistory();
  render();
  updatePropertiesPanel();
  updateToolbarStatus();
}

// ============================================================
// Cursor
// ============================================================
const resizeCursors = {
  n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize',
  ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize',
};

function updateCursor(p) {
  if (state.tool !== 'select') { svg.style.cursor = 'crosshair'; return; }
  const hit = hitTest(p.x, p.y);
  if (hit.type === 'resize') svg.style.cursor = resizeCursors[hit.handle] || 'pointer';
  else if (hit.type === 'node' || hit.type === 'annotation') svg.style.cursor = 'move';
  else if (hit.type === 'edge') svg.style.cursor = 'pointer';
  else svg.style.cursor = 'default';
}

// ============================================================
// Properties Panel
// ============================================================
function updatePropertiesPanel() {
  const content = document.getElementById('properties-content');

  if (state.selected.size === 0) {
    content.innerHTML = '<p class="no-selection">Nothing selected</p>';
    return;
  }
  if (state.selected.size > 1) {
    content.innerHTML = `<p class="no-selection">${state.selected.size} items selected</p>`;
    return;
  }

  const id = [...state.selected][0];
  const node = state.nodes.get(id);
  const edge = state.edges.get(id);
  const ann = state.annotations.get(id);

  if (node) {
    renderNodeProps(content, node);
  } else if (edge) {
    renderEdgeProps(content, edge);
  } else if (ann) {
    renderAnnProps(content, ann);
  }
}

function renderNodeProps(container, node) {
  const shapeOpts = ['box', 'circle', 'oval', 'diamond', 'triangle', 'parallelogram']
    .map(s => `<option value="${s}"${(node.shape || 'box') === s ? ' selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
    .join('');
  container.innerHTML = `
    <div class="prop-group"><label>Shape</label><select id="p-shape">${shapeOpts}</select></div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(node.label || '')}"></div>
    <div class="prop-group"><label>X</label><input type="number" id="p-x" value="${Math.round(node.x)}"></div>
    <div class="prop-group"><label>Y</label><input type="number" id="p-y" value="${Math.round(node.y)}"></div>
    <div class="prop-group"><label>Width</label><input type="number" id="p-w" value="${Math.round(node.width)}"></div>
    <div class="prop-group"><label>Height</label><input type="number" id="p-h" value="${Math.round(node.height)}"></div>
  `;
  const shapeEl = document.getElementById('p-shape');
  shapeEl.addEventListener('change', () => {
    node.shape = shapeEl.value;
    pushHistory();
    render();
  });
  bindPropInput('p-label', v => { node.label = v; });
  bindPropInput('p-x', v => { node.x = +v || 0; }, true);
  bindPropInput('p-y', v => { node.y = +v || 0; }, true);
  bindPropInput('p-w', v => { node.width = Math.max(40, +v || 40); }, true);
  bindPropInput('p-h', v => { node.height = Math.max(20, +v || 20); }, true);
}

function renderEdgeProps(container, edge) {
  const fromNode = state.nodes.get(edge.from);
  const toNode = state.nodes.get(edge.to);
  container.innerHTML = `
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(edge.label || '')}"></div>
    <div class="prop-group"><label>From</label><span class="prop-value">${esc(fromNode ? (fromNode.label || fromNode.id) : edge.from)}</span></div>
    <div class="prop-group"><label>To</label><span class="prop-value">${esc(toNode ? (toNode.label || toNode.id) : edge.to)}</span></div>
  `;
  bindPropInput('p-label', v => { edge.label = v; });
}

function renderAnnProps(container, ann) {
  container.innerHTML = `
    <div class="prop-group"><label>Text</label><input type="text" id="p-text" value="${esc(ann.text || '')}"></div>
    <div class="prop-group"><label>X</label><input type="number" id="p-x" value="${Math.round(ann.x)}"></div>
    <div class="prop-group"><label>Y</label><input type="number" id="p-y" value="${Math.round(ann.y)}"></div>
  `;
  bindPropInput('p-text', v => { ann.text = v; });
  bindPropInput('p-x', v => { ann.x = +v || 0; }, true);
  bindPropInput('p-y', v => { ann.y = +v || 0; }, true);
}

function bindPropInput(id, setter, isNumber) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => { setter(el.value); render(); });
  el.addEventListener('change', () => pushHistory());
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// Toolbar & Status
// ============================================================
function setTool(tool) {
  state.tool = tool;
  clearInlineEditor();
  clearClass('connector-hover');
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  svg.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  render();
}

function setCurrentShape(shape) {
  state.currentShape = shape;
  document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.shape === shape);
  });
}

function updateToolbarStatus() {
  const el = document.getElementById('toolbar-status');
  const n = state.nodes.size, e = state.edges.size, a = state.annotations.size;
  el.textContent = `${n} box${n !== 1 ? 'es' : ''}  ·  ${e} connector${e !== 1 ? 's' : ''}  ·  ${a} annotation${a !== 1 ? 's' : ''}`;
}

// ============================================================
// Init
// ============================================================
function init() {
  initSVG();

  // Toolbar tool buttons
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // Shape picker buttons
  document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setCurrentShape(btn.dataset.shape);
      setTool('box'); // auto-switch to shape tool
    });
  });

  // Undo / Redo
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', exportDiagram);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', e => {
    if (e.target.files[0]) {
      importDiagram(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Canvas events
  svg.addEventListener('mousedown', onMouseDown);
  svg.addEventListener('mousemove', onMouseMove);
  svg.addEventListener('mouseup', onMouseUp);
  svg.addEventListener('dblclick', onDblClick);
  svg.addEventListener('mouseleave', () => { if (drag) { dragEnd({ x: 0, y: 0 }); } });

  // Keyboard
  document.addEventListener('keydown', onKeyDown);

  // Set initial tool + seed history
  setTool('select');
  pushHistory(); // history[0] = empty state

  loadDemo();
}

function loadDemo() {
  // Row 1: flow-like shapes
  const n1 = { id: genId(), x: 60,  y: 170, width: 100, height: 60, label: 'Start',       shape: 'oval' };
  const n2 = { id: genId(), x: 220, y: 170, width: 120, height: 60, label: 'Process',      shape: 'box' };
  const n3 = { id: genId(), x: 400, y: 170, width: 100, height: 70, label: 'Decision',     shape: 'diamond' };
  const n4 = { id: genId(), x: 570, y: 150, width: 100, height: 60, label: 'End',          shape: 'oval' };
  const n5 = { id: genId(), x: 400, y: 310, width: 100, height: 60, label: 'Error',        shape: 'parallelogram' };
  // Row 2: extra shapes
  const n6 = { id: genId(), x: 100, y: 340, width: 80,  height: 80, label: 'Note',         shape: 'circle' };
  const n7 = { id: genId(), x: 220, y: 330, width: 130, height: 55, label: 'Step',         shape: 'parallelogram' };
  const n8 = { id: genId(), x: 570, y: 300, width: 100, height: 80, label: 'Warning',      shape: 'triangle' };

  [n1, n2, n3, n4, n5, n6, n7, n8].forEach(n => state.nodes.set(n.id, n));

  const e1 = { id: genId(), from: n1.id, to: n2.id, label: '' };
  const e2 = { id: genId(), from: n2.id, to: n3.id, label: '' };
  const e3 = { id: genId(), from: n3.id, to: n4.id, label: 'yes' };
  const e4 = { id: genId(), from: n3.id, to: n5.id, label: 'no' };
  [e1, e2, e3, e4].forEach(e => state.edges.set(e.id, e));

  const a1 = { id: genId(), x: 60, y: 120, text: 'Sample workflow — try drawing shapes with the toolbar' };
  state.annotations.set(a1.id, a1);

  pushHistory();
  render();
  updatePropertiesPanel();
  updateToolbarStatus();
}

document.addEventListener('DOMContentLoaded', init);
