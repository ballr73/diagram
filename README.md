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
┌──────────────────────────────────────────────────────────────────────┐
│ Diagram name                                                          │
├─────────────────────────────────────────────────────────────────────┤
│ New │ Open/Save/SaveAs │ Zoom │ Undo/Redo │ Clipboard │ Order │ Align │ Export │
├──────┬──────────┬─────────────────────────────────┬─────────────────┤
│      │ 🔍 Srch  │                                 │                 │
│Select│ ▶ AWS    │                                 │   Properties    │
│Shape │   ▶Comp  │           Canvas                │     Panel       │
│Conn. │   ▶Stor  │                                 │                 │
│Line  │ ▶ Azure  │                                 │                 │
│Text  │   ▶...   │                                 │                 │
│Icons │ ▶ GCP    │                                 │                 │
│Shapes│   ▶...   │                                 │                 │
└──────┴──────────┴─────────────────────────────────┴─────────────────┘
```

- **Left toolbar** — drawing tools, icon library toggle, shape picker, version number
- **Icon library panel** — collapsible sidebar with 1,241 AWS, Azure & GCP SVG icons, searchable
- **Diagram name bar** — slim bar above the toolbar showing the current diagram name ("Untitled diagram" until saved)
- **Top toolbar** — new/open/save, zoom controls, undo/redo, clipboard, z-order, align/distribute (floating popup), export
- **Canvas** — the drawing surface with a dot-grid background; right-click drag to pan
- **Properties panel** — edit the selected element's properties

---

## Drawing Tools (Left Toolbar)

| Button | Key | Action |
|--------|-----|--------|
| **Select** | `S` | Select, move, and resize elements |
| **Shape** | `B` | Click and drag to draw a new shape |
| **Connect** | `C` | Drag from one shape to another to draw a connector |
| **Line** | `L` | Click and drag to draw a free-floating line |
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

### Lines

Free-floating lines not attached to any shape. Unlike connectors, lines have no direction or arrowhead — they are purely decorative or structural.

1. Select the **Line** tool (`L`)
2. Click and drag anywhere on the canvas to draw the line

**End symbols** (set in Properties panel): each end can independently show **None**, **Dot**, or **Square**.

Lines support all the same editing actions as connectors:

| Feature | How |
|---------|-----|
| Move line | Select it and drag |
| Reposition an endpoint | Select the line — endpoint handles appear at each end; drag to move |
| Add a corner/waypoint | **Double-click** anywhere on a selected line |
| Remove a waypoint | Click the waypoint handle to focus it, then press **Delete** |
| Line style | Solid / Dashed / Dotted (Properties panel) |
| Stroke colour | Colour picker (Properties panel) |
| Label | Text along the midpoint (Properties panel) |

Lines are included in undo/redo, copy/paste, SVG/PNG export, and JSON save/open.

### Text Annotations

Free-floating text labels not attached to any shape. Place them by clicking on an empty area of the canvas with the **Text** tool.

- **Multi-line**: press Enter in the inline editor for a new line (Ctrl+Enter to confirm)
- **Word wrap**: long text wraps automatically within the text box width (default max 300 px)
- **Resize**: select a text annotation — eight resize handles appear; drag to change width/height
- **Alignment**: left / centre / right (Properties panel)
- **Formatting**: font size, bold, italic, underline, text colour, background fill, border colour and style (Properties panel)

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

> **Note:** Double-clicking a **connector** or **line** inserts a waypoint corner — use the Properties panel to edit their labels.

### Deleting
- Select one or more elements and press `Delete` or `Backspace` to delete them.
- To remove a connector or line waypoint: click its handle to focus it, then press `Delete` / `Backspace`.

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
| Label pos | 3×3 position picker — place the label at any corner, edge midpoint, or centre of the shape |
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
| Label | Text displayed relative to the icon (supports multi-line with `\n`) |
| Label pos | 3×3 position picker — default is bottom-centre (below icon); can be placed on any side or inside |
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

### Line properties

| Property | Description |
|----------|-------------|
| Stroke | Line colour |
| Line style | Solid / Dashed / Dotted |
| Start | End symbol at start point: None / Dot / Square |
| End | End symbol at end point: None / Dot / Square |
| Label | Text displayed at the midpoint |
| Label Font | Size, Bold, Italic, Underline |

### Annotation properties

| Property | Description |
|----------|-------------|
| Text | The annotation text (multi-line; Enter = newline, Ctrl+Enter = confirm) |
| Align | Left / Centre / Right text alignment |
| Font | Size, Bold, Italic, Underline |
| Color | Text colour |
| Background | Fill colour (shown behind text) |
| Bg opacity | Background fill opacity 0–100% (useful for semi-transparent region boxes) |
| Border | Stroke colour and style (Solid/Dashed/Dotted) |
| X / Y | Anchor position on canvas |
| Width / Height | Explicit box size; drag resize handles to set visually |

---

## Z-Order (Bring to Front / Send to Back)

| Button | Action | Enabled when |
|--------|--------|-------------|
| **Front** | Move selected element(s) above all others | anything selected |
| **Back** | Move selected element(s) behind all others | anything selected |

### How Z-order works

- **Shapes and connectors** share the same rendering layer. A connector's Z-position automatically follows the topmost node it connects to — bring a node to front and its connectors come with it; send a node to back and its connectors recede behind shapes with higher Z.
- **Text annotations (default)** render above all shapes and connectors. Use Bring to Front to move an annotation above other annotations.
- **Text annotations (sent to back)** are moved to a separate background layer that renders *below* all shapes and connectors — ideal for region background boxes in architecture diagrams. Use Bring to Front to return them to the default layer.

---

## Align & Distribute

Click the **Align** icon button in the top toolbar to open a floating popup with all alignment and distribution options. The popup closes automatically after choosing an action, or click the button again to dismiss it.

The Align button is enabled when **2 or more** shapes/annotations are selected. Connectors are excluded.

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
| **New** | Clear the canvas and start a fresh diagram (prompts to confirm if content exists) |
| **Open** (📂) | Open a previously saved `.json` file — sets the diagram name from the filename |
| **Save** (💾) | First save: prompts for a filename. Subsequent saves: overwrites silently using the same name |
| **Save As** | Prompts for a new filename and saves — replaces the current diagram name; disabled until the diagram has been saved at least once |
| **SVG** | Export a standalone `diagram.svg` — icons are embedded as data URIs |
| **PNG** | Export a `diagram.png` rasterised at device pixel ratio (crisp on HiDPI screens) |

**New**, **Open**, **Save**, and **Save As** are icon-only buttons. **New** sits in its own group; **Open**, **Save**, and **Save As** share a group. SVG and PNG exports are in a separate group on the right.

The current diagram name is shown in the slim bar above the toolbar. It reads **"Untitled diagram"** until the file is saved or opened.

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
| `L` | Line tool |
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
| `Dbl-click` connector/line | Add waypoint corner at click point |

---

## Files

```
index.html                        — HTML shell and SVG canvas
editor.js                         — All editor logic (~3,200 lines)
diagram.css                       — UI and SVG styling (~940 lines)
README.md                         — This file
azure-aks-architecture.json       — Example: Azure AKS multi-region architecture diagram
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
