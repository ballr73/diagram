// editor.js — HTML Diagram Editor

// ============================================================
// State
// ============================================================
const state = {
  nodes: new Map(),       // id → {id, x, y, width, height, label, shape}
  edges: new Map(),       // id → {id, from, to, label, waypoints:[{id,x,y}]}
  lines: new Map(),       // id → {id, x1, y1, x2, y2, waypoints, label, stroke, ...}
  annotations: new Map(), // id → {id, x, y, text}
  selected: new Set(),
  selectedWaypoint: null, // {edgeId?, lineId?, waypointId} — waypoint focused for deletion
  tool: 'select',
  currentShape: 'box',
  nextId: 1,
  history: [],
  historyIndex: -1,
  clipboard: { nodes: [], edges: [], lines: [], annotations: [] },
  pasteOffset: 0,
  zoom: 1.0,
  viewCenterX: 0,
  viewCenterY: 0,
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
    edges: new Map([...state.edges].map(([k, v]) => [k, {
      ...v,
      waypoints: (v.waypoints || []).map(wp => ({ ...wp })),
    }])),
    lines: new Map([...state.lines].map(([k, v]) => [k, {
      ...v,
      waypoints: (v.waypoints || []).map(wp => ({ ...wp })),
    }])),
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
  saveToLocalStorage();
}

// ============================================================
// localStorage persistence
// ============================================================
const LS_KEY = 'diagram-editor';

function saveToLocalStorage() {
  try {
    const data = {
      version: 1,
      nodes: [...state.nodes.values()],
      edges: [...state.edges.values()],
      lines: [...state.lines.values()],
      annotations: [...state.annotations.values()],
      nextId: state.nextId,
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
    state.nodes.clear();
    state.edges.clear();
    state.lines.clear();
    state.annotations.clear();
    state.selected.clear();
    (data.nodes || []).forEach(n => state.nodes.set(n.id, { ...n }));
    (data.edges || []).forEach(e => state.edges.set(e.id, { ...e }));
    (data.lines || []).forEach(l => state.lines.set(l.id, { ...l }));
    (data.annotations || []).forEach(a => state.annotations.set(a.id, { ...a }));
    if (data.nextId) state.nextId = data.nextId;
    return true;
  } catch (_) {
    return false;
  }
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
  state.edges = new Map([...snap.edges].map(([k, v]) => [k, {
    ...v,
    waypoints: (v.waypoints || []).map(wp => ({ ...wp })),
  }]));
  state.lines = new Map([...(snap.lines || [])].map(([k, v]) => [k, {
    ...v,
    waypoints: (v.waypoints || []).map(wp => ({ ...wp })),
  }]));
  state.annotations = new Map([...snap.annotations].map(([k, v]) => [k, { ...v }]));
  state.nextId = snap.nextId;
  state.selected.clear();
  render();
  updatePropertiesPanel();
}

// ============================================================
// JSON Serialization — Open / Save
// ============================================================
function saveDiagram() {
  const defaultName = 'diagram';
  const name = window.prompt('Save as:', defaultName);
  if (name === null) return; // cancelled
  const filename = (name.trim() || defaultName).replace(/\.json$/i, '') + '.json';
  const data = {
    version: 1,
    nodes: [...state.nodes.values()],
    edges: [...state.edges.values()],
    lines: [...state.lines.values()],
    annotations: [...state.annotations.values()],
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
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
      state.lines.clear();
      state.annotations.clear();
      state.selected.clear();
      (data.nodes || []).forEach(n => state.nodes.set(n.id, { ...n }));
      (data.edges || []).forEach(e => state.edges.set(e.id, { ...e }));
      (data.lines || []).forEach(l => state.lines.set(l.id, { ...l }));
      (data.annotations || []).forEach(a => state.annotations.set(a.id, { ...a }));
      // Advance nextId past all imported ids
      const allNums = [...state.nodes.keys(), ...state.edges.keys(), ...state.lines.keys(), ...state.annotations.keys()]
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
  for (const node of state.nodes.values()) {
    if (node.type === 'symbol' && node.iconPath) paths.add(node.iconPath);
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
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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
      minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 500; maxY = 400; }

  const viewX = minX - PADDING;
  const viewY = minY - PADDING;
  const viewW = (maxX - minX) + PADDING * 2;
  const viewH = (maxY - minY) + PADDING * 2;

  // Render without selection so the DOM clone has clean styling
  const savedSelected = new Set(state.selected);
  state.selected.clear();
  render();

  // Clone the live SVG
  const srcSvg = document.getElementById('canvas');
  const clone = srcSvg.cloneNode(true);

  // Restore selection and re-render
  state.selected = savedSelected;
  render();

  // Strip interactive-only content from clone
  const uiLayer = clone.querySelector('#ui-layer');
  if (uiLayer) uiLayer.innerHTML = '';
  clone.querySelectorAll('.resize-handle').forEach(el => el.remove());
  clone.querySelectorAll('.line-endpoint-handle').forEach(el => el.remove());

  // Replace icon <image> hrefs with embedded data URIs
  clone.querySelectorAll('image').forEach(imgEl => {
    const href = imgEl.getAttribute('href') ||
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diagram.svg';
  a.click();
  URL.revokeObjectURL(url);
}

async function exportPNG() {
  const svgString = await buildExportSVG();

  // Parse width/height from the SVG for canvas sizing
  const match = svgString.match(/width="([^"]+)"\s+height="([^"]+)"/);
  const scale = window.devicePixelRatio || 1;
  const w = match ? parseFloat(match[1]) : 800;
  const h = match ? parseFloat(match[2]) : 600;

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width  = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob(pngBlob => {
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = 'diagram.png';
      a.click();
      URL.revokeObjectURL(pngUrl);
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('PNG export failed. Try SVG export instead.');
  };
  img.src = url;
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
  const entries = [...state.annotations.entries()];
  for (let i = entries.length - 1; i >= 0; i--) {
    const [, ann] = entries[i];
    const bb = annBBox(ann);
    const pad = 4;
    if (x >= bb.x - pad && x <= bb.x + bb.w + pad &&
        y >= bb.y - pad && y <= bb.y + bb.h + pad) {
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
    if (!rawLine) { result.push(''); continue; }
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
  const charWidth  = fontSize * 0.6;

  // Width: explicit > auto-from-text (capped at default max)
  const rawLines = (ann.text || 'Text').split('\n');
  const autoW = Math.max(40, Math.max(...rawLines.map(l => (l || '').length)) * charWidth);
  const w = ann.width || Math.min(autoW, ANN_DEFAULT_MAX_WIDTH);

  // Height: explicit > derived from wrapped line count
  const wrappedLines = wrapTextToLines(ann.text || 'Text', w, fontSize);
  const h = ann.height || wrappedLines.length * lineHeight;

  const align = ann.align || 'left';
  let x;
  if (align === 'center')     x = ann.x - w / 2;
  else if (align === 'right') x = ann.x - w;
  else                        x = ann.x;
  return { x, y: ann.y - fontSize, w, h };
}

function getEdgeAt(x, y, threshold = 8) {
  for (const edge of state.edges.values()) {
    const pts = edgePoints(edge);
    if (!pts) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      if (segmentDist(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < threshold) return edge;
    }
  }
  return null;
}

/** Returns the ordered list of points for an edge: [p1, ...waypoints, p2] */
function edgePoints(edge) {
  const from = state.nodes.get(edge.from);
  const to   = state.nodes.get(edge.to);
  if (!from || !to) return null;
  const wps = edge.waypoints || [];
  const firstTarget = wps.length > 0 ? wps[0]             : nodeCenter(to);
  const lastSource  = wps.length > 0 ? wps[wps.length - 1] : nodeCenter(from);
  const p1 = borderIntersect(from, firstTarget);
  const p2 = borderIntersect(to,   lastSource);
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

function getAnnResizeHandle(ann, x, y, threshold = 6) {
  const bb = annBBox(ann);
  const handles = [
    { name: 'nw', x: bb.x,            y: bb.y },
    { name: 'n',  x: bb.x + bb.w / 2, y: bb.y },
    { name: 'ne', x: bb.x + bb.w,     y: bb.y },
    { name: 'e',  x: bb.x + bb.w,     y: bb.y + bb.h / 2 },
    { name: 'se', x: bb.x + bb.w,     y: bb.y + bb.h },
    { name: 's',  x: bb.x + bb.w / 2, y: bb.y + bb.h },
    { name: 'sw', x: bb.x,            y: bb.y + bb.h },
    { name: 'w',  x: bb.x,            y: bb.y + bb.h / 2 },
  ];
  for (const h of handles) {
    if (Math.abs(x - h.x) <= threshold && Math.abs(y - h.y) <= threshold) return h.name;
  }
  return null;
}

// ============================================================
// Rendering
// ============================================================
let svg, linesLayer, edgesLayer, nodesLayer, annotationsLayer, uiLayer;

function initSVG() {
  svg = document.getElementById('canvas');
  linesLayer = document.getElementById('lines-layer');
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
  renderLines();
  renderEdges();
  renderNodes();
  renderAnnotations();
}

/**
 * Apply font style properties as inline style on an SVG text element.
 * defaults: { size, bold, italic, underline }
 */
function applyFontStyle(el, item, defaults = {}) {
  const size      = item.fontSize    !== undefined ? item.fontSize    : (defaults.size      || 13);
  const bold      = item.fontBold    !== undefined ? item.fontBold    : (defaults.bold      || false);
  const italic    = item.fontItalic  !== undefined ? item.fontItalic  : (defaults.italic    || false);
  const underline = item.fontUnderline !== undefined ? item.fontUnderline : (defaults.underline || false);
  el.style.fontSize      = size + 'px';
  el.style.fontWeight    = bold      ? 'bold'      : 'normal';
  el.style.fontStyle     = italic    ? 'italic'    : 'normal';
  el.style.textDecoration = underline ? 'underline' : 'none';
}

/** Apply stroke-dasharray and stroke-linecap for a given strokeStyle. */
function applyStrokeStyle(el, style) {
  switch (style) {
    case 'dashed':
      el.style.strokeDasharray = '8 4';
      el.style.strokeLinecap   = 'square';
      break;
    case 'dotted':
      el.style.strokeDasharray = '2 4';
      el.style.strokeLinecap   = 'round';
      break;
    default: // solid
      el.style.strokeDasharray = 'none';
      el.style.strokeLinecap   = 'square';
  }
}

/** Create the correct SVG shape element for a node. */
function createShapeEl(node, sel) {
  const { x, y, width: w, height: h } = node;
  const cx = x + w / 2, cy = y + h / 2;
  const cls = 'node-shape' + (sel ? ' selected' : '');
  let el;
  switch (node.shape || 'box') {
    case 'circle':
      el = svgEl('ellipse', { cx, cy, rx: w / 2, ry: h / 2, class: cls }); break;
    case 'oval':
      el = svgEl('ellipse', { cx, cy, rx: w / 2, ry: h / 2, class: cls }); break;
    case 'diamond': {
      const pts = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
      el = svgEl('polygon', { points: pts, class: cls }); break;
    }
    case 'triangle': {
      const pts = `${cx},${y} ${x + w},${y + h} ${x},${y + h}`;
      el = svgEl('polygon', { points: pts, class: cls }); break;
    }
    case 'parallelogram': {
      const sk = w * 0.2;
      const pts = `${x + sk},${y} ${x + w},${y} ${x + w - sk},${y + h} ${x},${y + h}`;
      el = svgEl('polygon', { points: pts, class: cls }); break;
    }
    default: // box
      el = svgEl('rect', { x, y, width: w, height: h, rx: 4, ry: 4, class: cls }); break;
  }
  // Apply custom colours via CSS custom properties (overridden by !important on selected state)
  if (node.fill)   el.style.setProperty('--node-fill',   node.fill);
  if (node.stroke) el.style.setProperty('--node-stroke', node.stroke);
  return el;
}

function renderNodes() {
  nodesLayer.innerHTML = '';
  for (const node of state.nodes.values()) {
    const sel = state.selected.has(node.id);
    const g = svgEl('g', { 'data-id': node.id, 'data-type': 'node' });

    if (node.type === 'symbol') {
      // Symbol node: SVG image + selection outline + label below
      const img = svgEl('image', {
        href: node.iconPath,
        x: node.x, y: node.y,
        width: node.width, height: node.height,
        preserveAspectRatio: 'xMidYMid meet',
      });
      g.appendChild(img);

      if (sel) {
        const outline = svgEl('rect', {
          x: node.x, y: node.y,
          width: node.width, height: node.height,
          class: 'node-shape selected',
          fill: 'none',
        });
        g.appendChild(outline);
      }

      if (node.label) {
        const lbl = svgEl('text', {
          x: node.x + node.width / 2,
          y: node.y + node.height + 12,
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          class: 'node-label',
        });
        lbl.textContent = node.label;
        applyFontStyle(lbl, node, { size: 11 });
        g.appendChild(lbl);
      }
    } else {
      const shapeEl = createShapeEl(node, sel);
      shapeEl.style.fillOpacity = (node.opacity ?? 100) / 100;
      applyStrokeStyle(shapeEl, node.strokeStyle);
      g.appendChild(shapeEl);

      const lbl = svgEl('text', {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        class: 'node-label',
      });
      lbl.textContent = node.label || '';
      applyFontStyle(lbl, node, { size: 13 });
      g.appendChild(lbl);
    }

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

/** Returns polyline points for a line: [start, ...waypoints, end]. */
function linePoints(line) {
  const pts = [{ x: line.x1, y: line.y1 }];
  if (line.waypoints) pts.push(...line.waypoints);
  pts.push({ x: line.x2, y: line.y2 });
  return pts;
}

function getLineAt(x, y, threshold = 8) {
  for (const line of state.lines.values()) {
    const pts = linePoints(line);
    for (let i = 0; i < pts.length - 1; i++) {
      if (segmentDist(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < threshold) return line;
    }
  }
  return null;
}

function renderLines() {
  linesLayer.innerHTML = '';
  for (const line of state.lines.values()) {
    const sel = state.selected.has(line.id);
    const pts = linePoints(line);
    const pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ');
    const defaultStroke = '#64748b';
    const selStroke     = '#2563eb';
    const strokeColor   = sel ? selStroke : (line.stroke || defaultStroke);
    const strokeWidth   = sel ? '2' : '1.5';

    const g = svgEl('g', { 'data-id': line.id, 'data-type': 'line' });

    // Wide invisible hit area
    g.appendChild(svgEl('polyline', { points: pointsStr, class: 'edge-hit' }));

    // Resolve symbol markers
    const startSym = line.startSymbol || 'none';
    const endSym   = line.endSymbol   || 'none';
    const lineAttrs = {
      points: pointsStr,
      class: 'edge-line' + (sel ? ' selected' : ''),
    };
    if (startSym !== 'none') lineAttrs['marker-start'] = sel ? `url(#${startSym}-marker-sel)` : `url(#${startSym}-marker)`;
    if (endSym   !== 'none') lineAttrs['marker-end']   = sel ? `url(#${endSym}-marker-sel)`   : `url(#${endSym}-marker)`;

    const lineEl = svgEl('polyline', lineAttrs);
    lineEl.style.stroke      = strokeColor;
    lineEl.style.strokeWidth = strokeWidth;
    lineEl.style.color       = strokeColor;
    applyStrokeStyle(lineEl, line.strokeStyle);
    g.appendChild(lineEl);

    // Label at midpoint
    if (line.label) {
      const mid = pathMidpoint(pts);
      const lblEl = svgEl('text', {
        x: mid.x, y: mid.y - 5,
        'text-anchor': 'middle',
        class: 'edge-label',
      }, line.label);
      applyFontStyle(lblEl, line, { size: 11 });
      g.appendChild(lblEl);
    }

    if (sel) {
      // Waypoint handles
      if (line.waypoints && line.waypoints.length > 0) {
        for (const wp of line.waypoints) {
          g.appendChild(svgEl('circle', {
            cx: wp.x, cy: wp.y, r: 5,
            class: 'waypoint-handle',
            'data-wp-id': wp.id,
          }));
        }
      }
      // Endpoint handles
      g.appendChild(svgEl('circle', {
        cx: line.x1, cy: line.y1, r: 5,
        class: 'line-endpoint-handle',
        'data-which': 'start',
      }));
      g.appendChild(svgEl('circle', {
        cx: line.x2, cy: line.y2, r: 5,
        class: 'line-endpoint-handle',
        'data-which': 'end',
      }));
    }

    linesLayer.appendChild(g);
  }
}

function renderEdges() {
  edgesLayer.innerHTML = '';
  for (const edge of state.edges.values()) {
    const pts = edgePoints(edge);
    if (!pts) continue;
    const sel = state.selected.has(edge.id);
    const dir = edge.direction || 'forward';

    const pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ');

    const g = svgEl('g', { 'data-id': edge.id, 'data-type': 'edge' });

    // Wide invisible hit area
    g.appendChild(svgEl('polyline', {
      points: pointsStr,
      class: 'edge-hit',
    }));

    // Resolve stroke colour: use selection colour when selected, custom or default otherwise
    const defaultStroke = '#64748b';
    const selStroke     = '#2563eb';
    const strokeColor   = sel ? selStroke : (edge.stroke || defaultStroke);
    const strokeWidth   = sel ? '2' : '1.5';

    // Resolve marker URLs based on direction
    const endUrl   = sel ? 'url(#arrowhead-sel)'       : 'url(#arrowhead)';
    const startUrl = sel ? 'url(#arrowhead-start-sel)' : 'url(#arrowhead-start)';
    const lineAttrs = {
      points: pointsStr,
      class: 'edge-line' + (sel ? ' selected' : ''),
    };
    if (dir === 'forward' || dir === 'both') lineAttrs['marker-end']   = endUrl;
    if (dir === 'back'    || dir === 'both') lineAttrs['marker-start'] = startUrl;

    const lineEl = svgEl('polyline', lineAttrs);
    lineEl.style.stroke      = strokeColor;
    lineEl.style.strokeWidth = strokeWidth;
    lineEl.style.color       = strokeColor;
    applyStrokeStyle(lineEl, edge.strokeStyle);
    g.appendChild(lineEl);

    if (edge.label) {
      const mid = pathMidpoint(pts);
      const lblEl = svgEl('text', {
        x: mid.x, y: mid.y - 5,
        'text-anchor': 'middle',
        class: 'edge-label',
      }, edge.label);
      applyFontStyle(lblEl, edge, { size: 11 });
      g.appendChild(lblEl);
    }

    // Waypoint handles — shown when edge is selected
    if (sel && edge.waypoints && edge.waypoints.length > 0) {
      for (const wp of edge.waypoints) {
        g.appendChild(svgEl('circle', {
          cx: wp.x, cy: wp.y, r: 5,
          class: 'waypoint-handle',
          'data-wp-id': wp.id,
        }));
      }
    }

    edgesLayer.appendChild(g);
  }
}

function renderAnnotations() {
  annotationsLayer.innerHTML = '';
  for (const ann of state.annotations.values()) {
    const sel = state.selected.has(ann.id);
    const fontSize = ann.fontSize || 13;
    const lineHeight = fontSize * 1.4;
    const align = ann.align || 'left';
    const textAnchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const pad = 6;
    const bb = annBBox(ann);

    const g = svgEl('g', { 'data-id': ann.id, 'data-type': 'annotation' });

    // Optional background fill / border rect
    if (ann.fill || ann.stroke) {
      const rect = svgEl('rect', {
        x: bb.x - pad, y: bb.y - pad,
        width: bb.w + pad * 2, height: bb.h + pad * 2,
        rx: 3, ry: 3,
        class: 'annotation-bg',
      });
      if (ann.fill)   rect.style.fill = ann.fill;
      if (ann.stroke) {
        rect.style.stroke = ann.stroke;
        rect.style.strokeWidth = '1.5';
        applyStrokeStyle(rect, ann.strokeStyle);
      }
      g.appendChild(rect);
    }

    // Selection indicator (dashed blue rect)
    if (sel) {
      g.appendChild(svgEl('rect', {
        x: bb.x - pad, y: bb.y - pad,
        width: bb.w + pad * 2, height: bb.h + pad * 2,
        rx: 3, ry: 3,
        class: 'annotation-selection',
      }));

      // Resize handles
      const handles = [
        { name: 'nw', x: bb.x - pad,            y: bb.y - pad },
        { name: 'n',  x: bb.x + bb.w / 2,        y: bb.y - pad },
        { name: 'ne', x: bb.x + bb.w + pad,       y: bb.y - pad },
        { name: 'e',  x: bb.x + bb.w + pad,       y: bb.y + bb.h / 2 },
        { name: 'se', x: bb.x + bb.w + pad,       y: bb.y + bb.h + pad },
        { name: 's',  x: bb.x + bb.w / 2,         y: bb.y + bb.h + pad },
        { name: 'sw', x: bb.x - pad,              y: bb.y + bb.h + pad },
        { name: 'w',  x: bb.x - pad,              y: bb.y + bb.h / 2 },
      ];
      for (const h of handles) {
        g.appendChild(svgEl('rect', {
          x: h.x - 4, y: h.y - 4, width: 8, height: 8,
          class: 'resize-handle',
          'data-handle': h.name,
        }));
      }
    }

    // Text element with tspan per wrapped line
    const textEl = svgEl('text', {
      x: ann.x, y: ann.y,
      'text-anchor': textAnchor,
      class: 'annotation-text',
    });
    textEl.style.fill = ann.color || '#7c3aed';
    applyFontStyle(textEl, ann, { size: 13, italic: true });

    const wrappedLines = wrapTextToLines(ann.text || '', bb.w, fontSize);
    wrappedLines.forEach((line, i) => {
      const tspan = svgEl('tspan', { x: ann.x, dy: i === 0 ? '0' : `${lineHeight}` }, line || '\u200b');
      textEl.appendChild(tspan);
    });

    g.appendChild(textEl);
    annotationsLayer.appendChild(g);
  }
}

// ============================================================
// Interaction — drag state machine
// ============================================================
let drag = null;    // Active draw/move/resize drag descriptor
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
      if (Math.hypot(x - line.x1, y - line.y1) <= 7) return { type: 'line-endpoint', which: 'start', lineId };
      if (Math.hypot(x - line.x2, y - line.y2) <= 7) return { type: 'line-endpoint', which: 'end',   lineId };
    }
    // Waypoint handles on selected edges and lines
    for (const selId of state.selected) {
      const edge = state.edges.get(selId);
      if (edge && edge.waypoints) {
        for (const wp of edge.waypoints) {
          if (Math.hypot(x - wp.x, y - wp.y) <= 7) return { type: 'waypoint', edgeId: selId, waypointId: wp.id };
        }
      }
      const line = state.lines.get(selId);
      if (line && line.waypoints) {
        for (const wp of line.waypoints) {
          if (Math.hypot(x - wp.x, y - wp.y) <= 7) return { type: 'line-waypoint', lineId: selId, waypointId: wp.id };
        }
      }
    }
  }
  const node = getNodeAt(x, y);
  if (node) return { type: 'node', id: node.id, node };
  const edge = getEdgeAt(x, y);
  if (edge) return { type: 'edge', id: edge.id, edge };
  const line = getLineAt(x, y);
  if (line) return { type: 'line', id: line.id, line };
  const ann = getAnnotationAt(x, y);
  if (ann) return { type: 'annotation', id: ann.id, ann };
  return { type: 'canvas' };
}

function onMouseDown(e) {
  // Right-click: start pan
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

  if (e.button !== 0) return;
  e.preventDefault();
  const p = svgCoords(e);
  const hit = hitTest(p.x, p.y);

  switch (state.tool) {
    case 'select':    selectMouseDown(p, hit, e); break;
    case 'box':       boxMouseDown(p); break;
    case 'connector': connectorMouseDown(p, hit); break;
    case 'line':      lineMouseDown(p); break;
    case 'text':      textMouseDown(p, hit); break;
  }
}

function onMouseMove(e) {
  // Pan takes priority
  if (panDrag) {
    state.viewCenterX = panDrag.startCenterX - (e.clientX - panDrag.startScreenX) / state.zoom;
    state.viewCenterY = panDrag.startCenterY - (e.clientY - panDrag.startScreenY) / state.zoom;
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
      startX: p.x, startY: p.y,
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
      startX: p.x, startY: p.y,
      orig: { x: bb.x, y: bb.y, w: bb.w, h: bb.h },
      moved: false,
    };
    return;
  }

  if (hit.type === 'waypoint') {
    state.selectedWaypoint = { edgeId: hit.edgeId, waypointId: hit.waypointId };
    drag = { type: 'move-waypoint', edgeId: hit.edgeId, waypointId: hit.waypointId, moved: false };
    return;
  }

  if (hit.type === 'line-waypoint') {
    state.selectedWaypoint = { lineId: hit.lineId, waypointId: hit.waypointId };
    drag = { type: 'move-waypoint', lineId: hit.lineId, waypointId: hit.waypointId, moved: false };
    return;
  }

  if (hit.type === 'line-endpoint') {
    state.selectedWaypoint = null;
    drag = { type: 'move-line-endpoint', lineId: hit.lineId, which: hit.which, moved: false };
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
      startX: p.x, startY: p.y,
      origX1: ln.x1, origY1: ln.y1,
      origX2: ln.x2, origY2: ln.y2,
      origWaypoints: (ln.waypoints || []).map(wp => ({ ...wp })),
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

  // Canvas: start rubber-band selection
  state.selectedWaypoint = null;
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

// --- Line tool ---
function lineMouseDown(p) {
  drag = { type: 'draw-line', startX: p.x, startY: p.y };
  uiLayer.appendChild(svgEl('line', {
    id: 'tmp', class: 'temp-connector',
    x1: p.x, y1: p.y, x2: p.x, y2: p.y,
  }));
}

// --- Text tool ---
function textMouseDown(p, hit) {
  if (hit.type === 'node' || hit.type === 'edge' || hit.type === 'line' || hit.type === 'annotation') {
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

// Build the appropriate drag descriptor for a move operation.
// If multiple movable items are selected, returns a move-multi drag.
// Otherwise returns a single-item move-node or move-ann drag.
function startMoveDrag(p) {
  const movable = [...state.selected].filter(id =>
    state.nodes.has(id) || state.annotations.has(id)
  );

  if (movable.length > 1) {
    const origins = {};
    for (const id of movable) {
      const item = state.nodes.get(id) || state.annotations.get(id);
      origins[id] = { x: item.x, y: item.y };
    }
    return { type: 'move-multi', startX: p.x, startY: p.y, origins, moved: false };
  }

  // Single item
  const id = movable[0];
  if (state.nodes.has(id)) {
    const node = state.nodes.get(id);
    return { type: 'move-node', nodeId: id, startX: p.x, startY: p.y, origX: node.x, origY: node.y, moved: false };
  }
  const ann = state.annotations.get(id);
  return { type: 'move-ann', annId: id, startX: p.x, startY: p.y, origX: ann.x, origY: ann.y, moved: false };
}

// --- Drag move ---
function dragMove(p) {
  if (drag.type === 'move-multi') {
    const dx = p.x - drag.startX, dy = p.y - drag.startY;
    for (const [id, orig] of Object.entries(drag.origins)) {
      const item = state.nodes.get(id) || state.annotations.get(id);
      if (item) { item.x = orig.x + dx; item.y = orig.y + dy; }
    }
    drag.moved = true;
    render();
    return;
  }

  if (drag.type === 'move-waypoint') {
    if (drag.edgeId) {
      const edge = state.edges.get(drag.edgeId);
      if (edge && edge.waypoints) {
        const wp = edge.waypoints.find(w => w.id === drag.waypointId);
        if (wp) { wp.x = p.x; wp.y = p.y; drag.moved = true; render(); }
      }
    } else if (drag.lineId) {
      const line = state.lines.get(drag.lineId);
      if (line && line.waypoints) {
        const wp = line.waypoints.find(w => w.id === drag.waypointId);
        if (wp) { wp.x = p.x; wp.y = p.y; drag.moved = true; render(); }
      }
    }
    return;
  }

  if (drag.type === 'move-node') {
    const dx = p.x - drag.startX, dy = p.y - drag.startY;
    const node = state.nodes.get(drag.nodeId);
    node.x = drag.origX + dx;
    node.y = drag.origY + dy;
    drag.moved = true;
    render();
    return;
  }

  if (drag.type === 'move-line-endpoint') {
    const line = state.lines.get(drag.lineId);
    if (line) {
      if (drag.which === 'start') { line.x1 = p.x; line.y1 = p.y; }
      else                        { line.x2 = p.x; line.y2 = p.y; }
      drag.moved = true;
      render();
    }
    return;
  }

  if (drag.type === 'move-line') {
    const dx = p.x - drag.startX, dy = p.y - drag.startY;
    const line = state.lines.get(drag.lineId);
    if (line) {
      line.x1 = drag.origX1 + dx; line.y1 = drag.origY1 + dy;
      line.x2 = drag.origX2 + dx; line.y2 = drag.origY2 + dy;
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
    if (tmp) { tmp.setAttribute('x2', p.x); tmp.setAttribute('y2', p.y); }
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

  if (d.type === 'move-waypoint') {
    if (d.moved) pushHistory();
    return;
  }

  if (d.type === 'move-node' || d.type === 'move-ann' || d.type === 'move-multi') {
    if (d.moved) pushHistory();
    return;
  }

  if (d.type === 'move-line' || d.type === 'move-line-endpoint') {
    if (d.moved) pushHistory();
    return;
  }

  if (d.type === 'resize') {
    if (d.moved) pushHistory();
    return;
  }

  if (d.type === 'resize-ann') {
    if (d.moved) { pushHistory(); updatePropertiesPanel(); }
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
    state.edges.set(id, { id, from: d.fromId, to: target.id, label: '', direction: 'forward' });
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
      x1: d.startX, y1: d.startY,
      x2: p.x,      y2: p.y,
      waypoints:    [],
      startSymbol:  'none',
      endSymbol:    'none',
      label:        '',
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

function applyAnnResize(p) {
  const ann = state.annotations.get(drag.annId);
  if (!ann) return;
  const { x, y, w, h } = drag.orig;
  const dx = p.x - drag.startX, dy = p.y - drag.startY;
  const handle = drag.handle;
  const fontSize = ann.fontSize || 13;
  const minW = 40, minH = fontSize * 1.4;

  let nx = x, ny = y, nw = w, nh = h;
  if (handle.includes('e')) nw = Math.max(minW, w + dx);
  if (handle.includes('s')) nh = Math.max(minH, h + dy);
  if (handle.includes('w')) { nx = x + dx; nw = Math.max(minW, w - dx); if (nw === minW) nx = x + w - minW; }
  if (handle.includes('n')) { ny = y + dy; nh = Math.max(minH, h - dy); if (nh === minH) ny = y + h - minH; }

  ann.width  = nw;
  ann.height = nh;

  // Recompute anchor point from new top-left (nx, ny) and alignment
  const align = ann.align || 'left';
  if (align === 'center')     ann.x = nx + nw / 2;
  else if (align === 'right') ann.x = nx + nw;
  else                        ann.x = nx;
  ann.y = ny + fontSize; // baseline = top of box + one line height
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

  // Annotations use a resizable textarea to support multi-line text
  if (type === 'annotation') {
    const ann = state.annotations.get(id);
    if (!ann) return;
    const bb  = annBBox(ann);
    const pad = 8;
    const fw  = Math.max(160, bb.w + pad * 2);
    const fh  = Math.max(60,  bb.h + pad * 2 + 10);
    const fo  = svgEl('foreignObject', {
      id: 'inline-editor',
      x: bb.x - pad, y: bb.y - pad,
      width: fw, height: fh,
    });
    const ta = document.createElement('textarea');
    ta.className   = 'inline-input inline-textarea';
    ta.value       = ann.text || '';
    ta.style.cssText = `width:100%;height:100%;resize:both;box-sizing:border-box;font-size:${ann.fontSize || 13}px;text-align:${ann.align || 'left'};`;
    fo.appendChild(ta);
    uiLayer.appendChild(fo);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    const commit = () => {
      const val = ta.value;
      clearInlineEditor();
      if (state.annotations.has(id)) state.annotations.get(id).text = val;
      pushHistory();
      render();
      updatePropertiesPanel();
    };
    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', e => {
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
    x: cx - w / 2, y: cy - 14,
    width: w, height: 28,
  });
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-input';
  input.value = item.label || '';
  input.style.cssText = 'width:100%;height:100%;';
  fo.appendChild(input);
  uiLayer.appendChild(fo);
  requestAnimationFrame(() => { input.focus(); input.select(); });

  const commit = () => {
    const val = input.value;
    clearInlineEditor();
    if (type === 'node') { if (state.nodes.has(id)) state.nodes.get(id).label = val; }
    else if (type === 'edge') { if (state.edges.has(id)) state.edges.get(id).label = val; }
    else if (type === 'line') { if (state.lines.has(id)) state.lines.get(id).label = val; }
    pushHistory();
    render();
    updatePropertiesPanel();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); clearInlineEditor(); }
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
    const pts  = edgePoints(edge);
    if (!pts) return;

    let bestSeg = 0, bestDist = Infinity, bestPt = { x: p.x, y: p.y };
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 0
        ? Math.max(0, Math.min(1, ((p.x - pts[i].x) * dx + (p.y - pts[i].y) * dy) / lenSq))
        : 0;
      const proj = { x: pts[i].x + t * dx, y: pts[i].y + t * dy };
      const d = Math.hypot(p.x - proj.x, p.y - proj.y);
      if (d < bestDist) { bestDist = d; bestSeg = i; bestPt = proj; }
    }

    if (!edge.waypoints) edge.waypoints = [];
    edge.waypoints.splice(bestSeg, 0, { id: genId(), x: bestPt.x, y: bestPt.y });

    state.selected.clear();
    state.selected.add(edge.id);
    pushHistory();
    render();
    updatePropertiesPanel();
    return;
  }

  if (hit.type === 'line') {
    const line = state.lines.get(hit.id);
    const pts  = linePoints(line);

    let bestSeg = 0, bestDist = Infinity, bestPt = { x: p.x, y: p.y };
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 0
        ? Math.max(0, Math.min(1, ((p.x - pts[i].x) * dx + (p.y - pts[i].y) * dy) / lenSq))
        : 0;
      const proj = { x: pts[i].x + t * dx, y: pts[i].y + t * dy };
      const d = Math.hypot(p.x - proj.x, p.y - proj.y);
      if (d < bestDist) { bestDist = d; bestSeg = i; bestPt = proj; }
    }

    if (!line.waypoints) line.waypoints = [];
    line.waypoints.splice(bestSeg, 0, { id: genId(), x: bestPt.x, y: bestPt.y });

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

  // Tool shortcuts
  const toolKeys = { s: 'select', b: 'box', c: 'connector', l: 'line', t: 'text' };
  if (!e.ctrlKey && !e.metaKey && !e.altKey && toolKeys[e.key.toLowerCase()]) {
    setTool(toolKeys[e.key.toLowerCase()]);
    return;
  }

  // Icon library toggle
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'i') {
    document.getElementById('btn-toggle-icons').click();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); copySelected(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); cutSelected(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); pasteClipboard(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }

  // Zoom shortcuts
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '0') { e.preventDefault(); setZoom(1.0); return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '0') { e.preventDefault(); fitWindow(); return; }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    // Delete focused waypoint first, otherwise delete selected elements
    if (state.selectedWaypoint) {
      e.preventDefault();
      if (state.selectedWaypoint.edgeId) {
        const { edgeId, waypointId } = state.selectedWaypoint;
        const edge = state.edges.get(edgeId);
        if (edge && edge.waypoints) {
          edge.waypoints = edge.waypoints.filter(wp => wp.id !== waypointId);
          state.selectedWaypoint = null;
          pushHistory();
          render();
        }
      } else if (state.selectedWaypoint.lineId) {
        const { lineId, waypointId } = state.selectedWaypoint;
        const line = state.lines.get(lineId);
        if (line && line.waypoints) {
          line.waypoints = line.waypoints.filter(wp => wp.id !== waypointId);
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
    const ann  = state.annotations.get(id);
    if (node) items.push({ item: node, type: 'node' });
    else if (ann) items.push({ item: ann, type: 'annotation' });
  }
  return items;
}

function setItemPos(entry, x, y) {
  entry.item.x = x;
  entry.item.y = y;
}

function alignLeft() {
  const items = getAlignItems();
  if (items.length < 2) return;
  const minX = Math.min(...items.map(e => e.item.x));
  items.forEach(e => setItemPos(e, minX, e.item.y));
  pushHistory(); render();
}

function alignRight() {
  const items = getAlignItems();
  if (items.length < 2) return;
  const maxRight = Math.max(...items.map(e => e.item.x + (e.item.width || 0)));
  items.forEach(e => setItemPos(e, maxRight - (e.item.width || 0), e.item.y));
  pushHistory(); render();
}

function alignCenterH() {
  const items = getAlignItems();
  if (items.length < 2) return;
  const meanCX = items.reduce((s, e) => s + e.item.x + (e.item.width || 0) / 2, 0) / items.length;
  items.forEach(e => setItemPos(e, meanCX - (e.item.width || 0) / 2, e.item.y));
  pushHistory(); render();
}

function alignTop() {
  const items = getAlignItems();
  if (items.length < 2) return;
  const minY = Math.min(...items.map(e => e.item.y));
  items.forEach(e => setItemPos(e, e.item.x, minY));
  pushHistory(); render();
}

function alignBottom() {
  const items = getAlignItems();
  if (items.length < 2) return;
  const maxBottom = Math.max(...items.map(e => e.item.y + (e.item.height || 0)));
  items.forEach(e => setItemPos(e, e.item.x, maxBottom - (e.item.height || 0)));
  pushHistory(); render();
}

function alignCenterV() {
  const items = getAlignItems();
  if (items.length < 2) return;
  const meanCY = items.reduce((s, e) => s + e.item.y + (e.item.height || 0) / 2, 0) / items.length;
  items.forEach(e => setItemPos(e, e.item.x, meanCY - (e.item.height || 0) / 2));
  pushHistory(); render();
}

function distributeH() {
  const items = getAlignItems();
  if (items.length < 3) return;
  items.sort((a, b) => a.item.x - b.item.x);
  const totalSpan = (items[items.length - 1].item.x + (items[items.length - 1].item.width || 0)) - items[0].item.x;
  const totalW    = items.reduce((s, e) => s + (e.item.width || 0), 0);
  const gap       = (totalSpan - totalW) / (items.length - 1);
  let cursor = items[0].item.x + (items[0].item.width || 0);
  for (let i = 1; i < items.length - 1; i++) {
    setItemPos(items[i], cursor + gap, items[i].item.y);
    cursor = items[i].item.x + (items[i].item.width || 0);
  }
  pushHistory(); render();
}

function distributeV() {
  const items = getAlignItems();
  if (items.length < 3) return;
  items.sort((a, b) => a.item.y - b.item.y);
  const totalSpan = (items[items.length - 1].item.y + (items[items.length - 1].item.height || 0)) - items[0].item.y;
  const totalH    = items.reduce((s, e) => s + (e.item.height || 0), 0);
  const gap       = (totalSpan - totalH) / (items.length - 1);
  let cursor = items[0].item.y + (items[0].item.height || 0);
  for (let i = 1; i < items.length - 1; i++) {
    setItemPos(items[i], items[i].item.x, cursor + gap);
    cursor = items[i].item.y + (items[i].item.height || 0);
  }
  pushHistory(); render();
}

// ============================================================
// Z-order — Bring to Front / Send to Back
// ============================================================

function mapForId(id) {
  if (state.nodes.has(id))       return state.nodes;
  if (state.edges.has(id))       return state.edges;
  if (state.lines.has(id))       return state.lines;
  if (state.annotations.has(id)) return state.annotations;
  return null;
}

function bringToFront() {
  if (state.selected.size === 0) return;
  for (const id of state.selected) {
    const map = mapForId(id);
    if (!map) continue;
    const item = map.get(id);
    map.delete(id);
    map.set(id, item); // re-insert at end = rendered on top
  }
  pushHistory(); render();
}

function sendToBack() {
  if (state.selected.size === 0) return;
  for (const id of state.selected) {
    const map = mapForId(id);
    if (!map) continue;
    const item = map.get(id);
    map.delete(id);
    // Prepend by rebuilding the map
    const rest = [...map.entries()];
    map.clear();
    map.set(id, item);
    rest.forEach(([k, v]) => map.set(k, v));
  }
  pushHistory(); render();
}

// ============================================================
// Clipboard — Copy, Cut, Paste, Duplicate
// ============================================================
function copySelected() {
  if (state.selected.size === 0) return;
  state.clipboard.nodes       = [];
  state.clipboard.edges       = [];
  state.clipboard.lines       = [];
  state.clipboard.annotations = [];
  state.pasteOffset = 0;

  for (const id of state.selected) {
    const node = state.nodes.get(id);
    const edge = state.edges.get(id);
    const line = state.lines.get(id);
    const ann  = state.annotations.get(id);
    if (node) state.clipboard.nodes.push({ ...node });
    if (edge) state.clipboard.edges.push({ ...edge });
    if (line) state.clipboard.lines.push({ ...line, waypoints: (line.waypoints || []).map(wp => ({ ...wp })) });
    if (ann)  state.clipboard.annotations.push({ ...ann });
  }
  updateEditButtons();
}

function cutSelected() {
  if (state.selected.size === 0) return;
  copySelected();
  deleteSelected();
}

function pasteClipboard() {
  const cb = state.clipboard;
  if (!cb.nodes.length && !cb.edges.length && !cb.lines.length && !cb.annotations.length) return;

  state.pasteOffset += 20;
  const off = state.pasteOffset;

  // Build old→new ID map for nodes so edges can be reconnected
  const idMap = new Map();
  const newIds = [];

  for (const node of cb.nodes) {
    const newId = genId();
    idMap.set(node.id, newId);
    state.nodes.set(newId, { ...node, id: newId, x: node.x + off, y: node.y + off });
    newIds.push(newId);
  }

  for (const edge of cb.edges) {
    const newId = genId();
    state.edges.set(newId, {
      ...edge,
      id: newId,
      from: idMap.get(edge.from) || edge.from,
      to:   idMap.get(edge.to)   || edge.to,
      waypoints: (edge.waypoints || []).map(wp => ({ ...wp, id: genId() })),
    });
    newIds.push(newId);
  }

  for (const line of cb.lines) {
    const newId = genId();
    state.lines.set(newId, {
      ...line,
      id: newId,
      x1: line.x1 + off, y1: line.y1 + off,
      x2: line.x2 + off, y2: line.y2 + off,
      waypoints: (line.waypoints || []).map(wp => ({ ...wp, id: genId(), x: wp.x + off, y: wp.y + off })),
    });
    newIds.push(newId);
  }

  for (const ann of cb.annotations) {
    const newId = genId();
    state.annotations.set(newId, { ...ann, id: newId, x: ann.x + off, y: ann.y + off });
    newIds.push(newId);
  }

  state.selected.clear();
  newIds.forEach(id => state.selected.add(id));
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
  n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize',
  ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize',
};

function updateCursor(p) {
  if (state.tool !== 'select') { svg.style.cursor = 'crosshair'; return; }
  const hit = hitTest(p.x, p.y);
  if (hit.type === 'resize')          svg.style.cursor = resizeCursors[hit.handle] || 'pointer';
  else if (hit.type === 'ann-resize') svg.style.cursor = resizeCursors[hit.handle] || 'pointer';
  else if (hit.type === 'line-endpoint') svg.style.cursor = 'move';
  else if (hit.type === 'waypoint' || hit.type === 'line-waypoint') svg.style.cursor = 'move';
  else if (hit.type === 'node' || hit.type === 'annotation' || hit.type === 'line') svg.style.cursor = 'move';
  else if (hit.type === 'edge')   svg.style.cursor = 'pointer';
  else svg.style.cursor = 'default';
}

// ============================================================
// Properties Panel
// ============================================================
function updatePropertiesPanel() {
  updateEditButtons(); // keep toolbar edit buttons in sync with selection
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
  const line = state.lines.get(id);
  const ann = state.annotations.get(id);

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

function bindColorInput(id, defaultValue, setter) {
  const input  = document.getElementById(id);
  const hex    = document.getElementById(`${id}-hex`);
  const reset  = document.getElementById(`${id}-reset`);
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

function renderSymbolProps(container, node) {
  const iconName = node.iconPath ? node.iconPath.split('/').pop().replace(/\.svg$/i, '') : '';
  container.innerHTML = `
    <div class="prop-group"><label>Icon</label><p class="prop-value" style="font-size:11px;word-break:break-all">${esc(iconName)}</p></div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(node.label || '')}"></div>
    <div class="prop-group"><label>Font</label>${fontControlsHtml(node, { size: 11 })}</div>
    <div class="prop-group"><label>X</label><input type="number" id="p-x" value="${Math.round(node.x)}"></div>
    <div class="prop-group"><label>Y</label><input type="number" id="p-y" value="${Math.round(node.y)}"></div>
    <div class="prop-group"><label>Width</label><input type="number" id="p-w" value="${Math.round(node.width)}"></div>
    <div class="prop-group"><label>Height</label><input type="number" id="p-h" value="${Math.round(node.height)}"></div>
  `;
  bindFontControls(node, { size: 11 });
  bindPropInput('p-label', v => { node.label = v; });
  bindPropInput('p-x', v => { node.x = +v || 0; }, true);
  bindPropInput('p-y', v => { node.y = +v || 0; }, true);
  bindPropInput('p-w', v => { node.width  = Math.max(16, +v || 16); }, true);
  bindPropInput('p-h', v => { node.height = Math.max(16, +v || 16); }, true);
}

function renderNodeProps(container, node) {
  const shapeOpts = ['box', 'circle', 'oval', 'diamond', 'triangle', 'parallelogram']
    .map(s => `<option value="${s}"${(node.shape || 'box') === s ? ' selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
    .join('');
  const dashOpts = [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']]
    .map(([v, l]) => `<option value="${v}"${(node.strokeStyle || 'solid') === v ? ' selected' : ''}>${l}</option>`)
    .join('');
  container.innerHTML = `
    <div class="prop-group"><label>Shape</label><select id="p-shape">${shapeOpts}</select></div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(node.label || '')}"></div>
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
  `;
  document.getElementById('p-shape').addEventListener('change', e => {
    node.shape = e.target.value;
    pushHistory();
    render();
  });
  document.getElementById('p-stroke-style').addEventListener('change', e => {
    node.strokeStyle = e.target.value;
    pushHistory();
    render();
  });
  bindFontControls(node, { size: 13 });
  bindColorInput('p-fill',   '#ffffff', v => { node.fill   = v || undefined; });
  bindColorInput('p-stroke', '#475569', v => { node.stroke = v || undefined; });
  // Opacity slider
  const opacitySlider = document.getElementById('p-opacity');
  const opacityVal    = document.getElementById('p-opacity-val');
  opacitySlider.addEventListener('input', () => {
    node.opacity = parseInt(opacitySlider.value, 10);
    opacityVal.textContent = node.opacity + '%';
    render();
  });
  opacitySlider.addEventListener('change', () => pushHistory());
  bindPropInput('p-label', v => { node.label = v; });
  bindPropInput('p-x', v => { node.x = +v || 0; }, true);
  bindPropInput('p-y', v => { node.y = +v || 0; }, true);
  bindPropInput('p-w', v => { node.width = Math.max(40, +v || 40); }, true);
  bindPropInput('p-h', v => { node.height = Math.max(20, +v || 20); }, true);
}

function renderEdgeProps(container, edge) {
  const fromNode = state.nodes.get(edge.from);
  const toNode = state.nodes.get(edge.to);
  const dir = edge.direction || 'forward';
  const dirOpts = [
    ['forward', '→ Forward'],
    ['back',    '← Backward'],
    ['both',    '↔ Both'],
    ['none',    '— None'],
  ].map(([v, label]) => `<option value="${v}"${dir === v ? ' selected' : ''}>${label}</option>`).join('');
  const dashOpts = [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']]
    .map(([v, l]) => `<option value="${v}"${(edge.strokeStyle || 'solid') === v ? ' selected' : ''}>${l}</option>`)
    .join('');

  container.innerHTML = `
    <div class="prop-group"><label>Direction</label><select id="p-dir">${dirOpts}</select></div>
    <div class="prop-group"><label>Line style</label><select id="p-stroke-style">${dashOpts}</select></div>
    <div class="prop-group"><label>Stroke</label>${colorRow('p-stroke', edge.stroke, '#64748b')}</div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(edge.label || '')}"></div>
    <div class="prop-group"><label>Label Font</label>${fontControlsHtml(edge, { size: 11 })}</div>
    <div class="prop-group"><label>From</label><span class="prop-value">${esc(fromNode ? (fromNode.label || fromNode.id) : edge.from)}</span></div>
    <div class="prop-group"><label>To</label><span class="prop-value">${esc(toNode ? (toNode.label || toNode.id) : edge.to)}</span></div>
  `;
  document.getElementById('p-dir').addEventListener('change', e => {
    edge.direction = e.target.value;
    pushHistory();
    render();
  });
  document.getElementById('p-stroke-style').addEventListener('change', e => {
    edge.strokeStyle = e.target.value;
    pushHistory();
    render();
  });
  bindColorInput('p-stroke', '#64748b', v => { edge.stroke = v || undefined; });
  bindPropInput('p-label', v => { edge.label = v; });
  bindFontControls(edge, { size: 11 });
}

function renderLineProps(container, line) {
  const dashOpts = [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']]
    .map(([v, l]) => `<option value="${v}"${(line.strokeStyle || 'solid') === v ? ' selected' : ''}>${l}</option>`)
    .join('');
  const symOpts = field => [['none','None'],['dot','Dot'],['square','Square']]
    .map(([v, l]) => `<option value="${v}"${(line[field] || 'none') === v ? ' selected' : ''}>${l}</option>`)
    .join('');

  container.innerHTML = `
    <div class="prop-group"><label>Stroke</label>${colorRow('p-stroke', line.stroke, '#64748b')}</div>
    <div class="prop-group"><label>Line style</label><select id="p-stroke-style">${dashOpts}</select></div>
    <div class="prop-group"><label>Start</label><select id="p-start-sym">${symOpts('startSymbol')}</select></div>
    <div class="prop-group"><label>End</label><select id="p-end-sym">${symOpts('endSymbol')}</select></div>
    <div class="prop-group"><label>Label</label><input type="text" id="p-label" value="${esc(line.label || '')}"></div>
    <div class="prop-group"><label>Label Font</label>${fontControlsHtml(line, { size: 11 })}</div>
  `;
  document.getElementById('p-stroke-style').addEventListener('change', e => {
    line.strokeStyle = e.target.value; pushHistory(); render();
  });
  document.getElementById('p-start-sym').addEventListener('change', e => {
    line.startSymbol = e.target.value; pushHistory(); render();
  });
  document.getElementById('p-end-sym').addEventListener('change', e => {
    line.endSymbol = e.target.value; pushHistory(); render();
  });
  bindColorInput('p-stroke', '#64748b', v => { line.stroke = v || undefined; });
  bindPropInput('p-label', v => { line.label = v; });
  bindFontControls(line, { size: 11 });
}

function renderAnnProps(container, ann) {
  const align = ann.align || 'left';
  const dashOpts = [['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']]
    .map(([v, l]) => `<option value="${v}"${(ann.strokeStyle || 'solid') === v ? ' selected' : ''}>${l}</option>`)
    .join('');

  container.innerHTML = `
    <div class="prop-group">
      <label>Text</label>
      <textarea id="p-text" rows="3" style="width:100%;resize:vertical;box-sizing:border-box;font-family:inherit;font-size:12px;padding:4px">${esc(ann.text || '')}</textarea>
    </div>
    <div class="prop-group">
      <label>Align</label>
      <div class="font-controls">
        <button class="font-btn${align === 'left'   ? ' active' : ''}" id="p-align-left"   title="Left">⬅</button>
        <button class="font-btn${align === 'center' ? ' active' : ''}" id="p-align-center" title="Centre">↔</button>
        <button class="font-btn${align === 'right'  ? ' active' : ''}" id="p-align-right"  title="Right">➡</button>
      </div>
    </div>
    <div class="prop-group"><label>Font</label>${fontControlsHtml(ann, { size: 13 })}</div>
    <div class="prop-group"><label>Color</label>${colorRow('p-color', ann.color, '#7c3aed')}</div>
    <div class="prop-group"><label>Background</label>${colorRow('p-fill', ann.fill, '#ffffff')}</div>
    <div class="prop-group"><label>Border</label>${colorRow('p-stroke', ann.stroke, '#475569')}</div>
    <div class="prop-group"><label>Border style</label><select id="p-stroke-style">${dashOpts}</select></div>
    <div class="prop-group"><label>X</label><input type="number" id="p-x" value="${Math.round(ann.x)}"></div>
    <div class="prop-group"><label>Y</label><input type="number" id="p-y" value="${Math.round(ann.y)}"></div>
    <div class="prop-group"><label>Width</label><input type="number" id="p-ann-w" value="${Math.round(ann.width  || annBBox(ann).w)}" min="40"></div>
    <div class="prop-group"><label>Height</label><input type="number" id="p-ann-h" value="${Math.round(ann.height || annBBox(ann).h)}" min="10"></div>
  `;

  // Text (textarea works with bindPropInput since it fires 'input' and 'change')
  bindPropInput('p-text', v => { ann.text = v; });

  // Alignment buttons
  ['left', 'center', 'right'].forEach(a => {
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
  bindColorInput('p-color',  '#7c3aed', v => { ann.color  = v || undefined; });
  bindColorInput('p-fill',   '#ffffff', v => { ann.fill   = v || undefined; });
  bindColorInput('p-stroke', '#475569', v => { ann.stroke = v || undefined; });

  const strokeStyleEl = document.getElementById('p-stroke-style');
  if (strokeStyleEl) strokeStyleEl.addEventListener('change', e => {
    ann.strokeStyle = e.target.value;
    pushHistory();
    render();
  });

  bindPropInput('p-x', v => { ann.x = +v || 0; }, true);
  bindPropInput('p-y', v => { ann.y = +v || 0; }, true);
  bindPropInput('p-ann-w', v => {
    const nw = Math.max(40, +v || 40);
    const bb = annBBox(ann);
    const nx = bb.x; // keep top-left fixed when typing into width field
    ann.width = nw;
    const align = ann.align || 'left';
    if (align === 'center')     ann.x = nx + nw / 2;
    else if (align === 'right') ann.x = nx + nw;
    else                        ann.x = nx;
  }, true);
  bindPropInput('p-ann-h', v => { ann.height = Math.max(10, +v || 10); }, true);
}

function bindPropInput(id, setter, isNumber) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => { setter(el.value); render(); });
  el.addEventListener('change', () => pushHistory());
}

/** Generate HTML for font control row (size select + B/I/U buttons). */
function fontControlsHtml(item, defaults = {}) {
  const curSize = item.fontSize !== undefined ? item.fontSize : (defaults.size || 13);
  const bold    = item.fontBold    !== undefined ? item.fontBold    : (defaults.bold    || false);
  const italic  = item.fontItalic  !== undefined ? item.fontItalic  : (defaults.italic  || false);
  const under   = item.fontUnderline !== undefined ? item.fontUnderline : (defaults.underline || false);

  const sizes = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];
  const sizeOpts = sizes.map(s => `<option value="${s}"${s === curSize ? ' selected' : ''}>${s}</option>`).join('');

  return `<div class="font-controls">
    <select class="font-size-select" id="p-fontsize">${sizeOpts}</select>
    <button class="font-btn${bold   ? ' active' : ''}" id="p-bold"      title="Bold"><b>B</b></button>
    <button class="font-btn${italic ? ' active' : ''}" id="p-italic"    title="Italic"><i>I</i></button>
    <button class="font-btn${under  ? ' active' : ''}" id="p-underline" title="Underline"><u>U</u></button>
  </div>`;
}

/** Wire up font control inputs, calling setter(field, value) on change. */
function bindFontControls(item, defaults = {}) {
  const sizeEl  = document.getElementById('p-fontsize');
  const boldEl  = document.getElementById('p-bold');
  const italEl  = document.getElementById('p-italic');
  const underEl = document.getElementById('p-underline');
  if (!sizeEl) return;

  sizeEl.addEventListener('change', () => {
    item.fontSize = parseInt(sizeEl.value, 10);
    pushHistory(); render();
  });

  const toggle = (el, field, defVal) => {
    el.addEventListener('click', () => {
      const cur = item[field] !== undefined ? item[field] : (defVal || false);
      item[field] = !cur;
      el.classList.toggle('active', item[field]);
      pushHistory(); render();
    });
  };
  toggle(boldEl,  'fontBold',      defaults.bold      || false);
  toggle(italEl,  'fontItalic',    defaults.italic    || false);
  toggle(underEl, 'fontUnderline', defaults.underline || false);
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
// Zoom
// ============================================================
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4.0;
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

function getCanvasSize() {
  const container = document.getElementById('canvas-container');
  return { w: container.clientWidth, h: container.clientHeight };
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

function syncZoomSelect() {
  const sel = document.getElementById('zoom-select');
  if (!sel) return;
  const pct = Math.round(state.zoom * 100);
  // Try to match a preset option value
  const match = [...sel.options].find(o => o.value !== 'fit' && Math.round(parseFloat(o.value) * 100) === pct);
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
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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
      minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
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

function updateEditButtons() {
  const hasSel = state.selected.size > 0;
  const hasCb  = state.clipboard.nodes.length > 0 ||
                 state.clipboard.edges.length > 0 ||
                 state.clipboard.lines.length > 0 ||
                 state.clipboard.annotations.length > 0;
  const btnCut  = document.getElementById('btn-cut');
  const btnCopy = document.getElementById('btn-copy');
  const btnPaste = document.getElementById('btn-paste');
  const btnDupe  = document.getElementById('btn-duplicate');
  if (btnCut)   btnCut.disabled   = !hasSel;
  if (btnCopy)  btnCopy.disabled  = !hasSel;
  if (btnPaste) btnPaste.disabled = !hasCb;
  if (btnDupe)  btnDupe.disabled  = !hasSel;

  // Align buttons require ≥2 positional items; distribute require ≥3
  const alignCount = getAlignItems().length;
  const canAlign = alignCount >= 2;
  const canDist  = alignCount >= 3;
  ['btn-align-left','btn-align-center-h','btn-align-right',
   'btn-align-top','btn-align-center-v','btn-align-bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canAlign;
  });
  ['btn-dist-h','btn-dist-v'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canDist;
  });

  // Bring to front / Send to back require any selection
  const btnFront = document.getElementById('btn-bring-front');
  const btnBack  = document.getElementById('btn-send-back');
  if (btnFront) btnFront.disabled = !hasSel;
  if (btnBack)  btnBack.disabled  = !hasSel;
}

// ============================================================
// Icon Library
// ============================================================

/** Convert a raw filename to a human-readable label. */
function iconLabel(filename) {
  return filename
    .replace(/\.svg$/i, '')
    .replace(/^\d+-icon-service-/i, '')  // strip Azure numeric prefix
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
        const dataURI  = typeof entry === 'object' ? entry.data : null;
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

        item.addEventListener('dragstart', e => {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/icon-path', iconPath);
          e.dataTransfer.setData('text/icon-label', label);
          item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));

        grid.appendChild(item);
      }

      catDiv.appendChild(grid);
      providerBody.appendChild(catDiv);

      // Toggle category expand/collapse
      catHeader.addEventListener('click', () => {
        const open = !grid.classList.contains('hidden');
        grid.classList.toggle('hidden', open);
        catHeader.querySelector('.icon-chevron').classList.toggle('open', !open);
      });
    }

    providerDiv.appendChild(providerBody);
    tree.appendChild(providerDiv);

    // Toggle provider expand/collapse
    const providerBodyEl = providerBody;
    providerHeader.addEventListener('click', () => {
      const hidden = providerBodyEl.style.display === 'none';
      providerBodyEl.style.display = hidden ? '' : 'none';
      providerHeader.querySelector('.icon-chevron').classList.toggle('open', hidden);
    });
  }
}

function filterIconPanel(query) {
  const q = query.trim().toLowerCase();
  const tree = document.getElementById('icon-tree');
  if (!q) {
    // Restore default collapsed state
    tree.querySelectorAll('.icon-item').forEach(el => el.style.display = '');
    tree.querySelectorAll('.icon-grid').forEach(el => el.classList.add('hidden'));
    tree.querySelectorAll('.icon-category-header .icon-chevron').forEach(el => el.classList.remove('open'));
    tree.querySelectorAll('.icon-provider-body').forEach(el => el.style.display = '');
    tree.querySelectorAll('.icon-provider-header .icon-chevron').forEach(el => el.classList.add('open'));
    return;
  }

  // Show all categories and expand them; hide non-matching icons
  tree.querySelectorAll('.icon-grid').forEach(el => el.classList.remove('hidden'));
  tree.querySelectorAll('.icon-category-header .icon-chevron').forEach(el => el.classList.add('open'));
  tree.querySelectorAll('.icon-provider-body').forEach(el => el.style.display = '');

  tree.querySelectorAll('.icon-item').forEach(item => {
    const matches = item.dataset.label.toLowerCase().includes(q);
    item.style.display = matches ? '' : 'none';
  });

  // Hide empty categories
  tree.querySelectorAll('.icon-category').forEach(cat => {
    const visible = [...cat.querySelectorAll('.icon-item')].some(el => el.style.display !== 'none');
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
  document.getElementById('btn-toggle-icons').addEventListener('click', () => {
    const panel = document.getElementById('icon-panel');
    const btn = document.getElementById('btn-toggle-icons');
    const closed = panel.classList.toggle('icon-panel-closed');
    btn.classList.toggle('active', !closed);
  });

  // Search
  document.getElementById('icon-search').addEventListener('input', e => {
    filterIconPanel(e.target.value);
  });

  // Canvas drag-and-drop
  const canvasContainer = document.getElementById('canvas-container');
  canvasContainer.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('text/icon-path')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  canvasContainer.addEventListener('drop', e => {
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
// Init
// ============================================================

/** Wire a click handler to an element by ID — silently skips if the element doesn't exist. */
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

function init() {
  initSVG();

  // Toolbar tool buttons
  document.querySelectorAll('.tool-btn').forEach(btn => {
    if (!btn.dataset.tool) return; // skip non-tool buttons (e.g. icon library toggle)
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
  on('btn-undo',  'click', undo);
  on('btn-redo',  'click', redo);

  // Cut / Copy / Paste / Duplicate
  on('btn-cut',       'click', cutSelected);
  on('btn-copy',      'click', copySelected);
  on('btn-paste',     'click', pasteClipboard);
  on('btn-duplicate', 'click', duplicateSelected);

  // Align / Distribute
  on('btn-align-left',     'click', alignLeft);
  on('btn-align-center-h', 'click', alignCenterH);
  on('btn-align-right',    'click', alignRight);
  on('btn-align-top',      'click', alignTop);
  on('btn-align-center-v', 'click', alignCenterV);
  on('btn-align-bottom',   'click', alignBottom);
  on('btn-dist-h',         'click', distributeH);
  on('btn-dist-v',         'click', distributeV);

  // Z-order
  on('btn-bring-front', 'click', bringToFront);
  on('btn-send-back',   'click', sendToBack);

  // Open / Save / Export
  on('btn-save',       'click', saveDiagram);
  on('btn-open',       'click', () => document.getElementById('file-input')?.click());
  on('btn-export-svg', 'click', exportSVG);
  on('btn-export-png', 'click', exportPNG);
  on('file-input', 'change', e => {
    if (e.target.files[0]) {
      importDiagram(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Zoom
  on('btn-zoom-in',  'click', zoomIn);
  on('btn-zoom-out', 'click', zoomOut);
  on('zoom-select', 'change', e => {
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
    if (drag) { dragEnd({ x: 0, y: 0 }); }
    if (panDrag) {
      panDrag = null;
      svg.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
    }
  });

  // Suppress context menu so right-click pan doesn't trigger the browser menu
  svg.addEventListener('contextmenu', e => e.preventDefault());

  // Wheel zoom: Ctrl+scroll zooms in/out centred on pointer
  svg.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const pt = svgCoords(e); // diagram coords under pointer before zoom
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((state.zoom + delta) * 10) / 10));
    if (newZoom === state.zoom) return;
    // Adjust viewCenter so the pointer stays over the same diagram point
    const { w, h } = getCanvasSize();
    const fracX = (e.clientX - svg.getBoundingClientRect().left) / w;
    const fracY = (e.clientY - svg.getBoundingClientRect().top) / h;
    const vwOld = w / state.zoom, vhOld = h / state.zoom;
    const vwNew = w / newZoom,  vhNew = h / newZoom;
    state.viewCenterX += (vwOld - vwNew) * (fracX - 0.5);
    state.viewCenterY += (vhOld - vhNew) * (fracY - 0.5);
    state.zoom = newZoom;
    updateViewBox();
    syncZoomSelect();
  }, { passive: false });

  // Keyboard
  document.addEventListener('keydown', onKeyDown);

  // Set initial tool
  setTool('select');

  // Initialise zoom (sets viewBox and wires ResizeObserver)
  initZoom();

  // Initialise icon library panel
  initIconLibrary();

  // Restore last diagram from localStorage (before seeding history)
  loadFromLocalStorage();

  // Pre-cache data URIs for any symbol icons loaded from localStorage
  cacheAllSymbolIcons();

  pushHistory(); // history[0] = initial/restored state

  render();
  updatePropertiesPanel();
  updateToolbarStatus();
}

document.addEventListener('DOMContentLoaded', init);
