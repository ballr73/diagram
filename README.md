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
├──────────────────────────────────────────────────────────────────────┤
│ File  Edit  View  Arrange                                             │
├──────────────────────────────────────────────────────────────────────┤
│ New │ Open/Save │ Zoom │ Undo/Redo │ Clipboard │ Order │ Align │ Export │
├──────┬──────────┬─────────────────────────────────┬─────────────────┤
│      │ 🔍 Srch  │                                 │                 │
│Select│ ▶ AWS    │                                 │   Properties    │
│Shape │   ▶Comp  │           Canvas                │     Panel       │
│Conn. │   ▶Stor  │                                 │                 │
│Line  │ ▶ Azure  │                                 │                 │
│Text  │   ▶...   │                                 │                 │
│Icons │ ▶ GCP    │                                 │                 │
│Shapes│   ▶...   │                                 │                 │
│      │          ├─────────────────────────────────┤                 │
│      │          │ tab-1 │ tab-2 │ + │              │                 │
└──────┴──────────┴─────────────────────────────────┴─────────────────┘
```

- **Left toolbar** — drawing tools (compact icon-only buttons) and icon library toggle
- **Icon library panel** — collapsible sidebar with 1,241 AWS, Azure & GCP SVG icons, searchable
- **Diagram name bar** — slim bar above the menu bar showing the current diagram name ("Untitled diagram" until saved)
- **Menu bar** — File, Edit, View, and Arrange menus with keyboard shortcuts shown on each item
- **Top toolbar** — quick-access icon buttons for the most common actions
- **Canvas** — the drawing surface with a dot-grid background; right-click drag to pan
- **Tab bar** — at the bottom of the canvas; each tab holds an independent diagram page
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

Click the **Shape** button in the left toolbar to activate the draw tool. A small **triangle indicator** in the corner of the button shows that clicking it also opens the **shape type pop-out** — a floating panel where you can choose the shape type. The button icon updates to reflect the currently selected shape. Hovering over a pop-out icon shows its name as a tooltip. You can also change an existing shape's type in the Properties panel. Available shapes:

| Shape | Description |
|-------|-------------|
| Box | Rectangle |
| Circle | Perfect circle (ellipse with equal axes) |
| Oval | Horizontal ellipse |
| Diamond | Rotated square |
| Triangle | Upward-pointing triangle |
| Parallelogram | Skewed rectangle (Step) |
| Document | Rectangle with a wavy bottom edge |
| Database | Cylinder (rectangle with elliptic caps) |
| Wait | D-shape — straight left side, curved right edge |
| Merge | Inverted triangle (apex at bottom) |

### Connectors

1. Select the **Connect** tool
2. Drag from the edge of a source shape to a target shape
3. A connector with an arrowhead is created

Connector direction, style, and curve type can be changed in the Properties panel.

| Direction option | Appearance |
|-----------------|------------|
| → Forward | Arrow pointing to target |
| ← Backward | Arrow pointing to source |
| ↔ Both | Arrows at both ends |
| — None | Plain line, no arrows |

### Curved connectors

Connectors can be rendered as smooth curves instead of straight lines:

1. Select a connector
2. Open the **Properties panel**
3. Change the **Connector** dropdown from **Straight** to **Curved**

In curved mode, waypoints act as curve-pull handles — dragging a waypoint reshapes the curve through that point rather than creating a sharp corner.

### Connector waypoints (corners / curves)

Connectors can be bent or curved using waypoints:

1. Select the **Select** tool
2. **Double-click** anywhere on an existing connector — a waypoint handle appears at that point
3. **Drag the handle** to pull the connector into a corner or angle (straight) or to reshape the curve (curved)
4. Add as many waypoints as needed
5. **Click a waypoint handle** to focus it, then press **Delete** / **Backspace** to remove it

Waypoints are preserved through undo/redo, copy/paste, and open/save.

### Connector anchor points

By default, connectors attach automatically at the point on each node's border that faces the opposite node. You can override this by dragging the endpoint anchor to any position on the node border.

1. Select the **Select** tool and click a connector to select it
2. **Green handles** appear at each end of the connector (on the node borders)
3. **Drag a green handle** to reposition the anchor point around the node's border
4. The connector remembers the new anchor direction — moving or resizing the node preserves the relative attachment angle
5. Anchor changes are undoable and saved with the diagram

> Connectors on locked layers cannot have their anchors moved.

### Lines

Free-floating lines not attached to any shape. Unlike connectors, lines have no direction or arrowhead — they are purely decorative or structural.

1. Select the **Line** tool (`L`)
2. Click and drag anywhere on the canvas to draw the line

**End symbols** (set in Properties panel): each end can independently show **None**, **Dot**, or **Square**.

Lines support all the same editing actions as connectors, including curved mode:

| Feature | How |
|---------|-----|
| Move line | Select it and drag |
| Reposition an endpoint | Select the line — endpoint handles appear at each end; drag to move |
| Add a corner/waypoint | **Double-click** anywhere on a selected line |
| Remove a waypoint | Click the waypoint handle to focus it, then press **Delete** |
| Connector type | Straight or Curved (Properties panel) |
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

## Grid & Snap

### Grid

The canvas always displays a subtle **dot grid** in the background — minor dots every 20 px and slightly larger dots every 100 px. The grid is for visual reference only and is not included in SVG or PNG exports.

### Snap to Grid

Click the **Snap** button in the top toolbar (the dot-grid icon, between the zoom controls and undo/redo) to toggle snapping on or off.

| State | Icon | Behaviour |
|-------|------|-----------|
| **Off** (default) | Faint dot grid | Elements move freely |
| **On** | Bold centre dot with crosshair marks, amber button | Elements snap to the nearest 20 px grid point |

When snap is enabled, the following actions snap to the grid:
- Dragging a node (single or multi-selection)
- Dragging a text annotation
- Drawing a new shape (start corner and end corner both snap)
- Resizing a shape via its handles

The snap preference is saved automatically and restored the next time you open the editor.

---

## Layers

Each tab has its own **Layers panel** (below the Properties panel on the right). By default every diagram starts with a single **Background** layer.

### Layers panel

| Control | Action |
|---------|--------|
| Click a layer row | Make it the active layer — new shapes are placed on this layer |
| **Eye icon** | Toggle layer visibility on/off |
| **Padlock icon** | Toggle layer lock on/off (see below) |
| **Double-click** layer name | Rename the layer inline (Enter to confirm, Escape to cancel) |
| **Drag a layer row** | Reorder layers — drag up to move a layer in front, down to move it behind |
| **＋ button** (panel header) | Add a new layer (automatically becomes active) |
| **Trash icon** | Delete the layer and all its shapes (disabled when only one layer exists) |

### Layer Z-ordering

Layers control rendering depth across the whole diagram. **Objects on higher layers always appear in front of objects on lower layers**, regardless of individual Bring to Front / Send to Back actions. The panel lists layers top-to-bottom from frontmost to backmost — drag rows to reorder.

Within a single layer, use **Bring to Front** and **Send to Back** (Arrange menu or Z-order toolbar buttons) to adjust the stacking of elements. These actions are scoped to the layer — they cannot move an element in front of elements on a higher layer.

### Locking layers

Click the **padlock icon** on a layer row to lock or unlock that layer. Locked layers are indicated by an amber padlock icon and an amber left border on the row; the layer name is shown in italic.

When a layer is **locked**:

| Restriction | Detail |
|-------------|--------|
| **No selection** | Clicking or rubber-band selecting objects on the layer has no effect |
| **No movement** | Objects cannot be dragged or repositioned |
| **No deletion** | Delete key and Cut are ignored for locked-layer objects |
| **No editing** | Properties panel shows a "Layer is locked" banner instead of controls |
| **No drawing** | If the locked layer is the active layer, drawing tools are disabled (switch to another layer first) |
| **No paste** | Paste is blocked while the active layer is locked |

Locked layers **can** still be hidden/shown (eye icon), reordered (drag), renamed, and deleted.

> **Tip:** Use locking to freeze background or reference layers while you work on content layers above them.

### Active layer

The active layer name is shown in the Properties panel when nothing is selected ("Active layer: **Name**"). All new shapes, connectors, lines, and annotations are created on the active layer.

### Visibility

Hidden layers are removed from the canvas and are not selectable. All layers — visible or hidden — are included in SVG and PNG exports.

### Moving a shape to a different layer

Select a shape and use the **Layer** dropdown in the Properties panel to move it to any layer.

### Backward compatibility

Diagrams created before the layers feature was added are automatically assigned to the Background layer when opened.

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
| Layer | Move the shape to a different layer |

### Icon (symbol) properties

| Property | Description |
|----------|-------------|
| Icon | Icon name (read-only) |
| Label | Text displayed relative to the icon (supports multi-line with `\n`) |
| Label pos | 3×3 position picker — default is bottom-centre (below icon); can be placed on any side or inside |
| Font | Size, Bold, Italic, Underline |
| X / Y | Position on canvas |
| Width / Height | Size |
| Layer | Move the icon to a different layer |

### Connector properties

| Property | Description |
|----------|-------------|
| Direction | → Forward / ← Backward / ↔ Both / — None |
| Connector | Straight (default) or Curved — switches between polyline and Catmull-Rom spline |
| Line style | Solid / Dashed / Dotted |
| Stroke | Line colour |
| Label | Text displayed along the connector |
| Label Font | Size, Bold, Italic, Underline |
| Layer | Move the connector to a different layer |

### Line properties

| Property | Description |
|----------|-------------|
| Connector | Straight (default) or Curved |
| Stroke | Line colour |
| Line style | Solid / Dashed / Dotted |
| Start | End symbol at start point: None / Dot / Square |
| End | End symbol at end point: None / Dot / Square |
| Label | Text displayed at the midpoint |
| Label Font | Size, Bold, Italic, Underline |
| Layer | Move the line to a different layer |

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
| Layer | Move the annotation to a different layer |

---

## Z-Order (Bring to Front / Send to Back)

| Button | Action | Enabled when |
|--------|--------|-------------|
| **Front** | Move selected element(s) above all others | anything selected |
| **Back** | Move selected element(s) behind all others | anything selected |

### How Z-order works

- **Layer order takes priority** — objects on higher layers always render in front of objects on lower layers. Bring to Front / Send to Back operate only within the element's own layer.
- **Shapes and connectors** within the same layer share the same Z-space. A connector's Z-position automatically follows the topmost node it connects to — bring a node to front and its connectors come with it.
- **Text annotations (default)** render above all shapes and connectors in the same layer.
- **Text annotations (sent to back)** are placed on a background sub-layer that renders *below* all shapes and connectors — ideal for region background boxes in architecture diagrams.

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
| Same Width | Match width of the last-selected shape | 2 |
| Same Height | Match height of the last-selected shape | 2 |

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

## Group & Ungroup

Select two or more shapes (shift-click or rubber-band select) then click the **Group** toolbar button or use `Ctrl+G`. The shapes are locked together as a single unit.

| Action | Keyboard | Description |
|--------|----------|-------------|
| Group | `Ctrl+G` | Group 2+ selected shapes into one unit |
| Ungroup | `Ctrl+Shift+G` | Dissolve a selected group back to individual shapes |

**While grouped:**
- Clicking any member selects the whole group
- Dragging the group moves all members together
- The Properties panel shows "Group (N shapes)" with an **Ungroup** button
- Individual shape properties (colour, font, size) are not editable
- A purple dashed border outlines the group bounding box

Connectors attached to grouped shapes continue to work normally. Groups are preserved when saving and exporting, and support copy/paste (paste creates a new group with offset copies).

---

## Menu Bar

A standard application menu bar sits between the diagram name and the icon toolbar. Click a menu title to open it; hover across titles to switch menus; click outside or select an item to close.

### File

| Item | Shortcut | Description |
|------|----------|-------------|
| New | `Ctrl+N` | Clear the canvas and start a fresh diagram |
| Open… | `Ctrl+O` | Open a `.json` diagram file |
| Open from Google Drive… | | Open a diagram previously saved to Google Drive |
| Save | `Ctrl+S` | Save the diagram — opens a native save dialog to choose filename and location |
| Save to Google Drive… | | Save the diagram to Google Drive with folder chooser |
| Export PNG | | Export the diagram as a PNG image |
| Export SVG | | Export the diagram as a self-contained SVG |

### Edit

| Item | Shortcut | Description |
|------|----------|-------------|
| Undo | `Ctrl+Z` | Undo the last action |
| Redo | `Ctrl+Y` | Redo the last undone action |
| Cut | `Ctrl+X` | Cut selected elements |
| Copy | `Ctrl+C` | Copy selected elements |
| Paste | `Ctrl+V` | Paste clipboard |
| Duplicate | `Ctrl+D` | Duplicate selected elements |
| Group | `Ctrl+G` | Group 2+ selected shapes into one unit |
| Ungroup | `Ctrl+Shift+G` | Dissolve selected group back to individual shapes |

### View

| Item | Shortcut | Description |
|------|----------|-------------|
| Zoom In | `Ctrl++` | Increase zoom by 10% |
| Zoom Out | `Ctrl+−` | Decrease zoom by 10% |
| 100% | `Ctrl+0` | Reset zoom to 100% |
| Fit Window | `Ctrl+⇧0` | Fit the whole diagram into the viewport |
| 25% – 200% | | Jump to a specific zoom preset |

### Arrange

| Item | Description |
|------|-------------|
| Bring to Front | Move selected elements above all others |
| Send to Back | Move selected elements behind all others |
| Align Left/Center/Right/Top/Middle/Bottom | Align selected elements (requires ≥ 2) |
| Distribute Horizontally / Vertically | Equal spacing between elements (requires ≥ 3) |
| Same Width | Resize all selected shapes to the width of the last-selected (requires ≥ 2) |
| Same Height | Resize all selected shapes to the height of the last-selected (requires ≥ 2) |

---

## Tabs

Each diagram file can contain multiple **tabs** — independent pages with their own shapes, connectors, annotations, undo history, and zoom level. The tab bar sits at the bottom-left of the canvas.

| Action | How |
|--------|-----|
| Switch tab | Click a tab |
| Add tab | Click **+** next to the last tab |
| Rename tab | Double-click the tab label, type a new name, press `Enter` |
| Close tab | Hover over a tab to reveal **×**, then click it (requires confirmation; hidden when only one tab exists) |

**What is per-tab:** shapes, connectors, lines, annotations, undo/redo history, zoom level, pan position.

**What is shared across tabs:** clipboard (copy in one tab, paste in another), diagram name, current drawing tool.

**Saving** writes all tabs to a single `.json` file. **Export PNG / SVG** exports only the currently active tab.

Opening a diagram file that was saved before tabs were introduced loads its content as a single `tab-1`.

---

## Open, Save & Export

| Button | Description |
|--------|-------------|
| **New** | Clear the canvas and start a fresh diagram (prompts to confirm if content exists) |
| **Open** | Open a previously saved `.json` file — sets the diagram name from the filename |
| **Open from Google Drive** | Open a diagram previously saved to Google Drive — browse folders, select a file, validate and load |
| **Save** | Opens a native OS save dialog (Chrome/Edge) to choose filename and location; falls back to a browser download prompt on Firefox and Safari |
| **Save to Google Drive** | Save the diagram to Google Drive — sign in with Google, choose a folder, then save. Overwrites the existing file if one with the same name already exists in the chosen folder. |
| **SVG** | Export a self-contained `<name>.svg` — icons are embedded as data URIs |
| **PNG** | Export a `<name>.png` rasterised at device pixel ratio (crisp on HiDPI screens) |

**New** and **Open** are also available in the **File** menu with keyboard shortcuts (`Ctrl+N`, `Ctrl+O`). **Save** is `Ctrl+S`.

The current diagram name is shown in the slim bar above the menu bar. It reads **"Untitled diagram"** until the file is saved or opened. The name is taken from whatever the user types in the save dialog.

Icon images are embedded as base64 data URIs in SVG and PNG exports, so exported files are fully self-contained.

### Open from Google Drive

Choose **File → Open from Google Drive…** to open a diagram that was previously saved to your Google Drive by this app.

1. A Google sign-in popup appears the first time. Sign in and grant access when prompted.
2. A dialog opens showing your Google Drive contents — folders and `.json` diagram files.
3. Navigate to the desired folder by clicking it; use the breadcrumb to go back up.
4. Click a file to select it (or double-click to open immediately).
5. Click **Open**. The file is downloaded, validated, and loaded into the editor.

If the selected file is not a valid diagram, an error is shown inside the dialog — no changes are made to the current diagram.

> **Note:** The app uses the `drive.file` scope — it can only see files it has saved itself. Files created by other applications are not visible.

### Save to Google Drive

Click the **Google Drive icon** in the toolbar (or choose **File → Save to Google Drive…**) to save the current diagram to your Google Drive.

1. A Google sign-in popup appears the first time. Sign in and grant access when prompted.
2. A dialog opens with the filename pre-filled (current diagram name + `.json`).
3. Use the folder browser to navigate to the desired destination — click a folder to enter it, use the breadcrumb to go back up.
4. Click **Save**. If a file with the same name already exists in the chosen folder it is overwritten; otherwise a new file is created.
5. A confirmation toast appears and the diagram name is updated.

The app uses the `drive.file` scope — it can only read or modify files it has created itself; it cannot access other Drive content.

---

## Presentation Mode

Activate **Presentation Mode** to display your diagram fullscreen without any toolbars, menus, or panels.

### Entering and exiting

| Action | How |
|--------|-----|
| Enter presentation mode | Click the **📽 Presentation** button (far right of top toolbar) or press `P` |
| Exit presentation mode | Click the **✕** icon (bottom-right overlay) or press `Escape` |

### What happens in presentation mode

- All chrome is hidden: menu bar, toolbars, properties panel, tab bar, icon library panel.
- The diagram automatically **fits to the window** when presentation mode is entered.
- The diagram is **read-only** — no shapes can be drawn, selected, moved or edited.
- **Right-click drag** and **Ctrl+Scroll** zoom still work for exploring large diagrams.

### Navigating tabs

If the diagram has multiple tabs a navigation overlay appears at the **bottom-right** of the screen:

| Control | Action |
|---------|--------|
| **◀** button | Go to previous tab |
| **▶** button | Go to next tab |
| **← →** arrow keys | Navigate between tabs |
| Tab label (e.g. `Page 1 (1 / 3)`) | Shows current tab name and position |

The ◀ / ▶ buttons are hidden when the diagram contains only one tab.

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
| `P` | Enter presentation mode |
| `Escape` | Cancel current operation / deselect |
| `Ctrl+N` | New diagram |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save diagram |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+C` | Copy selected |
| `Ctrl+X` | Cut selected |
| `Ctrl+V` | Paste clipboard |
| `Ctrl+D` | Duplicate selected |
| `Ctrl+G` | Group selected shapes |
| `Ctrl+Shift+G` | Ungroup selected group |
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
editor.js                         — All editor logic (~3,530 lines)
diagram.css                       — UI and SVG styling (~1,100 lines)
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
