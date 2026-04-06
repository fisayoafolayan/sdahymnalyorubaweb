# Architecture

A zero-dependency PWA built with vanilla HTML, CSS, and JavaScript. No build step, no framework - files are served directly.

## File structure

```
index.html      - Single-page app shell (header, sidebar, hymn view, presentation overlay)
app.js          - All application logic (data loading, search, rendering, navigation, theme)
styles.css      - All styles (light/dark themes, responsive breakpoints, presentation mode)
sw.js           - Service worker (cache-first for offline support)
manifest.json   - PWA manifest (install prompt, icons, theme)
hymns.json      - Hymn dataset (620+ hymns with Yoruba lyrics, English titles, references)
build.js        - Build script (minifies JS, CSS, JSON into dist/)
package.json    - npm config and scripts
dist/           - Build output (gitignored, served in production)
```

## Build

Requires Node.js. Install dependencies once:

```
npm install
```

Scripts:

| Command | Description |
|---------|-------------|
| `npm run build` | Minify JS, CSS, and JSON into `dist/` |
| `npm run dev` | Build + watch for changes + start local dev server (port 8787) |
| `npm run deploy` | Build then deploy to Cloudflare Pages |

Source files in the root are the editable originals. `dist/` contains minified copies served in production. Never edit files in `dist/` directly.

## Data flow

```
hymns.json  →  loadData()  →  HYMNS[]  →  buildIndex()  →  searchIndex[]
                                  ↓
                             filtered[]  ←  syncSearch(query)
                                  ↓
                             renderList()  →  sidebar (virtual scrolling)
                                  ↓
                selectHymn()  →  renderHymn()  →  #hymn-view
                                  ↓
                             presBlocks[]  →  renderPresBlock()  →  #pres
```

## Key patterns

### Virtual scrolling
The sidebar hymn list renders only visible rows plus an overscan buffer. `ROW_H` (62px) in app.js must match the CSS `.hymn-row` height. On scroll, `renderList()` recalculates which rows to show.

### Search
A pre-built search index (`searchIndex[]`) stores normalised text for each hymn. `syncSearch()` scores matches by field (number > title > lyrics) and sorts results. Search is debounced at 150ms.

### URL routing
Hymn selection syncs with the URL via `?hymn=N` query parameter. `history.pushState` / `popstate` handles back/forward navigation. Sidebar and presentation mode also push history entries for back-button support.

### Presentation mode
Hymn lyrics are split into blocks (title, verses, choruses). Each block is a slide. Navigation via arrow keys, swipe, or tap. Enters fullscreen on open.

### Theme
Three-state toggle: light → dark → system. Stored in `localStorage('theme')`. Applied via `data-theme` attribute on `<html>`, which activates CSS variable overrides.

### Offline support
The service worker pre-caches all assets on install. Subsequent requests use a cache-first strategy - cached responses are returned immediately while the network response updates the cache in the background.

## State

All state lives in module-level variables in app.js:

| Variable | Purpose |
|----------|---------|
| `HYMNS` | Full hymn dataset from hymns.json |
| `filtered` | Search-filtered subset shown in sidebar |
| `current` | Currently displayed hymn (null = home) |
| `searchIndex` | Pre-normalised text for fast search |
| `presBlocks` | Structured slides for presentation mode |
| `presIdx` | Current presentation slide index |
| `presFz` / `readFz` | Font size multipliers (persisted in localStorage) |

## localStorage keys

| Key | Purpose |
|-----|---------|
| `lastHymn` | Last viewed hymn number (restored on reload) |
| `presFz` | Presentation font size preference |
| `readFz` | Reading font size preference |
| `theme` | Theme preference (light/dark/system) |

## CSS architecture

Styles use CSS custom properties for theming. Dark mode is defined twice - once for `[data-theme="dark"]` (explicit toggle) and once for `@media (prefers-color-scheme: dark)` (system default). Both blocks must stay in sync.

### Z-index stack

| z-index | Element | Purpose |
|---------|---------|---------|
| 9999 | `#loading` | Loading screen overlay |
| 500 | `#pres` | Fullscreen presentation |
| 300 | `#hdr` | Fixed header |
| 200 | `#sidebar` | Mobile slide-out panel |
| 199 | `#sb-overlay` | Backdrop behind sidebar |
| 10 | `.scroll-top` | Scroll-to-top button |

## Service worker versioning

The cache name is generated automatically at build time. The source `sw.js` contains a `__BUILD_HASH__` placeholder that `build.js` replaces with an MD5 hash of the built assets. The cache only busts when file content actually changes — no manual version bumping needed.

## Adding a new hymn

See [CONTRIBUTING.md](CONTRIBUTING.md) for the hymn data format. Add the hymn object to `hymns.json` - no code changes needed.
