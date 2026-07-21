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
┌──────────────────────────────────────────────────────┐
│  Top toolbar: Undo/Redo │ Clipboard │ Align │ Export │
├────┬─────────────────────────────────────┬───────────┤
│    │                                     │           │
│ ◀  │           Canvas                    │Properties │
│    │                                     │  Panel    │
│    │                                     │           │
└────┴─────────────────────────────────────┴───────────┘
```

- **Left toolbar** — drawing tool selector
- **Top toolbar** — actions, alignment, export
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

Pick a shape type from the **Shape:** picker in the top toolbar before drawing, or change an existing shape's type in the Properties panel. Available shapes:

- Box (rectangle)
- Circle
- Oval
- Diamond
- Triangle
- Parallelogram

### Connectors

1. Select the **Connect** tool
2. Drag from the edge of a source shape to a target shape
3. A connector with an arrowhead is created

Connectors can also be **bidirectional** or have **no arrows** — change the direction in the Properties panel (→ Forward, ← Backward, ↔ Both, — None).

### Text Annotations

Free-floating text labels that aren't attached to any shape. Place them by clicking with the **Text** tool.

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

| Element | Editable properties |
|---------|-------------------|
| Shape | Label, X/Y/W/H position, Shape type, Fill colour, Stroke colour, Font (size/bold/italic/underline) |
| Connector | Label, Direction (→ ← ↔ —), Stroke colour, Font |
| Annotation | Text, Font |

Colour pickers support any hex colour. Click **Reset** to restore the default colour.

---

## Align & Distribute (Top Toolbar)

Available when **2 or more** shapes/annotations are selected. Edges are excluded.

| Button | Action |
|--------|--------|
| Align Left | Flush left edges to the leftmost element |
| Align Center H | Center all on the same vertical axis |
| Align Right | Flush right edges to the rightmost element |
| Align Top | Flush top edges to the topmost element |
| Align Center V | Center all on the same horizontal axis |
| Align Bottom | Flush bottom edges to the bottommost element |
| Distribute H | Equal horizontal gaps *(needs ≥ 3)* |
| Distribute V | Equal vertical gaps *(needs ≥ 3)* |

---

## Copy, Cut, Paste & Duplicate

| Action | Keyboard | Button |
|--------|----------|--------|
| Copy | `Ctrl+C` | Copy |
| Cut | `Ctrl+X` | Cut |
| Paste | `Ctrl+V` | Paste |
| Duplicate | `Ctrl+D` | Dupe |

Pasted elements appear offset by 20 px each time (resets on the next copy). When both ends of a connector are copied, the paste creates a new connector between the new copies.

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

Up to 100 undo steps are retained. Every edit (draw, move, resize, label change, colour change, paste, align…) is undoable.

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
| `Dbl-click` | Edit label inline |

---

## Files

```
index.html    — HTML shell and SVG canvas
editor.js     — All editor logic (~1600 lines)
diagram.css   — UI and SVG styling (~580 lines)
```

No build tool, no package manager, no server required.
