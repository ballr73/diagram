# Diagram Editor

A lightweight, self-contained browser-based diagram editor. No installation, no build step, no dependencies — just open `index.html` in any modern browser.

## Getting Started

### Option 1 — Use online (GitHub Pages)

Open the hosted version directly in your browser — nothing to download or install:

```
https://ballr73.github.io/diagram/
```

### Option 2 — Download a release

1. Go to the [Releases page](https://github.com/ballr73/diagram/releases)
2. Download `diagram-editor.tar.gz` from the latest release
3. Extract the archive:
   ```
   tar -xzf diagram-editor.tar.gz
   ```
4. Open `index.html` in your browser

### Option 3 — Clone the repo

```
git clone https://github.com/ballr73/diagram.git
cd diagram
open index.html
```

> **Note:** All three options work offline once the files are on your machine. No server required.

---

## Interface Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Open/Save │ Zoom │ Undo/Redo │ Clipboard │ Order │ Align │ Export │
├──────┬──────────┬───────────────────────────────┬───────────────┤
│      │ 🔍 Srch  │                               │               │
│Select│ ▶ AWS    │                               │  Properties   │
│Shape │   ▶Comp  │         Canvas                │    Panel      │
│Conn. │   ▶Stor  │                               │               │
│Text  │ ▶ Azure  │                               │               │
│Icons │   ▶...   │                               │               │
│Shapes│ ▶ GCP    │                               │               │
└──────┴──────────┴───────────────────────────────┴───────────────┘
```

- **Left toolbar** — drawing tools, icon library toggle, shape picker, version number
- **Icon library panel** — collapsible sidebar with 1,241 AWS, Azure & GCP SVG icons, searchable
- **Top toolbar** — open/save, zoom controls, undo/redo, clipboard, z-order, align/distribute, export
- **Canvas** — the drawing surface with a dot-grid background; right-click drag to pan
- **Properties panel** — edit the selected element's properties

---

## Drawing Tools (Left Toolbar)

| Button | Key | Action |
|--------|-----|--------|
| **Select** | `S` | Select, move, and resize elements |
| **Shape** | `B` | Click and drag to draw a new shape |
| **Connect** | `C` | Drag from one shape to another to draw a connector |
| **Text** | `T` | Click on the canvas to place a standalone text annotation |
| **Icons** | `I` | Toggle the icon library panel |

### Shapes

Pick a shape type from the shape picker in the **left toolbar** before drawing, or change an existing shape's type in the Properties panel. Available shapes:

| Shape | Description |
|-------|-------------|
| Box | Rectangle |
| Circle | Perfect circle (ellipse with equal axes) |
| Oval | Horizontal ellipse |
| Diamond | Rotated square |
| Triangle | Upward-pointing triangle |
| Parallelogram | Skewed rectangle |

### Connectors

1. Select the **Connect** tool
2. Drag from the edge of a source shape to a target shape
3. A connector with an arrowhead is created

Connector direction and line style can be changed in the Properties panel.

| Direction option | Appearance |
|-----------------|------------|
| → Forward | Arrow pointing to target |
| ← Backward | Arrow pointing to source |
| ↔ Both | Arrows at both ends |
| — None | Plain line, no arrows |

### Connector waypoints (corners)

Connectors can be bent into any shape using waypoints:

1. Select the **Select** tool
2. **Double-click** anywhere on an existing connector — a waypoint handle appears at that point
3. **Drag the handle** to pull the connector into a corner or angle
4. Add as many waypoints as needed; each creates a new segment
5. **Click a waypoint handle** to focus it, then press **Delete** / **Backspace** to remove it

Waypoints are preserved through undo/redo, copy/paste, and open/save.

### Text Annotations

Free-floating text labels not attached to any shape. Place them by clicking on an empty area of the canvas with the **Text** tool.

---

## Icon Library

Press `I` or click the **Icons** button in the left toolbar to open the icon library panel.

The library contains **1,241 SVG icons** across three cloud providers:

| Provider | Icons | Layout |
|----------|-------|--------|
| **AWS** | ~615 icons across 26 categories | `icons/AWS/<Category>/` |
| **Azure** | ~410 icons across 29 categories | `icons/Azure/<Category>/` |
| **GCP** | 216 icons | `icons/GCP/` |

### Placing icons

1. Expand a provider (and category for AWS/Azure) in the panel
2. Use the **search box** at the top to filter icons by name
3. **Drag** an icon thumbnail onto the canvas — it is placed as a 64×64 resizable symbol node

Icon nodes behave like regular shapes: they can be moved, resized, labelled, connected, copied, and exported.

### Adding more icons

Icons live in `icons/<Provider>/<Category>/name.svg` (categorised) or `icons/<Provider>/name.svg` (flat). After adding or removing SVG files, regenerate the manifest:

```
node scripts/generate-manifest.js
```

This updates `icons/manifest.js` (embedded data URIs used at runtime) and `icons/manifest.json` (lightweight reference file).

---

## Zoom & Pan

### Zoom

The zoom controls sit at the left of the top toolbar.

| Control | Action |
|---------|--------|
| **🔍−** button | Zoom out 10% |
| **Dropdown** | Jump to a preset: 25%, 50%, 75%, 100%, 125%, 150%, 200%, or Fit |
| **🔍+** button | Zoom in 10% |
| `Ctrl+=` / `Ctrl++` | Zoom in 10% |
| `Ctrl+-` | Zoom out 10% |
| `Ctrl+0` | Reset to 100% |
| `Ctrl+Shift+0` | Fit diagram to window |
| `Ctrl+Scroll` | Zoom centred on pointer |

Zoom range: 10%–400%.

### Pan

**Right-click and drag** on the canvas to pan. The cursor changes to a grab hand while panning.

---

## Editing Elements

### Moving
Select an element with the **Select** tool and drag it.

### Resizing
Select a shape — eight resize handles appear around it. Drag any handle to resize.

### Editing Labels
**Double-click** any shape, annotation, or icon to edit its label inline. Press **Enter** or click elsewhere to confirm; **Escape** to cancel.

> **Note:** Double-clicking a connector inserts a waypoint corner — use the Properties panel to edit a connector's label.

### Deleting
- Select one or more elements and press `Delete` or `Backspace` to delete them.
- To remove a connector waypoint: click its handle to focus it, then press `Delete` / `Backspace`.

### Selecting Multiple Elements
Hold `Shift` and click to add to the selection, or drag a selection box over multiple elements on an empty area of the canvas.

---

## Properties Panel

When one element is selected, the Properties panel on the right shows its editable attributes:

### Shape properties

| Property | Description |
|----------|-------------|
| Shape | Change the shape type |
| Label | Text displayed inside the shape |
| Font | Size, Bold, Italic, Underline |
| Fill | Fill colour (colour picker + reset) |
| Stroke | Border colour (colour picker + reset) |
| Line style | Solid / Dashed / Dotted border |
| Opacity | Fill opacity 0–100% (stroke and label stay fully opaque) |
| X / Y | Position on canvas |
| Width / Height | Size |

### Icon (symbol) properties

| Property | Description |
|----------|-------------|
| Icon | Icon name (read-only) |
| Label | Text displayed below the icon |
| Font | Size, Bold, Italic, Underline |
| X / Y | Position on canvas |
| Width / Height | Size |

### Connector properties

| Property | Description |
|----------|-------------|
| Direction | → Forward / ← Backward / ↔ Both / — None |
| Line style | Solid / Dashed / Dotted |
| Stroke | Line colour |
| Label | Text displayed along the connector |
| Label Font | Size, Bold, Italic, Underline |

### Annotation properties

| Property | Description |
|----------|-------------|
| Text | The annotation text |
| Font | Size, Bold, Italic, Underline |
| X / Y | Position on canvas |

---

## Z-Order (Bring to Front / Send to Back)

| Button | Action | Enabled when |
|--------|--------|-------------|
| **Front** | Move selected element(s) above all others in their layer | anything selected |
| **Back** | Move selected element(s) behind all others in their layer | anything selected |

Z-order operates within each layer (shapes compete with shapes, connectors with connectors, annotations with annotations).

---

## Align & Distribute (Top Toolbar)

Available when **2 or more** shapes/annotations are selected. Connectors are excluded.

| Button | Action | Min. selection |
|--------|--------|---------------|
| Align Left | Flush left edges to the leftmost element | 2 |
| Align Center H | Center all on the same vertical axis | 2 |
| Align Right | Flush right edges to the rightmost element | 2 |
| Align Top | Flush top edges to the topmost element | 2 |
| Align Center V | Center all on the same horizontal axis | 2 |
| Align Bottom | Flush bottom edges to the bottommost element | 2 |
| Distribute H | Equal horizontal gaps | 3 |
| Distribute V | Equal vertical gaps | 3 |

---

## Copy, Cut, Paste & Duplicate

| Action | Keyboard | Button |
|--------|----------|--------|
| Copy | `Ctrl+C` | ⎘ |
| Cut | `Ctrl+X` | ✂ |
| Paste | `Ctrl+V` | 📋 |
| Duplicate | `Ctrl+D` | ⧉ |

Pasted elements appear offset by 20 px each time (resets on the next copy). When both ends of a connector are copied, paste creates a new connector between the new copies.

---

## Open, Save & Export

| Button | Description |
|--------|-------------|
| **Open** (📂) | Open a previously saved `diagram.json` file |
| **Save** (💾) | Prompts for a filename, then saves the diagram as `<name>.json` |
| **SVG** | Export a standalone `diagram.svg` — icons are embedded as data URIs; opens in browsers, Inkscape, Figma, etc. |
| **PNG** | Export a `diagram.png` rasterised at device pixel ratio (crisp on HiDPI screens) |

The **Open** and **Save** buttons sit in their own group at the far left of the top toolbar. SVG and PNG exports remain in a separate group on the right.

Icon images are embedded as base64 data URIs in SVG and PNG exports, so exported files are fully self-contained.

---

## Undo & Redo

| Action | Keyboard | Button |
|--------|----------|--------|
| Undo | `Ctrl+Z` | ↩ |
| Redo | `Ctrl+Y` | ↪ |

Up to 100 undo steps are retained. Every edit — drawing, moving, resizing, label changes, colour, opacity, line style, paste, align — is undoable.

---

## Keyboard Shortcuts Summary

| Key | Action |
|-----|--------|
| `S` | Select tool |
| `B` | Shape tool |
| `C` | Connector tool |
| `T` | Text tool |
| `I` | Toggle icon library panel |
| `Delete` / `Backspace` | Delete selected elements (or remove focused waypoint) |
| `Escape` | Cancel current operation / deselect |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+C` | Copy selected |
| `Ctrl+X` | Cut selected |
| `Ctrl+V` | Paste clipboard |
| `Ctrl+D` | Duplicate selected |
| `Ctrl+=` / `Ctrl++` | Zoom in 10% |
| `Ctrl+-` | Zoom out 10% |
| `Ctrl+0` | Reset zoom to 100% |
| `Ctrl+Shift+0` | Fit diagram to window |
| `Ctrl+Scroll` | Zoom in/out centred on pointer |
| `Right-click drag` | Pan canvas |
| `Dbl-click` shape/icon | Edit label inline |
| `Dbl-click` connector | Add waypoint corner at click point |

---

## Files

```
index.html                        — HTML shell and SVG canvas
editor.js                         — All editor logic (~2,400 lines)
diagram.css                       — UI and SVG styling (~820 lines)
README.md                         — This file
icons/                            — SVG icon library (1,241 icons total)
  AWS/                            — 26 AWS service categories
  Azure/                          — 29 Azure service categories
  GCP/                            — 216 GCP icons (flat, no subcategories)
  manifest.js                     — Embedded data URIs (loaded at runtime, ~4.3 MB)
  manifest.json                   — Lightweight file listing (reference)
scripts/
  generate-manifest.js            — Regenerates manifest.js / manifest.json
.github/workflows/release.yml     — GitHub Actions release + Pages deployment workflow
```

No build tool, no package manager, no server required.

---

## Releases & Deployment

Every push to `main` automatically:

1. **Creates a GitHub release** tagged `v{YYYY}.{MM}.{DD}.{build}` with a `diagram-editor.tar.gz` download containing all app files and the complete icon library
2. **Deploys to GitHub Pages** at `https://ballr73.github.io/diagram/`

### Download a specific release

Visit the [Releases page](https://github.com/ballr73/diagram/releases) and download `diagram-editor.tar.gz` from any release.

```
tar -xzf diagram-editor.tar.gz
open index.html
```

### GitHub Pages setup (one-time, repo owner only)

To enable the Pages deployment, go to **Settings → Pages → Source** and select **GitHub Actions**. This only needs to be done once.
