# Bases Timeline

An [Obsidian](https://obsidian.md) plugin that adds a Notion-style **Timeline** view to [Bases](https://help.obsidian.md/bases), designed to manage projects as notes with properties.

## How it works

Each project is a note (for example in a `projects/` folder) with these frontmatter properties:

```yaml
---
status: cooking      # inbox | not started | cooking | on hold | clean | archive
priority: high       # urgent | high | medium | low
tags: []
start: 2026-07-06
end: 2026-07-20
---
```

The project title is the file name.

## Timeline view

The view registers alongside the native Bases views (Table, Cards, List) under the name **Timeline**:

- Notion-style side panel listing projects, collapsible with an animated transition (on mobile it is the default view);
- horizontal bars from start date to end date, with a colored priority pill (urgent = red, high = orange, medium = yellow, low = gray); titles overflow past the bar when it is too narrow;
- red "today" indicator with a **Today** button to re-center, and a zoom selector in the header;
- **drag** a bar to move a project in time, **drag its edges** to change start or end — dates are written back to the frontmatter, with date labels fading in at the bar edges (also on hover);
- hover the row of an unscheduled project to preview a bar under the cursor and click to schedule it (default length depends on the zoom level);
- arrow chips appear at the viewport edges for bars scrolled out of view: hover shows the dates, click scrolls back to the bar;
- click to open the note (Cmd/Ctrl+click in a new tab, Alt/Shift+click in a split), hover for the page preview;
- zoom levels: Day / Week / 2 weeks / Month / Quarter / Year / 5 years;
- collapsible groups (with Bases "Group by", e.g. by status), ordered by your workflow and sorted by priority within each group;
- drag a project from the side panel onto another group header to change its status, and click the priority pill on a bar to pick a new priority;
- when a note was opened in a side split from the timeline, later clicks open notes as new tabs next to it instead of replacing the view;
- icons assigned with [Iconize](https://github.com/FlorianWoelki/obsidian-iconize) (emoji or icon packs) are shown next to project titles;
- unscheduled projects appear only in the side panel.

The properties used for start, end and priority are configurable per view (defaults: `start`, `end`, `priority`).

## Setup

1. Enable the **Bases** core plugin.
2. Create a `.base` file (see `examples/Progetti.base`) or add a **Timeline** view to an existing Base.
3. Filter the Base to your projects folder, e.g. `file.inFolder("projects")`.

The plugin also adds a **New project** command (and a ribbon icon) that creates a note in the projects folder with the frontmatter already set. The folder, property names, default values, and the status order used for grouping are configurable in the plugin settings.

The interface is available in English, Italian, French, German and Spanish, following the Obsidian language.

## Installation

Requires Obsidian **1.10.2+**.

### Manual

1. Download (or build) `main.js`, `manifest.json` and `styles.css`.
2. Copy them to `<vault>/.obsidian/plugins/bases-timeline/`.
3. Reload Obsidian and enable **Bases Timeline** in Settings → Community plugins.

### Building

```bash
npm install
npm run build   # produces main.js
npm run dev     # build in watch mode
```

## Development

- `src/main.ts` — view registration, "New project" command, settings.
- `src/timeline-view.ts` — the Timeline view (`BasesView`).
- `src/i18n.ts` — UI translations (en, it, fr, de, es).
- `styles.css` — styles (uses Obsidian CSS variables, works in light and dark themes).
