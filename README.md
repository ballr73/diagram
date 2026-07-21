# Diagram Editor

A lightweight, self-contained browser-based diagram editor. No installation, no build step, no dependencies — just open `index.html` in any modern browser.

## Getting Started

```
open index.html
```

or drag `index.html` into a browser window. That's it.

---

## Interface Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Zoom │ Undo/Redo │ Clipboard │ Order │ Align │ Export/Import    │
├──────┬──────────┬───────────────────────────────┬───────────────┤
│      │ 🔍 Srch  │                               │               │
│Select│ ▶ AWS    │                               │  Properties   │
│Shape │   ▶Comp  │         Canvas                │    Panel      │
│Conn. │   ▶Stor  │                               │               │
│Text  │ ▶ Azure  │                               │               │
│Icons │   ▶...   │                               │               │
│Shapes│          │                               │               │
└──────┴──────────┴───────────────────────────────┴───────────────┘
```

- **Left toolbar** — drawing tools, icon library toggle, shape picker, version number
- **Icon library panel** — collapsible sidebar with 1,025 AWS & Azure SVG icons, searchable
- **Top toolbar** — zoom controls, undo/redo, clipboard, z-order, align/distribute, export/import
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

### Text Annotations

Free-floating text labels not attached to any shape. Place them by clicking on an empty area of the canvas with the **Text** tool.

---

## Icon Library

Press `I` or click the **Icons** button in the left toolbar to open the icon library panel.

The library contains **1,025 SVG icons** across two providers:

| Provider | Categories |
|----------|-----------|
| **AWS** | 26 categories (Compute, Storage, Networking, ML, Security, …) |
| **Azure** | 29 categories (Compute, Containers, Databases, AI, Security, …) |

### Placing icons

1. Expand a provider and category in the panel
2. Use the **search box** at the top to filter icons by name
3. **Drag** an icon thumbnail onto the canvas — it is placed as a 64×64 resizable symbol node

Icon nodes behave like regular shapes: they can be moved, resized, labelled, connected, copied, and exported.

### Adding more icons

Icons live in `icons/<Provider>/<Category>/name.svg`. After adding or removing SVG files, regenerate the manifest:

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
**Double-click** any shape, connector, annotation, or icon to edit its label inline. Press **Enter** or click elsewhere to confirm; **Escape** to cancel.

### Deleting
Select one or more elements and press `Delete` or `Backspace`.

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

## Export & Import

| Button | Description |
|--------|-------------|
| **JSON** | Download the diagram as `diagram.json` for later import |
| **SVG** | Download a standalone `diagram.svg` — icons are embedded as data URIs; opens in browsers, Inkscape, Figma, etc. |
| **PNG** | Download a `diagram.png` rasterised at device pixel ratio (crisp on HiDPI screens) |
| **Import** | Load a previously exported `diagram.json` |

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
| `Delete` / `Backspace` | Delete selected elements |
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
| `Dbl-click` | Edit label inline |

---

## Files

```
index.html                        — HTML shell and SVG canvas
editor.js                         — All editor logic (~2,300 lines)
diagram.css                       — UI and SVG styling (~800 lines)
README.md                         — This file
icons/                            — SVG icon library (1,025 icons)
  AWS/                            — 26 AWS service categories
  Azure/                          — 29 Azure service categories
  manifest.js                     — Embedded data URIs (loaded at runtime)
  manifest.json                   — Lightweight file listing (reference)
scripts/
  generate-manifest.js            — Regenerates manifest.js / manifest.json
.github/workflows/release.yml     — GitHub Actions release workflow
```

No build tool, no package manager, no server required.

## Releases

Pushing to `main` automatically creates a GitHub release tagged `v{YYYY}.{MM}.{DD}.{build}` with a `diagram-editor.tar.gz` download containing all app files and the complete icon library.

