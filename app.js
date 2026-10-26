/**
 * app.js - SDA Hymnal Yorùbá Web Application
 *
 * Main client-side logic for browsing, searching, and presenting Yoruba
 * Seventh-day Adventist hymns. Loads hymn data from hymns.json, renders a
 * virtual-scrolling sidebar list, provides accent-insensitive search, a
 * reading view with adjustable font size, a full-screen presentation mode,
 * swipe navigation, theme toggling, and PWA service-worker registration.
 */

// ── App State ──
// HYMNS: full hymn dataset loaded from hymns.json
// filtered: current search-filtered subset of HYMNS
// current: currently selected/displayed hymn object (null = home screen)
// presBlocks: structured blocks for presentation mode (title + verses/choruses)
// presIdx: current slide index in presentation mode
// presFz: presentation font size multiplier (persisted in localStorage)
// readFz: reading view font size multiplier (persisted in localStorage)
let HYMNS = [];
let filtered = [];
let current = null;
let presBlocks = [];
let presIdx    = 0;
let presFz     = parseFloat(localStorage.getItem('presFz')) || 1.0;
let readFz     = parseFloat(localStorage.getItem('readFz')) || 1.0;

const $ = id => document.getElementById(id);

// ── Motion primitives ──
function spring({ from, to, velocity = 0, damping = 1, response = 0.4 }, onUpdate, onComplete) {
    const omega = (2 * Math.PI) / Math.max(0.05, response);
    const k = omega * omega;            // stiffness
    const c = 2 * damping * omega;      // damping coefficient
    let x = from, v = velocity, raf = 0, last = 0, t0 = 0, done = false;
    const step = now => {
        if (done) return;
        if (!last) { last = t0 = now; }
        let dt = Math.min((now - last) / 1000, 0.064);   // clamp long frames so it can't blow up
        last = now;
        while (dt > 0) {                                  // sub-step: stable at any frame rate
            const h = Math.min(1 / 240, dt);
            v += (-k * (x - to) - c * v) * h;
            x += v * h;
            dt -= h;
        }
        if ((Math.abs(x - to) < 0.4 && Math.abs(v) < 0.4) || now - t0 > 2000) {
            onUpdate(to); onComplete && onComplete(); return;
        }
        onUpdate(x);
        raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return { stop() { done = true; cancelAnimationFrame(raf); } };
}

function project(v, deceleration = 0.998) { return (v / 1000) * deceleration / (1 - deceleration); }

function rubberband(x, dimension, constant = 0.55) {
    return (x * dimension * constant) / (dimension + constant * Math.abs(x));
}

const LOADING_HTML = $('loading').innerHTML;

// The hero's default copy, captured once so goHome() can undo a "Hymn N not found" message
// that a bad deep link left behind.
const EMPTY_HEADING = $('empty').querySelector('h1').textContent;
const EMPTY_BLURB   = $('empty').querySelector('p').innerHTML;

function showLoadError(msg) {
    const el = $('loading');
    el.innerHTML = `
  <svg style="width:36px;height:36px;color:var(--load-spin)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/>
  </svg>
  <p style="max-width:320px;text-align:center;line-height:1.6">${escHtml(msg)}</p>
  <button type="button" id="load-retry" class="load-retry">Try again</button>`;
    el.style.display = 'flex';
    el.style.opacity = '1';
    el.querySelector('#load-retry').addEventListener('click', () => {
        el.innerHTML = LOADING_HTML;   // back to the spinner while we re-fetch
        boot();
    });
}

/** Fetch hymn data from hymns.json. Returns false and shows error UI on failure. */
async function loadData() {
    try {
        const res = await fetch('/hymns.json');
        if (!res.ok) throw new Error('not ok');
        HYMNS = await res.json();
    } catch(e) {
        showLoadError('Could not load hymns. Check your connection and try again.');
        return false;
    }
    return true;
}

/** Strip diacritics and special chars for search comparison. Yoruba text uses combining marks that must be removed for accent-insensitive matching. Null-safe: a hymn missing a field degrades to empty-string matching instead of crashing boot. */
function normalise(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/gi, '').toLowerCase();
}

/** Labels for call-&-response parts; falls back to the capitalized raw part so a future split-part import (women, men, \u2026) can't silently mislabel. */
const CR_PART_LABELS = { leader: 'Leader/Lile', congregation: 'All/Egbe', women: 'Women/Aw\u1ecdn obinrin', men: 'Men/Aw\u1ecdn \u1ecdk\u00f9nrin' };
function crPartLabel(part) { return CR_PART_LABELS[part] || (part ? part.charAt(0).toUpperCase() + part.slice(1) : 'All/Egbe'); }

const WIDE_LINES = 9;

// \u2500\u2500 SEO-friendly URLs \u2500\u2500
// Hymns are addressed by clean paths like /hymn/1-gbogbo-eyin-ti-n-gbe-aye instead
// of ?hymn=1. The number is the source of truth; the slug is decorative (a wrong or
// missing slug still resolves via the leading number). slugify() MUST stay in sync
// with the identical function in build.js so client URLs match the prerendered pages.

/** Build a URL-safe slug from a hymn title (diacritics stripped, lowercased, hyphenated). */
function slugify(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Canonical path for a hymn, e.g. /hymn/1-gbogbo-eyin-ti-n-gbe-aye */
function hymnPath(hymn) {
    return '/hymn/' + hymn.number + '-' + slugify(hymn.title);
}

/** Parse the hymn number from the current location: clean path /hymn/<n>-\u2026 first, then legacy ?hymn=<n>. Returns NaN when neither is present. */
function hymnNumFromLocation() {
    const m = location.pathname.match(/^\/hymn\/(\d+)/);
    return m ? parseInt(m[1]) : parseInt(new URLSearchParams(location.search).get('hymn'));
}

/** Update <title>, meta description, canonical and social tags for a hymn (or the home page when hymn is null). Critical for SEO: without this, every hymn URL would keep the homepage's canonical/title and never be indexed on its own. */
function updateMeta(hymn) {
    const setAttr = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
    let title, desc, url;
    if (hymn) {
        const en = hymn.english_title || '';
        title = 'Hymn ' + hymn.number + ' \u2013 ' + hymn.title + (en ? ' (' + en + ')' : '') + ' | SDA Hymnal Yor\u00f9b\u00e1';
        desc  = 'Hymn ' + hymn.number + ' \u201c' + hymn.title + '\u201d' + (en ? ' (' + en + ')' : '') + ' \u2014 read the full Yor\u00f9b\u00e1 lyrics from the Seventh-day Adventist hymnal.';
        url   = location.origin + hymnPath(hymn);
    } else {
        title = 'SDA Hymnal Yor\u00f9b\u00e1';
        desc  = 'A complete Yor\u00f9b\u00e1 hymnal for Seventh-day Adventist worship, study and church projection. Search hymns by title, number or lyrics.';
        url   = location.origin + '/';
    }
    document.title = title;
    setAttr('meta[name="description"]', 'content', desc);
    setAttr('#canonical-url', 'href', url);
    setAttr('#og-url', 'content', url);
    setAttr('meta[property="og:title"]', 'content', title);
    setAttr('meta[property="og:description"]', 'content', desc);
    setAttr('meta[name="twitter:title"]', 'content', title);
    setAttr('meta[name="twitter:description"]', 'content', desc);
}

// Pre-built search index - built once on load, reused on every keystroke
let searchIndex = [];

let matchInfo = new Map();

/** Build the search index from HYMNS. Each entry contains pre-normalised text fields for fast substring matching on every keystroke. Called once after data load. */
function buildIndex() {
    searchIndex = HYMNS.map(h => {
        const refs = Object.entries(h.references || {}).map(([k, v]) => k + ' ' + v).join(' ');
        return {
            hymn: h,
            number: String(h.number),
            title: normalise(h.title),
            englishTitle: normalise(h.english_title),
            refs: normalise(refs),
            lyrics: normalise(h.lyrics.flatMap(b => b.lines.map(l => typeof l === 'string' ? l : l.text)).join(' '))
        };
    });
}

async function boot() {
    const ok = await loadData();
    if (!ok) return;
    try {
        buildIndex();
        filtered = [...HYMNS];
        const initStep = (fn, label) => { try { fn(); } catch (err) { console.error('Init step failed (' + label + '):', err); } };
        initStep(renderList, 'list');
        initStep(renderRecent, 'recent');
        initStep(renderSets, 'lists');
        const ec = $('empty-count');
        if (ec) ec.textContent = HYMNS.length;   // the front door states the real count
        const cy = $('copy-year');
        if (cy) cy.textContent = new Date().getFullYear();
        // Prerendered hymn pages ship with the loader already hidden — don't re-show or re-fade it
        const loader = $('loading');
        if (loader.style.display !== 'none') {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.display = 'none', 400);
        }

        // Restore from URL (/hymn/42-… or legacy ?hymn=42), then localStorage
        const urlNum    = hymnNumFromLocation();
        const fromUrl   = !isNaN(urlNum);
        const savedNum  = parseInt(localStorage.getItem('lastHymn'));
        const startNum  = fromUrl ? urlNum : (savedNum || null);
        const startHymn = startNum ? HYMNS.find(h => h.number === startNum) : null;

        if (fromUrl && !startHymn) {
            $('empty').style.display = '';
            $('hymn-content').style.display = 'none';
            const emptyH = $('empty').querySelector('h1');
            const emptyP = $('empty').querySelector('p');
            if (emptyH) emptyH.textContent = 'Hymn ' + urlNum + ' not found';
            // 'block', not '' — the mobile stylesheet hides #empty p, so clearing the inline
            // style would swallow the explanation on a phone.
            if (emptyP)  { emptyP.textContent = 'This hymn number doesn\'t exist in the hymnal.'; emptyP.style.display = 'block'; }
            // Reset the bad URL back to home
            history.replaceState(null, '', '/');
            updateMeta(null);
        } else if (startHymn) {
            // Normalise legacy ?hymn= or a slugless/mismatched path to the canonical clean
            // URL in place (no new history entry) so search engines consolidate on one URL.
            if (fromUrl && location.pathname !== hymnPath(startHymn)) {
                history.replaceState({ hymn: startHymn.number }, '', hymnPath(startHymn));
                fromPopstate = true; // prevents selectHymn from pushing a duplicate entry
            }
            selectHymn(startHymn);
        }
    } catch (err) {
        // A malformed hymn record must surface as an error screen, not an infinite spinner
        console.error('Boot failed:', err);
        showLoadError('Something went wrong while loading the hymnal. Refresh to try again.');
    }
}
boot();

// ── Virtual list - only renders visible rows ──
let ROW_H = 67, DECADE_H = 26;
let listScrollTop = 0;
let itemOffsets = [];      // itemOffsets[i] = y of item i; itemOffsets[items.length] = total height
let itemIndexOfRow = [];   // filtered row index → item index (dividers shift it)

/** Read the geometry tokens once at boot. */
function measureRowHeights() {
    const cs = getComputedStyle(document.documentElement);
    ROW_H = parseFloat(cs.getPropertyValue('--row-h')) || 67;
    DECADE_H = parseFloat(cs.getPropertyValue('--decade-h')) || 26;
}
measureRowHeights();

/** Build the item sequence: decade dividers only in the unfiltered list (search results
 *  aren't contiguous ranges, so a "51 – 100" band there would be a lie). */
function buildItems() {
    const items = [];
    itemIndexOfRow = [];
    const withDecades = !$('search').value.trim() && !listOnly;   // a filtered list isn't a range
    filtered.forEach((h, i) => {
        if (withDecades) {
            const d = Math.floor((h.number - 1) / 50);
            const prevD = i > 0 ? Math.floor((filtered[i - 1].number - 1) / 50) : -1;
            if (d !== prevD) items.push({ type: 'div', label: (d * 50 + 1) + ' – ' + (d * 50 + 50) });
        }
        itemIndexOfRow[i] = items.length;
        items.push({ type: 'row', hymn: h });
    });
    return items;
}

/** Render the sidebar hymn list using virtual scrolling. Only DOM nodes for visible rows (plus overscan buffer) are created. ROW_H (62px) must match CSS .hymn-row height (padding + content). */
function renderList() {
    const wrap = $('list-wrap');
    const inSet = listOnly ? setHymns() : null;   // the set view is where the order is editable
    const items = buildItems();
    const n = items.length;
    const wrapH = wrap.clientHeight || 400;
    const overscan = 6; // extra items above/below the visible area

    // Cumulative offsets — items no longer share one height, so index math alone won't do
    itemOffsets = new Array(n + 1);
    let y = 0;
    for (let i = 0; i < n; i++) {
        itemOffsets[i] = y;
        y += items[i].type === 'div' ? DECADE_H : ROW_H;
    }
    itemOffsets[n] = y;

    // First item whose bottom edge is past the scroll position (binary search on offsets)
    let lo = 0, hi = n;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (itemOffsets[mid + 1] <= listScrollTop) lo = mid + 1; else hi = mid;
    }
    const startIdx = Math.max(0, lo - overscan);
    let endIdx = startIdx;
    while (endIdx < n && itemOffsets[endIdx] < listScrollTop + wrapH + overscan * ROW_H) endIdx++;

    const frag = document.createDocumentFragment();

    const top = document.createElement('div');
    top.style.height = itemOffsets[startIdx] + 'px';
    frag.appendChild(top);

    for (let i = startIdx; i < endIdx; i++) {
        const item = items[i];
        if (item.type === 'div') {
            const d = document.createElement('div');
            d.className = 'decade';
            d.setAttribute('aria-hidden', 'true');
            d.textContent = item.label;
            frag.appendChild(d);
            continue;
        }
        const h = item.hymn;
        const div = document.createElement('div');
        div.className = 'hymn-row' + (current && current.number === h.number ? ' active' : '') + (inList(h.number) ? ' listed' : '');
        div.dataset.n = h.number;
        div.id = 'hymn-opt-' + h.number;
        div.setAttribute('role', 'option');
        div.setAttribute('aria-selected', current && current.number === h.number ? 'true' : 'false');
        div.innerHTML = rowInnerHTML(h);
        if (inSet) {
            const pos = inSet.indexOf(h.number);
            const act = document.createElement('div');
            act.className = 'row-actions';
            act.innerHTML =
                `<button class="ra" data-act="up"${pos === 0 ? ' disabled' : ''} aria-label="Move up" title="Move up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg></button>` +
                `<button class="ra" data-act="down"${pos === inSet.length - 1 ? ' disabled' : ''} aria-label="Move down" title="Move down"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>` +
                `<button class="ra ra-del" data-act="del" aria-label="Remove from list" title="Remove from list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>`;
            act.addEventListener('click', e => {
                e.stopPropagation();                       // the row itself selects the hymn
                const b = e.target.closest('.ra');
                if (!b || b.disabled) return;
                if (b.dataset.act === 'up') moveInSet(h.number, -1);
                else if (b.dataset.act === 'down') moveInSet(h.number, 1);
                else removeFromSet(h.number);
            });
            div.appendChild(act);
        }
        div.addEventListener('click', () => selectHymn(h));
        frag.appendChild(div);
    }

    const bot = document.createElement('div');
    bot.style.height = (itemOffsets[n] - itemOffsets[endIdx]) + 'px';
    frag.appendChild(bot);

    wrap.innerHTML = '';
    if (filtered.length === 0) {
        const q = $('search').value.trim();
        const msg = document.createElement('div');
        msg.className = 'no-results';
        const line = document.createElement('div');
        line.textContent = q ? 'No hymns found for “' + q + '”' : 'No hymns found';
        msg.appendChild(line);
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.textContent = 'Clear search';
        clear.addEventListener('click', () => {
            $('search').value = '';
            $('empty-search').value = '';
            syncSearch('');
            $('search').focus();
        });
        msg.appendChild(clear);
        wrap.appendChild(msg);
    } else {
        wrap.appendChild(frag);
    }
    const total = filtered.length;
    $('list-count').textContent = total === 0 ? 'No hymns found' : total.toLocaleString() + (total === 1 ? ' hymn' : ' hymns');
}

// Re-render on scroll to show newly visible rows
$('list-wrap').addEventListener('scroll', () => {
    listScrollTop = $('list-wrap').scrollTop;
    renderList();
}, { passive: true });

function mark(text, re) {
    const nfd = text.normalize('NFD');
    const m = re.exec(nfd);
    if (!m) return escHtml(text);
    const toOrig = [];
    for (let i = 0, o = 0; o < text.length; o++) {
        const len = text[o].normalize('NFD').length;
        for (let k = 0; k < len; k++) toOrig[i++] = o;
    }
    toOrig[nfd.length] = text.length;
    const s = toOrig[m.index], e = toOrig[m.index + m[0].length];
    return escHtml(text.slice(0, s)) + '<span class="hl">' + escHtml(text.slice(s, e)) + '</span>' + escHtml(text.slice(e));
}

function rowInnerHTML(h) {
    const m = matchInfo.get(h.number);
    const title = (m && m.field === 'title') ? mark(h.title, m.re) : escHtml(h.title);
    let sub = '';
    if (m && m.field === 'lyrics') sub = `<span class="hsnip">${mark(m.line, m.re)}</span>`;
    else if (h.english_title) sub = `<span class="hsub" lang="en">${(m && m.field === 'english') ? mark(h.english_title, m.re) : escHtml(h.english_title)}</span>`;
    // Spans, not divs: these rows are <button> in Recent and Saved, and a button may only
    // contain phrasing content. The CSS gives them display:block, so the layout is unchanged.
    return `<span class="hnum" aria-hidden="true">${h.number}</span><span class="htitles"><span class="hyo" lang="yo">${title}</span>${sub}</span>`;
}

/** Recently viewed hymns (max 3), newest first. */
function pushRecent(num) {
    try {
        const r = JSON.parse(localStorage.getItem('recentHymns') || '[]');
        localStorage.setItem('recentHymns', JSON.stringify([num, ...r.filter(n => n !== num)].slice(0, 3)));
    } catch (e) {}
}

let sets = [];
let activeSet = 0;
let listOnly = false;        // the sidebar list is filtered to the active set
let manageOpen = false;      // the list manager (switch / new / delete) is expanded
let manageJustOpened = false; // true for the one render after the manager opens, so it animates
let deletedNotice = null;    // a just-deleted list, held for the undo
let presFromSet = false;    // presentation is walking the set, not the hymnal
try {
    const stored = JSON.parse(localStorage.getItem('sets') || 'null');
    if (Array.isArray(stored) && stored.length && stored.every(s => s && typeof s.name === 'string' && Array.isArray(s.hymns))) {
        sets = stored;
        activeSet = Math.min(Math.max(parseInt(localStorage.getItem('activeSet'), 10) || 0, 0), sets.length - 1);
    } else {
        const legacy = JSON.parse(localStorage.getItem('favourites') || '[]');   // migrate the single saved list
        sets = [{ name: 'My hymns', hymns: Array.isArray(legacy) ? legacy.filter(n => typeof n === 'number') : [] }];
        localStorage.removeItem('favourites');
        localStorage.setItem('sets', JSON.stringify(sets));   // persist the migration immediately
    }
} catch (e) { sets = [{ name: 'My hymns', hymns: [] }]; }
if (!sets.length) sets = [{ name: 'My hymns', hymns: [] }];

const setHymns = () => sets[activeSet].hymns;
function saveSets() {
    try {
        localStorage.setItem('sets', JSON.stringify(sets));
        localStorage.setItem('activeSet', String(activeSet));
    } catch (e) {}
}
function inList(num) { return setHymns().includes(num); }

/** Toggle the current hymn's saved state and refresh everything that shows it. */
function toggleInList(num) {
    const h = setHymns();
    const adding = !h.includes(num);
    sets[activeSet].hymns = adding ? [...h, num] : h.filter(n => n !== num);
    if (!setHymns().length) listOnly = false;   // never leave the list filtered to nothing
    saveSets();
    updateFavButton();                          // the dock icon swaps ＋ → ✓
    renderSets();                               // the list's rows and count update
    renderList();                               // the row gains its ✓ marker
    renderRecent();                             // …and drops out of Recent, so it isn't listed twice
    announce((adding ? 'Added to ' : 'Removed from ') + sets[activeSet].name);
    if (adding && navigator.vibrate) navigator.vibrate(8);   // Android; iOS ignores
}

/** Move a hymn one place up/down in the active set (the order is the service order). */
function moveInSet(num, dir) {
    const h = setHymns();
    const i = h.indexOf(num), j = i + dir;
    if (i < 0 || j < 0 || j >= h.length) return;
    [h[i], h[j]] = [h[j], h[i]];
    saveSets();
    renderSets();
    syncSearch($('search').value.trim());   // `filtered` carries the order the list renders
}

/** Drop a hymn from the active set. */
function removeFromSet(num) {
    sets[activeSet].hymns = setHymns().filter(n => n !== num);
    if (!setHymns().length) listOnly = false;
    saveSets();
    updateFavButton();
    renderSets();
    syncSearch($('search').value.trim());
}

/** Start a new set and switch to it. */
function createSet(name) {
    sets.push({ name: (name || '').trim().slice(0, 40) || ('Set ' + (sets.length + 1)), hymns: [] });
    activeSet = sets.length - 1;
    listOnly = false;
    saveSets();
    updateFavButton();
    renderSets();
    renderList();
}

/** Delete the active list (never the last one). It's the app's only destructive action,
 *  so it's a full-width button clear of the switcher, and it stays undoable for a few
 *  seconds rather than interrupting with a confirm dialog. */
function deleteSet() {
    if (sets.length < 2) return;
    const at = activeSet;
    const [gone] = sets.splice(activeSet, 1);
    activeSet = Math.max(0, activeSet - 1);
    if (!setHymns().length) listOnly = false;
    deletedNotice = { set: gone, at };
    saveSets();
    updateFavButton();
    renderSets();
    syncSearch($('search').value.trim());
    clearTimeout(deleteSet._t);
    deleteSet._t = setTimeout(() => { deletedNotice = null; renderSets(); }, 6000);
}

/** Put a deleted list back where it was. */
function undoDeleteSet() {
    if (!deletedNotice) return;
    clearTimeout(deleteSet._t);
    const at = Math.min(deletedNotice.at, sets.length);
    sets.splice(at, 0, deletedNotice.set);
    activeSet = at;
    deletedNotice = null;
    saveSets();
    updateFavButton();
    renderSets();
    syncSearch($('search').value.trim());
}

/** Reflect the current hymn's membership on the dock's star. */
function updateFavButton() {
    const btn = $('rail-fav');
    if (!btn) return;
    const on = !!current && inList(current.number);
    btn.classList.toggle('added', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = on ? ('Remove from ' + sets[activeSet].name) : ('Add to ' + sets[activeSet].name);
    btn.setAttribute('aria-label', label);
    btn.title = label;
}

/** Render the list section: the active list's name, its rows, and — behind one control —
 *  the manager (switch / new / delete). The manager stays collapsed so the sidebar is
 *  content, not chrome. */
function renderSets() {
    const wrap = $('set-wrap');
    if (!wrap) return;
    // Consumed here, not after the markup: this function rebuilds the whole panel, so a flag
    // that survived a call would replay the reveal on the next unrelated re-render.
    const justOpened = manageJustOpened;
    manageJustOpened = false;
    // While searching, the section stays and narrows to the saved hymns that match —
    // your own hymns should come first in a result, and carry the same highlight.
    const query = $('search').value.trim();
    const saved = setHymns().map(n => HYMNS.find(h => h.number === n)).filter(Boolean);
    const hymns = query ? saved.filter(h => matchInfo.has(h.number)) : saved;
    if (query && !hymns.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    const name = sets[activeSet].name;
    const canPresent = hymns.length > 0;
    wrap.innerHTML = `
      <div class="sect-row">
        ${listOnly
            ? '<button class="sect-back" id="list-back" title="Show all hymns">‹ All hymns</button>'
            : manageOpen
                /* The panel's selected row already names the active list, so label the panel
                   itself here rather than printing the same name and count twice. */
                ? '<span class="sect-label">Lists</span>'
                : `<span class="sect-label">${escHtml(name)} · ${query ? hymns.length + ' of ' + saved.length : hymns.length}</span>`}
        <span class="sect-actions">
          <button class="sect-present" id="set-present" title="Present this list in order" aria-label="Present this list in order"${canPresent ? '' : ' disabled'}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg></button>
          <button class="sect-manage" id="set-manage" aria-expanded="${manageOpen}" aria-label="Manage lists" title="Manage lists"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
        </span>
      </div>
      ${manageOpen ? `
      <div class="set-reveal${justOpened ? ' reveal' : ''}">
      <div class="set-panel">
        <div class="set-lists" aria-label="Lists">
          ${sets.map((s, i) => `
          <button class="set-opt${i === activeSet ? ' on' : ''}" data-i="${i}"${i === activeSet ? ' aria-current="true"' : ''}>
            <span class="set-opt-name">${escHtml(s.name)}</span>
            <span class="set-opt-count">${s.hymns.length}</span>
            ${i === activeSet ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </button>`).join('')}
          <button class="set-opt set-opt-new" id="set-new-open">+ New list…</button>
        </div>
        ${sets.length > 1 ? '<button class="set-del" id="set-del">Delete this list</button>' : ''}
        <div class="set-new" id="set-new" hidden>
          <input id="set-new-name" type="text" placeholder="List name" maxlength="40" aria-label="New list name" autocomplete="off">
          <button class="set-ok" id="set-new-ok" aria-label="Create list" title="Create"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></button>
          <button class="set-cancel" id="set-new-cancel" aria-label="Cancel" title="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
        </div>
      </div></div>` : ''}
      ${deletedNotice ? `<div class="set-undo">Deleted “${escHtml(deletedNotice.set.name)}”<button id="set-undo">Undo</button></div>` : ''}
      ${listOnly
        /* In the set view the list below IS this set, so drawing the rows here too would
           print the first three hymns a second time. */
        ? ''
        : hymns.length === 0
          // ASCII '+', not U+FF0B: the fullwidth plus has no glyph in Noto Serif / Playfair
          // Display and rendered as a tofu box on the default (no saved hymns) screen.
          ? '<div class="set-empty">Tap + on any hymn to add it to this list.</div>'
          : (query ? hymns : hymns.slice(0, 3)).map(h =>
              `<button type="button" class="hymn-row listed" data-n="${h.number}">${rowInnerHTML(h)}</button>`
            ).join('')}
      ${!query && hymns.length > 3 && !listOnly ? `<button class="set-more" id="set-more">Show all ${hymns.length} ›</button>` : ''}`;
    wrap.querySelectorAll('.hymn-row').forEach(el => el.addEventListener('click', () => {
        const h = HYMNS.find(x => x.number === parseInt(el.dataset.n, 10));
        if (h) selectHymn(h);
    }));
    if (canPresent) $('set-present').addEventListener('click', presentSet);
    $('set-manage').addEventListener('click', () => { manageOpen = !manageOpen; manageJustOpened = manageOpen; renderSets(); });
    const back = $('list-back');
    if (back) back.addEventListener('click', () => { listOnly = false; syncSearch($('search').value.trim()); renderSets(); });
    const more = $('set-more');
    if (more) more.addEventListener('click', () => { listOnly = true; syncSearch($('search').value.trim()); renderSets(); });
    const undo = $('set-undo');
    if (undo) undo.addEventListener('click', undoDeleteSet);
    if (manageOpen) {
        wrap.querySelectorAll('.set-opt[data-i]').forEach(b => b.addEventListener('click', () => {
            activeSet = parseInt(b.dataset.i, 10) || 0;
            listOnly = false;
            saveSets();
            updateFavButton();
            renderSets();
            syncSearch($('search').value.trim());
        }));
        $('set-new-open').addEventListener('click', () => { $('set-new').hidden = false; $('set-new-name').focus(); });
        $('set-new-ok').addEventListener('click', () => createSet($('set-new-name').value));
        $('set-new-cancel').addEventListener('click', renderSets);
        $('set-new-name').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); createSet(e.target.value); }
            else if (e.key === 'Escape') renderSets();
        });
        const del = $('set-del');
        if (del) del.addEventListener('click', deleteSet);
    }
    wrap.hidden = false;
}

/** Render the Recent group above the list; hidden while searching or when empty. */
function renderRecent() {
    const wrap = $('recent-wrap');
    if (!wrap) return;
    const nums = JSON.parse(localStorage.getItem('recentHymns') || '[]');
    // don't repeat what's already in Saved — the drawer has one column and limited room
    const hymns = nums.map(n => HYMNS.find(h => h.number === n)).filter(h => h && !inList(h.number));
    if ($('search').value.trim() || !hymns.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    // No active highlight here — the main list below owns "you are here", and marking
    // both put two purple blocks in the sidebar for the same hymn.
    wrap.innerHTML = '<div class="sect-label">Recent</div>' + hymns.map(h =>
        // A real <button>: these rows live outside any listbox, so role="option" was invalid
        // ARIA and left them unreachable by keyboard. A button is focusable and activatable
        // with Enter/Space for free.
        `<button type="button" class="hymn-row recent" data-n="${h.number}">${rowInnerHTML(h)}</button>`
    ).join('');
    wrap.querySelectorAll('.hymn-row').forEach(el => el.addEventListener('click', () => {
        const h = HYMNS.find(x => x.number === parseInt(el.dataset.n, 10));
        if (h) selectHymn(h);
    }));
    wrap.hidden = false;
}

/** Create a debounced version of fn that delays execution by delay ms. */
function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

const debouncedSearch = debounce(syncSearch, 150);

let searchHighlight = -1;

$('search').addEventListener('input', () => {
    searchHighlight = -1;
    $('search').removeAttribute('aria-activedescendant');
    debouncedSearch($('search').value.trim());
});

$('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        // Flush any pending debounced search first — otherwise Enter within the 150ms
        // window picks from the stale list (typing "12" could open hymn 1)
        syncSearch($('search').value.trim());
        const target = searchHighlight >= 0 && searchHighlight < filtered.length
            ? filtered[searchHighlight] : filtered[0];
        // Blur only on mobile, where it dismisses the on-screen keyboard. On desktop it would
        // eject a keyboard user from the results they are still arrowing through.
        if (target) { selectHymn(target, { focusTitle: false }); if (window.innerWidth < 769) $('search').blur(); }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        searchHighlight = Math.min(searchHighlight + 1, filtered.length - 1);
        updateSearchHighlight();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        searchHighlight = Math.max(searchHighlight - 1, 0);
        updateSearchHighlight();
    }
});

/** Scroll the keyboard-highlighted row into view and apply visual focus class. */
function updateSearchHighlight() {
    const wrap = $('list-wrap');
    wrap.querySelectorAll('.hymn-row').forEach(el => el.classList.remove('kb-focus'));
    if (searchHighlight < 0) return;
    // Scroll the highlighted row into view (via its item offset — dividers shift the index)
    const rowTop = itemOffsets[itemIndexOfRow[searchHighlight]] ?? 0;
    const { scrollTop, clientHeight } = wrap;
    if (rowTop < scrollTop) wrap.scrollTop = rowTop;
    else if (rowTop + ROW_H > scrollTop + clientHeight) wrap.scrollTop = rowTop + ROW_H - clientHeight;
    listScrollTop = wrap.scrollTop;
    renderList();
    // Apply highlight after render
    const rows = wrap.querySelectorAll('.hymn-row');
    rows.forEach(el => {
        if (parseInt(el.dataset.n) === filtered[searchHighlight]?.number) el.classList.add('kb-focus');
    });
    // Expose the highlighted option to screen readers via the input's activedescendant
    const active = filtered[searchHighlight];
    if (active) $('search').setAttribute('aria-activedescendant', 'hymn-opt-' + active.number);
    else $('search').removeAttribute('aria-activedescendant');
}

$('empty-search').addEventListener('input', () => {
    const q = $('empty-search').value.trim();
    $('search').value = q;
    debouncedSearch(q);
    if (q.length > 0) {
        openSidebar();
        $('empty-search').value = '';
    }
});

$('empty-browse-btn').addEventListener('click', openSidebar);

/** Filter and rank hymns against search query. Scoring priority: exact number (100) > number prefix (90) > Yoruba title (80) > English title (70) > references (60) > lyrics (40). */
function syncSearch(q) {
    const normalised = normalise(q);
    matchInfo = new Map();
    if (!normalised) {
        // Saved view: keep the service order (saved order), not the hymnal's — the order
        // is the whole point of a set. Plain browse stays in hymnal order.
        filtered = listOnly
            ? setHymns().map(n => HYMNS.find(h => h.number === n)).filter(Boolean)
            : [...HYMNS];
    } else {
        // Accent-insensitive highlighter: each query letter may be followed by combining
        // marks, so "oluwa" marks "Olúwa" (the query is already normalised/stripped).
        const hlRe = new RegExp(normalised.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\u0300-\\u036f]*').join(''), 'i');
        let scored = [];
        for (const entry of searchIndex) {
            let score = 0, field = null;
            // Exact hymn number match
            if (entry.number === normalised) { score = 100; field = 'number'; }
            // Number starts with query
            else if (entry.number.startsWith(normalised) && /^\d+$/.test(normalised)) { score = 90; field = 'number'; }
            // Yoruba title match
            if (entry.title.includes(normalised) && score < 80) { score = 80; field = 'title'; }
            // English title match
            if (entry.englishTitle.includes(normalised) && score < 70) { score = 70; field = 'english'; }
            // Reference match (e.g. "sdah 16", "nah 2")
            if (entry.refs.includes(normalised) && score < 60) { score = 60; field = 'refs'; }
            // Lyrics match
            if (entry.lyrics.includes(normalised) && score < 40) { score = 40; field = 'lyrics'; }

            if (score > 0) scored.push({ hymn: entry.hymn, score, field });
        }
        scored.sort((a, b) => b.score - a.score || a.hymn.number - b.hymn.number);
        filtered = scored.map(s => s.hymn);

        if (listOnly) {
            const favSet = new Set(setHymns());
            scored = scored.filter(s => favSet.has(s.hymn.number));
            filtered = scored.map(s => s.hymn);
        }
        // Record why each row matched so the row can show it (title/english → highlight;
        // lyrics → the matching line). Number/refs matches have nothing worth marking.
        for (const s of scored) {
            if (!s.field || s.field === 'number' || s.field === 'refs') continue;
            let line = null;
            if (s.field === 'lyrics') {
                outer: for (const b of s.hymn.lyrics) {
                    for (const l of b.lines) {
                        const t = typeof l === 'string' ? l : l.text;
                        if (t && normalise(t).includes(normalised)) { line = t; break outer; }
                    }
                }
                if (!line) continue; // matched somewhere we can't show — leave the row plain
            }
            matchInfo.set(s.hymn.number, { field: s.field, re: hlRe, line });
        }
    }
    if (normalised && typeof umami !== 'undefined') {
        clearTimeout(syncSearch._t);
        syncSearch._t = setTimeout(() => umami.track('search_' + q.substring(0, 50)), 1000);
    }
    listScrollTop = 0;
    $('list-wrap').scrollTop = 0;
    renderRecent();
    renderSets();   // the saved section narrows to its matches while searching
    renderList();
}

let fromPopstate = false;

/** Select a hymn: update state, render content, update URL, close sidebar on mobile.
 *  focusTitle: false leaves focus where it is (the sidebar search) so arrow-key browsing
 *  of the results survives the selection. */
function selectHymn(hymn, { focusTitle = true } = {}) {
    current = hymn;
    document.querySelectorAll('#list-wrap .hymn-row').forEach(el => el.classList.toggle('active', parseInt(el.dataset.n) === hymn.number));
    renderHymn(hymn, focusTitle);
    $('pres-open').disabled = false;
    $('fs-toggle').style.display = '';
    presBlocks = [
        { type: 'title', index: 0, lines: [current.title, current.english_title] },
        ...hymn.lyrics.map(b => ({
            type: b.type,
            index: b.index,
            lines: b.lines.map(l => typeof l === 'string'
                ? { part: 'verse', text: l }
                : { part: l.part, text: l.text })
        }))
    ];
    presIdx = 0;
    if (window.innerWidth < 769) closeSidebar(true);
    $('main').scrollTo({ top: 0, behavior: 'smooth' });
    localStorage.setItem('lastHymn', hymn.number);
    pushRecent(hymn.number);
    updateFavButton();
    renderRecent();
    updateMeta(hymn);
    if (fromPopstate) {
        fromPopstate = false;
    } else {
        history.pushState({ hymn: hymn.number }, '', hymnPath(hymn));
    }
    if (typeof umami !== 'undefined') umami.track('hymn_' + hymn.number);
    scrollSidebarToActive();
}

/** Build a hymn's content markup. Shared by the live render and the off-screen pager
 *  panes, so a hymn looks identical wherever it lands. */
function hymnHTML(hymn) {
    const refs = Object.entries(hymn.references || {}).map(([k,v]) => `<span class="ref-tag">${escHtml(String(k))} ${escHtml(String(v))}</span>`).join('');
    const idx = HYMNS.findIndex(h => h.number === hymn.number);
    const hasPrev = idx > 0;
    const hasNext = idx < HYMNS.length - 1;
    let html = '';
    let firstChorus = null;   // lines of the first chorus, for collapsing identical repeats
    hymn.lyrics.forEach(block => {
        const isChorus      = block.type === 'chorus';
        const isCallResponse = block.type === 'call_response';
        let label, inner;

        if (isChorus) {
            // The data repeats the refrain after every verse. Rendering each repeat in full
            // makes two identical blocks land side by side in the two-column layout, which
            // reads as a duplication glitch — so after the first, show a reference instead.
            // (Presentation mode still shows every chorus in full: the congregation needs it.)
            const key = JSON.stringify(block.lines);
            if (firstChorus === null) firstChorus = key;
            else if (key === firstChorus) {
                html += '<div class="stanza chorus-ref-block"><div class="s-label">Chorus</div><div class="chorus-ref">Repeat the chorus</div></div>';
                return;
            }
        }

        if (isCallResponse) {
            label = 'Call &amp; Response ' + block.index;
            const rows = block.lines.map(l => `
                <div class="cr-line ${escHtml(l.part)}">
                    <span class="cr-part">${escHtml(crPartLabel(l.part))}</span>
                    <span class="cr-text">${escHtml(l.text)}</span>
                </div>`).join('');
            inner = `<div class="cr-block">${rows}</div>`;
        } else {
            label = isChorus ? 'Chorus' : 'Verse ' + block.index;
            const lines = block.lines.map(l => `<span class="s-line">${escHtml(l)}</span>`).join('');
            inner = isChorus
                ? `<div class="chorus-block">${lines}</div>`
                : `<div class="verse-block">${lines}</div>`;
        }
        const wide = block.type === 'call_response' || block.lines.length >= WIDE_LINES;
        html += `<div class="stanza${wide ? ' wide' : ''}"><div class="s-label">${label}</div>${inner}</div>`;
    });
    return `
<div class="hymn-hdr">
  <div class="h-num"><span class="sr-only">Hymn </span>${hymn.number}</div>
  <h1 class="h-title" lang="yo" tabindex="-1">${escHtml(hymn.title)}</h1>
  ${hymn.english_title ? `<div class="h-en" lang="en">${escHtml(hymn.english_title)}</div>` : ''}
  ${refs ? `<div class="h-refs">${refs}</div>` : ''}
</div>
<div class="lyrics" data-blocks="${hymn.lyrics.length}">${html}</div>
<div class="hymn-nav">
  <button class="hymn-nav-btn" data-nav="prev" ${hasPrev ? '' : 'disabled'} aria-label="Previous hymn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    <span class="nav-label">Previous</span>
  </button>
  <div class="hymn-nav-center">
    <span>${idx + 1} of ${HYMNS.length}</span>
  </div>
  <button class="hymn-nav-btn" data-nav="next" ${hasNext ? '' : 'disabled'} aria-label="Next hymn">
    <span class="nav-label">Next</span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  </button>
</div>`;
}

/** Render hymn content into #hymn-view. First render is synchronous to avoid a flash of
 *  empty content; later renders cross-fade over 80ms — except a swipe commit, which skips
 *  the fade because the pane is already showing the incoming hymn. */
let initialLoad = true;
let skipFade = false;   // set by the swipe commit
function renderHymn(hymn, focusTitle = true) {
    $('empty').style.display = 'none';
    $('hymn-content').style.display = 'block';
    $('numpad-fab').classList.add('active');
    document.querySelector('.scroll-spacer').style.height = '4rem';
    const view = $('hymn-view');
    const doFade = !initialLoad && !skipFade;
    skipFade = false;
    if (doFade) view.classList.add('fading');
    const render = () => {
        view.innerHTML = hymnHTML(hymn);
        applyReadFz();
        const idx = HYMNS.findIndex(h => h.number === hymn.number);
        // Query within the centre pane: while a swipe is live the neighbour panes hold a
        // second copy of these nodes, and document.getElementById would return whichever
        // comes first in the DOM — the off-screen one.
        const prevBtn = view.querySelector('.hymn-nav-btn[data-nav="prev"]');
        const nextBtn = view.querySelector('.hymn-nav-btn[data-nav="next"]');
        if (prevBtn) prevBtn.addEventListener('click', () => selectHymn(HYMNS[idx - 1]));
        if (nextBtn) nextBtn.addEventListener('click', () => selectHymn(HYMNS[idx + 1]));
        if (doFade) view.classList.remove('fading');
        // Move focus to the hymn title on desktop for screen reader users — but not when the
        // selection came from the sidebar (that would eject a keyboard user from the list they
        // are browsing), and not during presentation (that pulls focus out from under the
        // overlay, past its own focus trap).
        if (window.innerWidth >= 769 && !presRestorePending && focusTitle && !$('pres').classList.contains('on')) {
            const title = view.querySelector('.h-title');
            if (title) title.focus();
        }
    };
    if (doFade) setTimeout(render, 80); else { render(); initialLoad = false; }
}

/** Share a hymn. mode 'auto' uses the native share sheet when available, else copies;
 *  mode 'copy' always copies. feedbackEl (optional) gets the inline "Copied ✓" swap. */
function shareHymn(hymn, { mode = 'auto', feedbackEl = null } = {}) {
    const url = location.origin + hymnPath(hymn);
    if (typeof umami !== 'undefined') umami.track('share_' + hymn.number);
    if (mode === 'auto' && navigator.share) {
        navigator.share({
            title: `Hymn ${hymn.number} – ${hymn.title}`,
            text: `${hymn.title} (${hymn.english_title})`,
            url
        }).catch(() => {});
        return;
    }
    copyLink(url, feedbackEl);
}

/** Copy a URL, falling back to execCommand where the async clipboard is unavailable or denied. */
function copyLink(url, el) {
    const done = () => showCopied(el);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(() => { if (legacyCopy(url)) done(); });
    } else if (legacyCopy(url)) {
        done();
    }
}

/** Hidden-textarea copy for insecure origins and older browsers. */
function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
}

/** Announce a one-off change through the shared live region. */
function announce(msg) {
    const s = $('rail-status');
    if (!s) return;
    s.textContent = msg;
    clearTimeout(announce._t);
    announce._t = setTimeout(() => { s.textContent = ''; }, 2000);
}

/** Inline, same-element copy feedback: label swaps to "Copied ✓", reverts after 1.5s.
 *  The dedicated #rail-status region announces it once (not the button itself). */
function showCopied(el) {
    const status = $('rail-status');
    if (status) {
        status.textContent = 'Link copied';
        setTimeout(() => { status.textContent = ''; }, 2000);
    }
    if (!el) return;
    const label = el.querySelector('.act-label');
    el.classList.add('copied');
    if (label) label.textContent = 'Copied ✓';
    clearTimeout(el._copyT);
    el._copyT = setTimeout(() => {
        el.classList.remove('copied');
        if (label) label.textContent = el.dataset.label || 'Copy link';
    }, 1500);
}

// Reading font size steps: small (1.0x), medium (1.2x), large (1.45x)
const FZ_SIZES = [
    { label: 'Small',  value: 1.0 },
    { label: 'Medium', value: 1.2 },
    { label: 'Large',  value: 1.45 }
];
let fzIdx = FZ_SIZES.findIndex(s => s.value === readFz);
if (fzIdx === -1) fzIdx = 0;

/** Name the current size on the toggle. Without this the control is a silent cycle: you
 *  can't tell which of the three you're on, and hitting the end snaps back to the start
 *  with no explanation. The cycle stays (a single button is the only way back), but it is
 *  no longer silent. */
function updateFzButton() {
    const btn = $('fs-toggle');
    if (!btn) return;
    const name = FZ_SIZES[fzIdx].label;
    btn.title = 'Text size: ' + name;
    btn.setAttribute('aria-label', 'Text size: ' + name + ' — change text size');
}

/** Apply the reading font size. A CSS custom property (not inline font-size) so the
 *  print stylesheet and the two-column threshold in styles.css see the same value.
 *  Set on the pager, not #hymn-view, so the off-screen swipe panes read at the same
 *  size as the centre while a drag is in progress. */
function applyReadFz() {
    ($('hymn-pager') || $('hymn-view')).style.setProperty('--read-fz', readFz);
}

$('fs-toggle').addEventListener('click', () => {
    fzIdx = (fzIdx + 1) % FZ_SIZES.length;
    readFz = FZ_SIZES[fzIdx].value;
    applyReadFz();
    updateFzButton();
    announce('Text size: ' + FZ_SIZES[fzIdx].label);
    localStorage.setItem('readFz', readFz);
});
updateFzButton();   // name the size the page loaded with


let presOpener = null;
let presRestorePending = false; // blocks renderHymn's title.focus() until focus is restored to the opener

// ── Screen wake lock (presentation mode) ──
let wakeLock = null;
function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(l => {
        wakeLock = l;
        l.addEventListener('release', () => { wakeLock = null; });
    }).catch(() => {});
}
function releaseWakeLock() {
    if (!wakeLock) return;
    wakeLock.release().catch(() => {});
    wakeLock = null;
}
// The lock is dropped whenever the tab is hidden; re-acquire when the service resumes.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('pres').classList.contains('on')) requestWakeLock();
});

/** Open presentation mode for the current hymn (shared by the header button and the rail). */
function openPresentation() {
    if (!current) return;
    if (typeof umami !== 'undefined') umami.track('presented_' + current.number);
    $('pf-num').textContent  = 'Hymn ' + current.number;
    $('pf-name').textContent = current.title;
    presIdx = 0;
    $('pres').classList.add('on');
    history.pushState({ presentation: true }, '');
    $('pres-lines').className = '';   // the title slide rises; only advance/retreat push sideways
    renderPresBlock();
    document.addEventListener('keydown', presKey);
    requestWakeLock();
    presOpener = document.activeElement;
    const stage = $('pres-stage');
    stage.focus(); // visibility flips instantly with .on
    const el = $('pres');
    if (el.requestFullscreen) el.requestFullscreen().then(() => stage.focus()).catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
}
$('pres-open').addEventListener('click', openPresentation);

// ── Action rail (static markup in index.html; wired once, reads module-level `current`) ──
const onRail = fn => e => { if (current) fn(current, e.currentTarget); };
$('rail-present').addEventListener('click', onRail(() => openPresentation()));
$('rail-print').addEventListener('click', onRail(h => { if (typeof umami !== 'undefined') umami.track('print_' + h.number); window.print(); }));
$('rail-share').addEventListener('click', onRail(h => shareHymn(h, { mode: 'auto' })));
$('rail-copy').addEventListener('click', onRail((h, el) => shareHymn(h, { mode: 'copy', feedbackEl: el })));
$('rail-fav').addEventListener('click', onRail(h => toggleInList(h.number)));

// Swipe gestures on presentation stage
let swipeStartX = 0;
let swipeStartY = 0;
$('pres-stage').addEventListener('touchstart', e => {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
}, { passive: true });
$('pres-stage').addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = e.changedTouches[0].clientY - swipeStartY;
    if (Math.abs(dx) < 40 && Math.abs(dy) < 40) { advance(); return; }
    if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < -40) advance();
        else if (dx > 40) retreat();
    }
}, { passive: true });

/** Render the current presentation slide. Handles title, verse, chorus, call-response, and end-of-hymn states. Each line animates in with a staggered delay. */
function renderPresBlock() {
    const endEl   = $('pres-end');
    const linesEl = $('pres-lines');
    const labelEl = $('pres-blk-label');
    const stage   = $('pres-stage');
    const isEnd   = presIdx >= presBlocks.length;

    endEl.classList.toggle('visible', isEnd);
    linesEl.style.display  = isEnd ? 'none' : '';
    labelEl.style.display  = isEnd ? 'none' : '';
    $('p-next').disabled   = isEnd;
    $('p-prev').disabled   = presIdx === 0;
    stage.classList.remove('is-chorus', 'is-verse', 'is-title');
    $('p-prog').textContent = isEnd
        ? 'End'
        : presIdx === 0
            ? 'Title'
            : presIdx + ' / ' + (presBlocks.length - 1);

    if (isEnd) {
        // Offer the next hymn — a service is a sequence, so the end slide must lead somewhere
        const next = nextPresHymn();
        const btn = $('pres-next-hymn');
        if (next) {
            document.querySelector('.pres-next-kicker').firstChild.textContent = presFromSet ? 'Next in set ' : 'Next hymn ';
            $('pres-next-num').textContent = next.number + ' ·';
            $('pres-next-title').textContent = next.title;
            btn.hidden = false;
        } else {
            btn.hidden = true;
        }
        return;
    }

    const b = presBlocks[presIdx];
    const isTitle       = b.type === 'title';
    const isChorus      = b.type === 'chorus';
    const isCallResponse = b.type === 'call_response';

    if (isTitle) {
        labelEl.textContent = 'Hymn ' + current.number;
        labelEl.className   = 'label-title';
    } else if (isChorus) {
        labelEl.textContent = 'Chorus';
        labelEl.className   = 'label-chorus';
    } else if (isCallResponse) {
        labelEl.textContent = 'Call & Response ' + b.index;
        labelEl.className   = 'label-verse';
    } else {
        labelEl.textContent = 'Verse ' + b.index;
        labelEl.className   = 'label-verse';
    }

    if (isTitle)            stage.classList.add('is-title');
    else if (isChorus)      stage.classList.add('is-chorus');
    else                    stage.classList.add('is-verse');

    linesEl.innerHTML = '';
    b.lines.forEach((line, i) => {
        const text = typeof line === 'string' ? line : line.text;
        const part = typeof line === 'string' ? 'verse' : line.part;
        if (!text) return;
        const span = document.createElement('span');
        if (isTitle) {
            span.className = 'pl ' + (i === 0 ? 'title-main' : 'title-sub');
        } else if (isCallResponse) {
            span.className = 'pl ' + (part === 'leader' ? 'verse-line' : 'chorus-line');
            // Add small part label
            const label = document.createElement('em');
            label.style.cssText = 'display:block;font-size:0.45em;letter-spacing:0.2em;text-transform:uppercase;opacity:0.5;margin-bottom:0.2em;font-style:normal;';
            label.textContent = crPartLabel(part).replace(/\//g, ' / ');
            span.appendChild(label);
            span.appendChild(document.createTextNode(text));
            span.style.animationDelay = (Math.min(i * 0.06, 0.3)) + 's';
            linesEl.appendChild(span);
            linesEl.appendChild(document.createElement('br'));
            return;
        } else {
            span.className = 'pl ' + (isChorus ? 'chorus-line' : 'verse-line');
        }
        span.textContent = text;
        span.style.animationDelay = (Math.min(i * 0.06, 0.3)) + 's';
        linesEl.appendChild(span);
        linesEl.appendChild(document.createElement('br'));
    });

    applyPresFz();
}

/** Scale presentation text based on viewport width and user font size preference. Base size ranges 18-52px proportional to screen width. */
function applyPresFz() {
    const base = Math.max(18, Math.min(window.innerWidth * 0.038, 52));
    // Tracking is size-specific — one value is wrong at both ends of the 18–78px range this
    // text spans. Small sizes want a touch of positive tracking; large display sizes want
    // negative. Interpolate on the rendered size (≈ +0.006em at 20px → -0.015em at 56px+).
    const track = px => (0.006 - 0.021 * Math.max(0, Math.min(1, (px - 20) / 36))).toFixed(4) + 'em';
    $('pres-lines').querySelectorAll('.pl').forEach(el => {
        let size;
        if (el.classList.contains('title-main'))     size = base * presFz * 1.5;
        else if (el.classList.contains('title-sub')) size = base * presFz * 0.75;
        else                                         size = base * presFz;
        el.style.fontSize = size + 'px';
        el.style.letterSpacing = track(size);
    });
}

$('p-next').addEventListener('click', advance);
$('p-prev').addEventListener('click', retreat);
$('pres-stage').addEventListener('click', e => { if (!e.target.closest('button') && !e.target.closest('#pres-foot')) advance(); });
/** Move to next/previous presentation slide. Past the end slide, "next" walks to the
 *  next hymn in the hymnal — the way a service actually flows. */
function advance()  {
    if (presIdx <= presBlocks.length - 1) { presIdx++; $('pres-lines').className = 'dir-next'; renderPresBlock(); }
    else nextHymnInPresentation();
}
function retreat()  { if (presIdx > 0) { presIdx--; $('pres-lines').className = 'dir-prev'; renderPresBlock(); } }

/** Where presentation goes next: the saved order when we started from it, else the hymnal. */
function nextPresHymn() {
    if (!current) return null;
    if (presFromSet) {
        const s = setHymns();
        const i = s.indexOf(current.number);
        return i > -1 && i < s.length - 1 ? HYMNS.find(h => h.number === s[i + 1]) : null;
    }
    const idx = HYMNS.findIndex(h => h.number === current.number);
    return idx > -1 && idx < HYMNS.length - 1 ? HYMNS[idx + 1] : null;
}

/** Move the presentation on, staying in presentation mode. */
function nextHymnInPresentation() {
    const next = nextPresHymn();
    if (!next) return;
    selectHymn(next);                 // updates URL, meta, presBlocks (presIdx resets to 0)
    $('pf-num').textContent  = 'Hymn ' + current.number;
    $('pf-name').textContent = current.title;
    $('pres-lines').className = 'dir-next';
    renderPresBlock();
}

/** Start a service: present the active set in its order. */
function presentSet() {
    if (!setHymns().length) return;
    const first = HYMNS.find(h => h.number === setHymns()[0]);
    if (!first) return;
    presFromSet = true;
    if (window.innerWidth < 769) closeSidebar(true);
    selectHymn(first);
    openPresentation();
}
$('pres-next-hymn').addEventListener('click', nextHymnInPresentation);
$('p-exit').addEventListener('click', closePres);
$('pf-up').addEventListener('click',   () => { presFz = Math.min(presFz + 0.15, 2.5); applyPresFz(); localStorage.setItem('presFz', presFz); });
$('pf-down').addEventListener('click', () => { presFz = Math.max(presFz - 0.15, 0.4); applyPresFz(); localStorage.setItem('presFz', presFz); });
/** Keyboard handler for presentation mode. Arrow keys and space navigate slides; +/- adjust font; Escape exits. */
function presKey(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); advance(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); retreat(); }
    else if (e.key === 'Escape') closePres();
    else if (e.key === 'Tab') {
        const focusables = [...$('pres').querySelectorAll('button')].filter(b => !b.disabled);
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (!document.activeElement.closest('#pres')) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    else if (e.key === '+' || e.key === '=') { presFz = Math.min(presFz + 0.15, 2.5); applyPresFz(); localStorage.setItem('presFz', presFz); }
    else if (e.key === '-') { presFz = Math.max(presFz - 0.15, 0.4); applyPresFz(); localStorage.setItem('presFz', presFz); }
}
/** Exit presentation mode: hide overlay, remove keyboard listener, exit fullscreen, update history. Focus restore waits 200ms so fullscreen exit (which blurs to <body>) and the popstate re-render settle first. */
function closePres(fromPopstate) {
    if (!$('pres').classList.contains('on')) return;
    $('pres').classList.remove('on');
    document.removeEventListener('keydown', presKey);
    presFromSet = false;
    releaseWakeLock();
    presRestorePending = true;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    if (!fromPopstate && history.state && history.state.presentation) history.back();
    setTimeout(() => {
        presRestorePending = false;
        if (presOpener) { presOpener.focus(); presOpener = null; }
    }, 200);
}

/** Scroll the sidebar so the active hymn row is visible. Accounts for virtual list row positioning. */
function scrollSidebarToActive() {
    if (!current) return;
    const idx = filtered.findIndex(h => h.number === current.number);
    if (idx === -1) return;
    const wrap = $('list-wrap');
    const rowTop    = itemOffsets[itemIndexOfRow[idx]] ?? idx * ROW_H;
    const rowBottom = rowTop + ROW_H;
    const { scrollTop, clientHeight } = wrap;
    if (rowTop < scrollTop) {
        wrap.scrollTop = rowTop;
    } else if (rowBottom > scrollTop + clientHeight) {
        wrap.scrollTop = rowBottom - clientHeight;
    }
    listScrollTop = wrap.scrollTop;
    renderList();
}

window.addEventListener('resize', () => { if ($('pres').classList.contains('on')) applyPresFz(); });

// ── Swipe pager ──
const pager      = $('hymn-pager');
const paneEls    = [$('pane-prev'), $('hymn-view').parentElement, $('pane-next')];
const paneW      = () => pager.clientWidth || 1;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const liveX = el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;

let swipe = null;        // active drag: { pid, x0, y0, base, hist }
let swipeDx = 0;         // current horizontal translate, px
let swipeVel = 0;        // px/s, from a ~100ms window
let swipeAnim = null;    // live spring handle

/** The hymn `dir` steps away (-1 prev, +1 next), or null at the ends of the hymnal. */
function neighbourHymn(dir) {
    if (!current) return null;
    const i = HYMNS.findIndex(h => h.number === current.number) + dir;
    return (i >= 0 && i < HYMNS.length) ? HYMNS[i] : null;
}

/** Place the three panes for a given translate. */
function setTranslate(dx) {
    swipeDx = dx;
    if (reducedMotion()) return;   // no visual tracking for reduced-motion users
    const w = paneW();
    paneEls[0].style.transform = `translateX(${dx - w}px)`;
    paneEls[1].style.transform = `translateX(${dx}px)`;
    paneEls[2].style.transform = `translateX(${dx + w}px)`;
}

/** During a drag, resist past an end that has no hymn to reveal. */
function paintDrag(dx) {
    const w = paneW();
    if (dx > 0 && !neighbourHymn(-1)) dx = rubberband(dx, w);
    else if (dx < 0 && !neighbourHymn(1)) dx = rubberband(dx, w);
    setTranslate(dx);
}

/** Render the neighbouring hymns into their panes (only while a drag is live). */
function fillNeighbours() {
    const prev = neighbourHymn(-1), next = neighbourHymn(1);
    paneEls[0].innerHTML = prev ? hymnHTML(prev) : '';
    paneEls[2].innerHTML = next ? hymnHTML(next) : '';
}

/** Return the track to rest: centre the current hymn and clear the off-screen panes. */
function endPagerMotion() {
    swipeAnim = null;
    pager.classList.remove('swiping');
    paneEls.forEach(el => { el.style.willChange = ''; });
    setTranslate(0);
    paneEls[0].innerHTML = '';
    paneEls[2].innerHTML = '';
}

/** Release: decide the target from the projected rest position, then spring to it. */
function settleSwipe() {
    const w = paneW();
    const projected = swipeDx + project(swipeVel, 0.99);
    const dragged = Math.abs(swipeDx) >= w * 0.5;
    const flicked = Math.abs(swipeDx) >= w * 0.2 &&
                    Math.sign(swipeVel) === Math.sign(swipeDx) &&
                    Math.abs(projected) >= w * 0.4;
    let target = 0, dir = 0;
    if (dragged || flicked) {
        dir = swipeDx < 0 ? 1 : -1;
        if (neighbourHymn(dir)) target = dir === 1 ? -w : w;
        else dir = 0;
    }

    const commit = () => {
        swipeAnim = null;
        if (dir) {
            skipFade = true;                    // the incoming pane already shows it
            selectHymn(neighbourHymn(dir));     // that hymn becomes the centre pane
        }
        endPagerMotion();
    };
    if (reducedMotion()) { swipeDx = target; commit(); return; }
    swipeAnim = spring({ from: swipeDx, to: target, velocity: swipeVel, damping: 1, response: 0.36 }, setTranslate, commit);
}

$('main').addEventListener('pointerdown', e => {
    if (!current || e.pointerType === 'mouse') return;                 // mouse: keep text selection
    if (e.target.closest('button, a, input, #pres, .numpad-overlay')) return;
    if (swipeAnim) { swipeAnim.stop(); swipeAnim = null; }             // grab mid-flight
    swipe = { pid: e.pointerId, x0: e.clientX, y0: e.clientY, base: liveX(paneEls[1]), hist: [{ x: e.clientX, t: performance.now() }] };
    swipeVel = 0;
});

$('main').addEventListener('pointermove', e => {
    if (!swipe || swipe.pid !== e.pointerId) return;
    const fx = e.clientX - swipe.x0, fy = e.clientY - swipe.y0;
    if (!pager.classList.contains('swiping')) {
        if (Math.abs(fx) < 10 && Math.abs(fy) < 10) return;            // hysteresis before committing
        if (Math.abs(fy) >= Math.abs(fx)) { swipe = null; return; }    // vertical intent → let #main scroll
        try { $('main').setPointerCapture(e.pointerId); } catch (err) {}
        pager.classList.add('swiping');
        fillNeighbours();
        paneEls.forEach(el => { el.style.willChange = 'transform'; });
    }
    paintDrag(swipe.base + fx);
    const now = performance.now();
    swipe.hist.push({ x: e.clientX, t: now });
    while (swipe.hist.length > 2 && now - swipe.hist[0].t > 100) swipe.hist.shift();
    const h0 = swipe.hist[0], hN = swipe.hist[swipe.hist.length - 1];
    swipeVel = (hN.x - h0.x) / Math.max(1, hN.t - h0.t) * 1000;        // px/s over the window
});

$('main').addEventListener('pointerup', e => {
    if (!swipe || swipe.pid !== e.pointerId) return;
    const wasSwiping = pager.classList.contains('swiping');
    swipe = null;
    try { $('main').releasePointerCapture(e.pointerId); } catch (err) {}
    if (wasSwiping) settleSwipe();
});

$('main').addEventListener('pointercancel', () => {
    if (!swipe) return;
    const wasSwiping = pager.classList.contains('swiping');
    swipe = null;
    if (wasSwiping) { setTranslate(0); endPagerMotion(); }   // browser took the gesture (scroll)
});

// ── Header & dock hide-on-scroll ──
let lastMainScroll = 0;
$('main').addEventListener('scroll', () => {
    const y = $('main').scrollTop;
    if (y > 120 && y > lastMainScroll) document.body.classList.add('hdr-hidden', 'dock-hidden');
    else if (y < lastMainScroll - 4 || y < 120) document.body.classList.remove('hdr-hidden', 'dock-hidden');
    lastMainScroll = y;
}, { passive: true });

// ── Scroll-to-top button ──
const scrollBtn = $('scroll-top');
$('main').addEventListener('scroll', () => {
    scrollBtn.classList.toggle('visible', current && $('main').scrollTop > 400);
}, { passive: true });
scrollBtn.addEventListener('click', () => $('main').scrollTo({ top: 0, behavior: 'smooth' }));

$('menu-btn').addEventListener('click', () => {
    $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
});
$('home-btn').addEventListener('click', goHome);
$('sb-overlay').addEventListener('click', closeSidebar);

/** Return to home/empty state: deselect hymn, clear search, update URL. */
function goHome() {
    current = null;
    $('hymn-content').style.display = 'none';
    $('empty').style.display = '';
    // A "Hymn N not found" message from a bad deep link would otherwise stick to the hero.
    const homeH = $('empty').querySelector('h1');
    const homeP = $('empty').querySelector('p');
    if (homeH) homeH.textContent = EMPTY_HEADING;
    if (homeP) { homeP.innerHTML = EMPTY_BLURB; homeP.style.display = ''; }
    $('numpad-fab').classList.remove('active');
    document.querySelector('.scroll-spacer').style.height = '0';
    $('pres-open').disabled = true;
    $('fs-toggle').style.display = 'none';
    $('search').value = '';
    $('empty-search').value = '';
    filtered = [...HYMNS];
    matchInfo = new Map();
    listOnly = false;
    renderList();
    renderRecent();
    renderSets();
    localStorage.removeItem('lastHymn');
    updateMeta(null);
    if (fromPopstate) {
        fromPopstate = false;
    } else {
        history.pushState(null, '', '/');
    }
    $('main').scrollTo({ top: 0, behavior: 'smooth' });
}

/** Open the sidebar with history state for back-button support. */
function openSidebar() {
    $('sidebar').classList.add('open');
    $('sb-overlay').classList.add('show');
    history.pushState({ sidebar: true }, '');
    setTimeout(() => $('search').focus(), 250);
}
/** Close the sidebar. Skips history.back() if triggered by popstate. */
function closeSidebar(fromPopstate) {
    if (!$('sidebar').classList.contains('open')) return;
    $('sidebar').classList.remove('open');
    $('sb-overlay').classList.remove('show');
    if (!fromPopstate && history.state && history.state.sidebar) history.back();
}

window.addEventListener('popstate', e => {
    if ($('pres').classList.contains('on')) {
        closePres(true);
        return;
    }
    if ($('sidebar').classList.contains('open')) {
        closeSidebar(true);
        return;
    }
    // Restore hymn from URL
    const num = hymnNumFromLocation();
    const hymn = isNaN(num) ? null : HYMNS.find(h => h.number === num);
    fromPopstate = true;
    if (hymn) {
        selectHymn(hymn);
    } else {
        goHome();
    }
});

/** Escape HTML special characters to prevent XSS in innerHTML. */
function escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Fluid drawer: drag-to-dismiss (mobile) ──
(function () {
    const drawer = $('sidebar');
    let dragging = false, captured = false, pid = null, startX = 0, startY = 0, baseX = 0, vel = 0, width = 0;
    let hist = []; // recent {x, t} samples for the release-velocity window
    let anim = null;

    drawer.addEventListener('pointerdown', e => {
        if (window.innerWidth > 768 || !drawer.classList.contains('open')) return;
        if (e.target.closest('input, button, a')) return;
        if (anim) { anim.stop(); anim = null; }   // grab mid-flight
        dragging = true; captured = false; pid = e.pointerId;
        startX = e.clientX; startY = e.clientY;
        vel = 0;
        hist = [{ x: e.clientX, t: performance.now() }];
        width = drawer.getBoundingClientRect().width;
        // Freeze at the current on-screen position — never snap to a logical value
        baseX = liveX(drawer);
        drawer.style.transform = `translateX(${baseX}px)`;
        drawer.style.transition = 'none';
    });
    drawer.addEventListener('pointermove', e => {
        if (!dragging || e.pointerId !== pid) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) < 10) return;                           // hysteresis before committing
        if (Math.abs(dy) > Math.abs(dx)) { end(true); return; }  // vertical intent → gesture goes back to scrolling
        // Capture only now that a horizontal drag is real. Capturing on pointerdown instead
        // swallowed the click on a hymn row (a div) — taps did nothing at mobile widths with
        // a mouse, because the drawer had taken the pointer.
        if (!captured) { try { drawer.setPointerCapture(pid); } catch (err) {} captured = true; }
        const raw = baseX + dx;
        // 1:1 leftward, hard-clamped at closed, rubber-band resistance past open
        const x = raw > 0 ? rubberband(raw, width) : Math.max(raw, -width);
        drawer.style.transform = `translateX(${x}px)`;
        const now = performance.now();
        // Velocity from a ~100ms history window — segment-to-segment speed at
        // pointer-event frequency is noise and mislabels deliberate drags as flicks
        hist.push({ x: e.clientX, t: now });
        while (hist.length > 2 && now - hist[0].t > 100) hist.shift();
        vel = (hist[hist.length - 1].x - hist[0].x) / Math.max(1, hist[hist.length - 1].t - hist[0].t) * 1000;
    });
    function end(cancelled) {
        if (!dragging) return;
        dragging = false;
        if (captured) { try { drawer.releasePointerCapture(pid); } catch (err) {} captured = false; }
        const cur = liveX(drawer);
        // Momentum decides: project where the flick would coast to rest, and dismiss if that
        // lands past halfway closed (or if it was a decisive leftward flick).
        const projected = cur + project(vel);
        const dismiss = !cancelled && (projected <= -width / 2 || vel < -400);
        const target = dismiss ? -width : 0;
        if (reducedMotion()) {          // settle instantly — no spring for reduced-motion users
            drawer.style.transform = '';
            drawer.style.transition = '';
            if (dismiss) closeSidebar(true);
            return;
        }
        // transition stays 'none' (set on pointerdown) so the per-frame spring values are not
        // re-animated by the CSS transition; it is restored once the spring lands.
        anim = spring({ from: cur, to: target, velocity: vel, damping: 1, response: 0.34 },
            x => { drawer.style.transform = `translateX(${x}px)`; },
            () => {
                anim = null;
                if (dismiss) closeSidebar(true);
                drawer.style.transform = '';
                drawer.style.transition = '';
            });
    }
    drawer.addEventListener('pointerup', () => end(false));
    drawer.addEventListener('pointercancel', () => end(true));
})();

// Canonical/OG tags are managed per-view by updateMeta(); the home page keeps the
// defaults baked into index.html, and prerendered hymn pages ship their own canonical.
document.addEventListener('DOMContentLoaded', () => {
    const hymView = document.getElementById('hymn-view');
    if (hymView) hymView.setAttribute('data-print-credit', 'SDA Hymnal Yorùbá - ' + location.hostname);
});

document.addEventListener('keydown', e => {
    // Escape backs out of the mobile drawer (wayfinding: '/' can open it, Escape must close it)
    if (e.key === 'Escape' && window.innerWidth < 769 && $('sidebar').classList.contains('open')) {
        closeSidebar();
        return;
    }
    if (e.key !== '/') return;
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if ($('pres').classList.contains('on')) return;
    e.preventDefault();
    if (window.innerWidth < 769) openSidebar();
    setTimeout(() => $('search').focus(), window.innerWidth < 769 ? 260 : 0);
});

// ── Theme (light / dark / system) ──
// Cycles: light -> dark -> system. System follows OS prefers-color-scheme.
// Persisted in localStorage('theme'). Applied via data-theme attribute on <html>.
const sunSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const moonSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const systemSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 7V2M12 22v-5"/><path d="M16.24 7.76l2.83-2.83M4.93 19.07l2.83-2.83"/><path d="M22 12h-5M7 12H2"/><path d="M19.07 19.07l-2.83-2.83M7.76 7.76L4.93 4.93"/><path d="M12 7a5 5 0 0 0 0 10" fill="currentColor" stroke="none"/></svg>';

/** Get stored theme preference. Returns 'light', 'dark', or 'system'. */
function getThemeMode() {
    return localStorage.getItem('theme') || 'system';
}

/** Resolve theme mode to actual 'light' or 'dark' value, checking OS preference for 'system'. */
function resolveTheme(mode) {
    if (mode === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return mode;
}

/** Apply theme: set data-theme attribute, update toggle button icons, update meta theme-color. */
function applyTheme(mode) {
    const resolved = resolveTheme(mode);
    document.documentElement.setAttribute('data-theme', resolved);
    const icon = mode === 'system' ? systemSvg : resolved === 'dark' ? sunSvg : moonSvg;
    ['theme-btn', 'theme-btn-hdr'].forEach(id => {
        const btn = $(id);
        if (btn) btn.innerHTML = icon;
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#1A1840' : '#5B52C8');
}

applyTheme(getThemeMode());

function cycleTheme() {
    const mode = getThemeMode();
    const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
    if (next === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', next);
    // Ease the brightness jump (abrupt dark↔light flips are jarring); class
    // removed after the fade so nothing else picks up long transitions.
    document.documentElement.classList.add('theme-anim');
    setTimeout(() => document.documentElement.classList.remove('theme-anim'), 300);
    applyTheme(next);
    // Swap feedback: the new icon rotates/fades in. WAAPI keeps it off the
    // main thread and skipped entirely for reduced-motion users.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        ['theme-btn', 'theme-btn-hdr'].forEach(id => {
            const btn = $(id);
            if (btn && btn.animate) btn.animate(
                [{ transform: 'rotate(-70deg) scale(0.7)', opacity: 0 }, { transform: 'none', opacity: 1 }],
                { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
            );
        });
    }
    if (typeof umami !== 'undefined') umami.track('theme_' + next);
}

['theme-btn', 'theme-btn-hdr'].forEach(id => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', cycleTheme);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemeMode() === 'system') applyTheme('system');
});

// The SW registers everywhere. Local freshness is the service worker's job now: on a dev
// origin it switches to network-first (see sw.js), so a stale cache can't hide your edits
// without the app having to unregister itself — which also cost it PWA installability.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}

// ── Android app banner & footer link ──
// Banner: shown on Android browsers only, dismissible.
// Footer "Android App" link: hidden on iOS (no point showing it).
(function() {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Hide footer Android link + dot on iOS
    if (isIOS) {
        const link = $('footer-android-link');
        const dot = $('footer-android-dot');
        if (link) link.style.display = 'none';
        if (dot) dot.style.display = 'none';
    }

    // Show banner on Android only
    const isDismissed = sessionStorage.getItem('appBannerDismissed');
    const banner = $('app-banner');
    if (!banner || !isAndroid || isDismissed) return;

    banner.style.display = 'flex';
    document.body.classList.add('has-banner');

    $('banner-close').addEventListener('click', () => {
        banner.style.display = 'none';
        document.body.classList.remove('has-banner');
        sessionStorage.setItem('appBannerDismissed', '1');
    });
})();

// ── Number Pad (mobile FAB) ──
// Floating action button that opens a keypad dialog for jumping to a hymn
// by number. Only visible on mobile (<769px). Mirrors the Android app's
// NumberPadDialog: keypad grid, live title preview, backspace, Go button.
(function() {
    const fab = $('numpad-fab');
    const overlay = $('numpad-overlay');
    const dialog = overlay.querySelector('.numpad-dialog');
    const inputEl = $('numpad-input');
    const preview = $('numpad-preview');
    const bksp = $('numpad-bksp');
    const goBtn = $('numpad-go');
    let numpadValue = '';

    function updateDisplay() {
        inputEl.textContent = numpadValue || '\u2014';
        inputEl.classList.toggle('empty', !numpadValue);
        bksp.classList.toggle('visible', numpadValue.length > 0);
        goBtn.classList.toggle('disabled', !numpadValue);
        goBtn.setAttribute('aria-disabled', String(!numpadValue));

        const num = parseInt(numpadValue);
        const hymn = num ? HYMNS.find(h => h.number === num) : null;
        if (hymn) {
            preview.textContent = hymn.title;
            preview.classList.remove('error');
        } else if (numpadValue) {
            preview.textContent = 'Hymn not found';
            preview.classList.add('error');
        } else {
            preview.textContent = '';
            preview.classList.remove('error');
        }
    }

    let numpadOpener = null;

    function openNumpad() {
        numpadValue = '';
        updateDisplay();
        overlay.classList.add('open');
        numpadOpener = document.activeElement;
        dialog.focus(); // visibility flips instantly with .open
    }

    function closeNumpad() {
        overlay.classList.remove('open');
        if (numpadOpener) { numpadOpener.focus(); numpadOpener = null; }
    }

    function tryGo() {
        const num = parseInt(numpadValue);
        if (!num) return;
        const hymn = HYMNS.find(h => h.number === num);
        if (!hymn) return;
        selectHymn(hymn);
        closeNumpad();
        if (typeof umami !== 'undefined') umami.track('numpad_go', { hymn: num });
    }

    fab.addEventListener('click', openNumpad);

    overlay.addEventListener('click', e => {
        if (e.target === overlay) closeNumpad();
    });

    $('numpad-cancel').addEventListener('click', closeNumpad);

    bksp.addEventListener('click', () => {
        if (numpadValue.length > 0) {
            numpadValue = numpadValue.slice(0, -1);
            updateDisplay();
        }
    });

    goBtn.addEventListener('click', tryGo);

    document.querySelectorAll('.numpad-key[data-key]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (numpadValue.length < 4) {
                numpadValue += btn.dataset.key;
                updateDisplay();
                if (navigator.vibrate) navigator.vibrate(8); // subtle keypad haptic (Android; iOS ignores)
            }
        });
    });

    // Keyboard support when dialog is open
    document.addEventListener('keydown', e => {
        if (!overlay.classList.contains('open')) return;
        if (e.key >= '0' && e.key <= '9' && numpadValue.length < 4) {
            numpadValue += e.key;
            updateDisplay();
        } else if (e.key === 'Backspace') {
            numpadValue = numpadValue.slice(0, -1);
            updateDisplay();
        } else if (e.key === 'Enter') {
            // Skip tryGo when a dialog button has focus — its own click handles it
            const onBtn = document.activeElement && document.activeElement.tagName === 'BUTTON' && overlay.contains(document.activeElement);
            if (!onBtn) tryGo();
        } else if (e.key === 'Escape') {
            closeNumpad();
        } else if (e.key === 'Tab') {
            // Keep Tab inside the dialog
            const focusables = [...overlay.querySelectorAll('button')].filter(b => getComputedStyle(b).visibility !== 'hidden');
            if (!focusables.length) return;
            const first = focusables[0], last = focusables[focusables.length - 1];
            if (!document.activeElement.closest('.numpad-dialog')) { e.preventDefault(); first.focus(); }
            else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });
})();
