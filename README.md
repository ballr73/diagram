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
┌──────────────────────────────────────────────────────────────┐
│  Top toolbar: Undo/Redo │ Clipboard │ Order │ Align │ Export │
├──────┬───────────────────────────────────────┬───────────────┤
│      │                                       │               │
│ ◀    │            Canvas                     │  Properties   │
│ Tools│                                       │    Panel      │
│ Shape│                                       │               │
│ Pick │                                       │               │
│ ver  │                                       │               │
└──────┴───────────────────────────────────────┴───────────────┘
```

- **Left toolbar** — drawing tools, shape picker, version number
- **Top toolbar** — undo/redo, clipboard, z-order, align/distribute, export/import
- **Canvas** — the drawing surface with a dot-grid background
- **Properties panel** — edit the selected element's properties

---

## Drawing Tools (Left Toolbar)

| Button | Key | Action |
|--------|-----|--------|
| **Select** | `S` | Select, move, and resize elements |
| **Shape** | `B` | Click and drag to draw a new shape |
| **Connect** | `C` | Drag from one shape to another to draw a connector |
| **Text** | `T` | Click on the canvas to place a standalone text annotation |

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

## Editing Elements

### Moving
Select an element with the **Select** tool and drag it.

### Resizing
Select a shape — eight resize handles appear around it. Drag any handle to resize.

### Editing Labels
**Double-click** any shape, connector, or annotation to edit its label inline. Press **Enter** or click elsewhere to confirm; **Escape** to cancel.

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

## Zoom

| Control | Action |
|---------|--------|
| **🔍−** button | Zoom out 10% |
| **Dropdown** | Jump to a preset level: 25%, 50%, 75%, 100%, 125%, 150%, 200%, or Fit |
| **🔍+** button | Zoom in 10% |
| `Ctrl+=` / `Ctrl++` | Zoom in 10% |
| `Ctrl+-` | Zoom out 10% |
| `Ctrl+0` | Reset to 100% |
| `Ctrl+Shift+0` | Fit diagram to window |
| `Ctrl+Scroll` | Zoom centred on pointer |

Zoom range: 10%–400%.

---

## Export & Import

| Button | Description |
|--------|-------------|
| **JSON** | Download the diagram as `diagram.json` for later import |
| **SVG** | Download a standalone `diagram.svg` (embeds all styles; opens in browsers, Inkscape, Figma, etc.) |
| **PNG** | Download a `diagram.png` rasterised at device pixel ratio (crisp on HiDPI screens) |
| **Import** | Load a previously exported `diagram.json` |

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
| `Dbl-click` | Edit label inline |

---

## Files

```
index.html                        — HTML shell and SVG canvas
editor.js                         — All editor logic (~1800 lines)
diagram.css                       — UI and SVG styling (~660 lines)
README.md                         — This file
.github/workflows/release.yml     — GitHub Actions release workflow
```

No build tool, no package manager, no server required.

## Releases

Pushing to `main` automatically creates a GitHub release tagged `v{YYYY}.{MM}.{DD}.{build}` with a `diagram-editor.zip` download containing all four app files.
