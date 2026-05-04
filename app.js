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

/** Fetch hymn data from hymns.json. Returns false and shows error UI on failure. */
async function loadData() {
    try {
        const res = await fetch('hymns.json');
        if (!res.ok) throw new Error('not ok');
        HYMNS = await res.json();
    } catch(e) {
        $('loading').innerHTML = `
  <svg style="width:36px;height:36px;color:var(--load-spin)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/>
  </svg>
  <p style="max-width:320px;text-align:center;line-height:1.6">Could not load hymns. Check your connection and try again.</p>`;
        return false;
    }
    return true;
}

/** Strip diacritics and special chars for search comparison. Yoruba text uses combining marks that must be removed for accent-insensitive matching. */
function normalise(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/gi, '').toLowerCase();
}

// Pre-built search index - built once on load, reused on every keystroke
let searchIndex = [];

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

(async () => {
    const ok = await loadData();
    if (!ok) return;
    buildIndex();
    filtered = [...HYMNS];
    renderList();
    const cy = $('copy-year');
    if (cy) cy.textContent = new Date().getFullYear();
    $('loading').style.opacity = '0';
    setTimeout(() => $('loading').style.display = 'none', 400);

    // Restore from URL (?hymn=42), then localStorage, then first hymn on desktop
    const urlNum    = parseInt(new URLSearchParams(location.search).get('hymn'));
    const savedNum  = parseInt(localStorage.getItem('lastHymn'));
    const startNum  = urlNum || savedNum || null;
    const startHymn = startNum ? HYMNS.find(h => h.number === startNum) : null;

    if (urlNum && !startHymn) {
        $('empty').style.display = '';
        $('hymn-content').style.display = 'none';
        const emptyH2 = $('empty').querySelector('h2');
        const emptyP  = $('empty').querySelector('p');
        if (emptyH2) emptyH2.textContent = 'Hymn ' + urlNum + ' not found';
        if (emptyP)  { emptyP.textContent = 'This hymn number doesn\'t exist in the hymnal.'; emptyP.style.display = ''; }
        // Clear the bad URL
        const url = new URL(location.href);
        url.searchParams.delete('hymn');
        history.replaceState(null, '', url);
    } else if (startHymn) {
        selectHymn(startHymn);
    }
})();

// ── Virtual list - only renders visible rows ──
const ROW_H = 62; // px per hymn row - must match CSS padding
let listScrollTop = 0;

/** Render the sidebar hymn list using virtual scrolling. Only DOM nodes for visible rows (plus overscan buffer) are created. ROW_H (62px) must match CSS .hymn-row height (padding + content). */
function renderList() {
    const wrap = $('list-wrap');
    const total = filtered.length;
    const wrapH = wrap.clientHeight || 400;
    const overscan = 5; // extra rows above/below visible area

    const startIdx = Math.max(0, Math.floor(listScrollTop / ROW_H) - overscan);
    const endIdx   = Math.min(total, Math.ceil((listScrollTop + wrapH) / ROW_H) + overscan);

    // Spacers to maintain correct scroll height
    const topSpace    = startIdx * ROW_H;
    const bottomSpace = (total - endIdx) * ROW_H;

    const frag = document.createDocumentFragment();

    // Top spacer
    const top = document.createElement('div');
    top.style.height = topSpace + 'px';
    frag.appendChild(top);

    // Visible rows
    for (let i = startIdx; i < endIdx; i++) {
        const h = filtered[i];
        const div = document.createElement('div');
        div.className = 'hymn-row' + (current && current.number === h.number ? ' active' : '');
        div.dataset.n = h.number;
        div.setAttribute('role', 'option');
        div.setAttribute('aria-selected', current && current.number === h.number ? 'true' : 'false');
        div.innerHTML = `<div class="hnum" aria-hidden="true">${h.number}</div><div class="htitles"><div class="hyo" lang="yo">${escHtml(h.title)}</div><div class="hsub" lang="en">${escHtml(h.english_title)}</div></div>`;
        div.addEventListener('click', () => selectHymn(h));
        frag.appendChild(div);
    }

    // Bottom spacer
    const bot = document.createElement('div');
    bot.style.height = bottomSpace + 'px';
    frag.appendChild(bot);

    wrap.innerHTML = '';
    if (total === 0) {
        const msg = document.createElement('div');
        msg.className = 'no-results';
        msg.textContent = 'No hymns found';
        wrap.appendChild(msg);
    } else {
        wrap.appendChild(frag);
    }
    $('list-count').textContent = total === 0 ? 'No hymns found' : total + (total === 1 ? ' hymn' : ' hymns');
}

// Re-render on scroll to show newly visible rows
$('list-wrap').addEventListener('scroll', () => {
    listScrollTop = $('list-wrap').scrollTop;
    renderList();
}, { passive: true });

/** Create a debounced version of fn that delays execution by delay ms. */
function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

const debouncedSearch = debounce(syncSearch, 150);

let searchHighlight = -1;

$('search').addEventListener('input', () => {
    searchHighlight = -1;
    debouncedSearch($('search').value.trim());
});

$('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const target = searchHighlight >= 0 && searchHighlight < filtered.length
            ? filtered[searchHighlight] : filtered[0];
        if (target) { selectHymn(target); $('search').blur(); }
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
    // Scroll the highlighted row into view
    const rowTop = searchHighlight * ROW_H;
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
    if (!normalised) {
        filtered = [...HYMNS];
    } else {
        const scored = [];
        for (const entry of searchIndex) {
            let score = 0;
            // Exact hymn number match
            if (entry.number === normalised) score = 100;
            // Number starts with query
            else if (entry.number.startsWith(normalised) && /^\d+$/.test(normalised)) score = 90;
            // Yoruba title match
            if (entry.title.includes(normalised)) score = Math.max(score, 80);
            // English title match
            if (entry.englishTitle.includes(normalised)) score = Math.max(score, 70);
            // Reference match (e.g. "sdah 16", "nah 2")
            if (entry.refs.includes(normalised)) score = Math.max(score, 60);
            // Lyrics match
            if (entry.lyrics.includes(normalised)) score = Math.max(score, 40);

            if (score > 0) scored.push({ hymn: entry.hymn, score });
        }
        scored.sort((a, b) => b.score - a.score || a.hymn.number - b.hymn.number);
        filtered = scored.map(s => s.hymn);
    }
    if (normalised && typeof umami !== 'undefined') {
        clearTimeout(syncSearch._t);
        syncSearch._t = setTimeout(() => umami.track('search_' + q.substring(0, 50)), 1000);
    }
    listScrollTop = 0;
    $('list-wrap').scrollTop = 0;
    renderList();
}

let fromPopstate = false;

/** Select a hymn: update state, render content, update URL, close sidebar on mobile. */
function selectHymn(hymn) {
    current = hymn;
    document.querySelectorAll('.hymn-row').forEach(el => el.classList.toggle('active', parseInt(el.dataset.n) === hymn.number));
    renderHymn(hymn);
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
    const url = new URL(location.href);
    url.searchParams.set('hymn', hymn.number);
    if (fromPopstate) {
        fromPopstate = false;
    } else {
        history.pushState({ hymn: hymn.number }, '', url);
    }
    if (typeof umami !== 'undefined') umami.track('hymn_' + hymn.number);
    scrollSidebarToActive();
}

/** Render hymn content into #hymn-view. First render is synchronous to avoid a flash of empty content; subsequent renders use an 80ms fade transition. */
let initialLoad = true;
function renderHymn(hymn) {
    $('empty').style.display = 'none';
    $('hymn-content').style.display = 'block';
    $('numpad-fab').classList.add('active');
    document.querySelector('.scroll-spacer').style.height = '4rem';
    const view = $('hymn-view');
    const doFade = !initialLoad;
    if (doFade) view.classList.add('fading');
    const render = () => {
        const refs = Object.entries(hymn.references || {}).map(([k,v]) => `<span class="ref-tag">${escHtml(String(k))} ${escHtml(String(v))}</span>`).join('');
        const idx = HYMNS.findIndex(h => h.number === hymn.number);
        const hasPrev = idx > 0;
        const hasNext = idx < HYMNS.length - 1;
        let html = '';
        hymn.lyrics.forEach(block => {
            const isChorus      = block.type === 'chorus';
            const isCallResponse = block.type === 'call_response';
            let label, inner;

            if (isCallResponse) {
                label = 'Call &amp; Response ' + block.index;
                const rows = block.lines.map(l => `
                <div class="cr-line ${l.part}">
                    <span class="cr-part">${l.part === 'leader' ? 'Leader/Lile' : 'All/Egbe'}</span>
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
            html += `<div class="stanza"><div class="s-label">${label}</div>${inner}</div>`;
        });
        $('hymn-view').innerHTML = `
<div class="hymn-nav">
  <button class="hymn-nav-btn" id="hymn-prev" ${hasPrev ? '' : 'disabled'} aria-label="Previous hymn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    <span class="nav-label">Previous</span>
  </button>
  <div class="hymn-nav-center">
    <span>${idx + 1} of ${HYMNS.length}</span>
    <button class="share-icon" id="share-btn" aria-label="Share hymn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
  </div>
  <button class="hymn-nav-btn" id="hymn-next" ${hasNext ? '' : 'disabled'} aria-label="Next hymn">
    <span class="nav-label">Next</span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  </button>
</div>
<div class="hymn-hdr">
  <div class="h-badge" aria-label="Hymn number">Hymn ${hymn.number}</div>
  <h1 class="h-title" lang="yo" tabindex="-1" id="hymn-title">${escHtml(hymn.title)}</h1>
  <div class="h-en" lang="en">${escHtml(hymn.english_title)}</div>
  ${refs ? `<div class="h-refs">${refs}</div>` : ''}
</div>
${html}`;
        applyReadFz();
        const prevBtn = document.getElementById('hymn-prev');
        const nextBtn = document.getElementById('hymn-next');
        if (prevBtn) prevBtn.addEventListener('click', () => selectHymn(HYMNS[idx - 1]));
        if (nextBtn) nextBtn.addEventListener('click', () => selectHymn(HYMNS[idx + 1]));
        const shareBtn = document.getElementById('share-btn');
        if (shareBtn) shareBtn.addEventListener('click', () => shareHymn(hymn));
        if (doFade) view.classList.remove('fading');
        // Move focus to hymn title on desktop for screen reader users
        if (window.innerWidth >= 769) {
            const title = document.getElementById('hymn-title');
            if (title) title.focus();
        }
    };
    if (doFade) setTimeout(render, 80); else { render(); initialLoad = false; }
}

/** Share hymn via Web Share API (mobile) or copy URL to clipboard (desktop). */
function shareHymn(hymn) {
    const url = new URL(location.href);
    url.searchParams.set('hymn', hymn.number);
    const shareData = {
        title: `Hymn ${hymn.number} – ${hymn.title}`,
        text: `${hymn.title} (${hymn.english_title})`,
        url: url.toString()
    };
    if (navigator.share) {
        navigator.share(shareData).catch(() => {});
    } else {
        navigator.clipboard.writeText(url.toString()).then(() => {
            const btn = $('share-btn');
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1500);
        });
    }
    if (typeof umami !== 'undefined') umami.track('share_' + hymn.number);
}

// Reading font size steps: small (1.0x), medium (1.2x), large (1.45x)
const FZ_SIZES = [
    { label: 'A', value: 1.0 },
    { label: 'A', value: 1.2 },
    { label: 'A', value: 1.45 }
];
let fzIdx = FZ_SIZES.findIndex(s => s.value === readFz);
if (fzIdx === -1) fzIdx = 0;

/** Apply current reading font size to all lyric lines. Base size is 1.08rem. */
function applyReadFz() {
    $('hymn-view').querySelectorAll('.s-line').forEach(el => el.style.fontSize = (1.08 * readFz) + 'rem');
}

$('fs-toggle').addEventListener('click', () => {
    fzIdx = (fzIdx + 1) % FZ_SIZES.length;
    readFz = FZ_SIZES[fzIdx].value;
    applyReadFz();
    localStorage.setItem('readFz', readFz);
});


$('pres-open').addEventListener('click', () => {
    if (!current) return;
    if (typeof umami !== 'undefined') umami.track('presented_' + current.number);
    $('pf-num').textContent  = 'Hymn ' + current.number;
    $('pf-name').textContent = current.title;
    presIdx = 0;
    $('pres').classList.add('on');
    history.pushState({ presentation: true }, '');
    renderPresBlock();
    document.addEventListener('keydown', presKey);
    const el = $('pres');
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
});

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
        ? '- / ' + (presBlocks.length - 1)
        : presIdx === 0
            ? 'Title'
            : presIdx + ' / ' + (presBlocks.length - 1);

    if (isEnd) return;

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
            label.textContent = part === 'leader' ? 'Leader / Lile' : 'All / Egbe';
            span.appendChild(label);
            span.appendChild(document.createTextNode(text));
            span.style.animationDelay = (i * 0.08) + 's';
            linesEl.appendChild(span);
            linesEl.appendChild(document.createElement('br'));
            return;
        } else {
            span.className = 'pl ' + (isChorus ? 'chorus-line' : 'verse-line');
        }
        span.textContent = text;
        span.style.animationDelay = (i * 0.08) + 's';
        linesEl.appendChild(span);
        linesEl.appendChild(document.createElement('br'));
    });

    applyPresFz();
}

/** Scale presentation text based on viewport width and user font size preference. Base size ranges 18-52px proportional to screen width. */
function applyPresFz() {
    const base = Math.max(18, Math.min(window.innerWidth * 0.038, 52));
    $('pres-lines').querySelectorAll('.pl').forEach(el => {
        if (el.classList.contains('title-main'))     el.style.fontSize = (base * presFz * 1.5) + 'px';
        else if (el.classList.contains('title-sub')) el.style.fontSize = (base * presFz * 0.75) + 'px';
        else                                         el.style.fontSize = (base * presFz) + 'px';
    });
}

$('p-next').addEventListener('click', advance);
$('p-prev').addEventListener('click', retreat);
$('pres-stage').addEventListener('click', e => { if (!e.target.closest('button') && !e.target.closest('#pres-foot')) advance(); });
/** Move to next/previous presentation slide. */
function advance()  { if (presIdx <= presBlocks.length - 1) { presIdx++; renderPresBlock(); } }
function retreat()  { if (presIdx > 0) { presIdx--; renderPresBlock(); } }
$('p-exit').addEventListener('click', closePres);
$('pf-up').addEventListener('click',   () => { presFz = Math.min(presFz + 0.15, 2.5); applyPresFz(); localStorage.setItem('presFz', presFz); });
$('pf-down').addEventListener('click', () => { presFz = Math.max(presFz - 0.15, 0.4); applyPresFz(); localStorage.setItem('presFz', presFz); });
/** Keyboard handler for presentation mode. Arrow keys and space navigate slides; +/- adjust font; Escape exits. */
function presKey(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); advance(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); retreat(); }
    else if (e.key === 'Escape') closePres();
    else if (e.key === '+' || e.key === '=') { presFz = Math.min(presFz + 0.15, 2.5); applyPresFz(); localStorage.setItem('presFz', presFz); }
    else if (e.key === '-') { presFz = Math.max(presFz - 0.15, 0.4); applyPresFz(); localStorage.setItem('presFz', presFz); }
}
/** Exit presentation mode: hide overlay, remove keyboard listener, exit fullscreen, update history. */
function closePres(fromPopstate) {
    if (!$('pres').classList.contains('on')) return;
    $('pres').classList.remove('on');
    document.removeEventListener('keydown', presKey);
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    if (!fromPopstate && history.state && history.state.presentation) history.back();
}

/** Scroll the sidebar so the active hymn row is visible. Accounts for virtual list row positioning. */
function scrollSidebarToActive() {
    if (!current) return;
    const idx = filtered.findIndex(h => h.number === current.number);
    if (idx === -1) return;
    const wrap = $('list-wrap');
    const rowTop    = idx * ROW_H;
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

// ── Swipe navigation ──
// Horizontal swipe (>60px) on #main navigates between adjacent hymns.
// Vertical scroll or multi-touch is ignored.
let mainSwipeX = 0, mainSwipeY = 0, mainSwipeOk = false;
$('main').addEventListener('touchstart', e => {
    mainSwipeOk = e.touches.length === 1;
    mainSwipeX = e.touches[0].clientX;
    mainSwipeY = e.touches[0].clientY;
}, { passive: true });
$('main').addEventListener('touchmove', e => {
    if (e.touches.length > 1) mainSwipeOk = false;
}, { passive: true });
$('main').addEventListener('touchend', e => {
    if (!current || !mainSwipeOk) return;
    const dx = e.changedTouches[0].clientX - mainSwipeX;
    const dy = e.changedTouches[0].clientY - mainSwipeY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    const idx = HYMNS.findIndex(h => h.number === current.number);
    if (dx < -60 && idx < HYMNS.length - 1) selectHymn(HYMNS[idx + 1]);
    else if (dx > 60 && idx > 0) selectHymn(HYMNS[idx - 1]);
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
    $('numpad-fab').classList.remove('active');
    document.querySelector('.scroll-spacer').style.height = '0';
    $('pres-open').disabled = true;
    $('fs-toggle').style.display = 'none';
    $('search').value = '';
    $('empty-search').value = '';
    filtered = [...HYMNS];
    renderList();
    localStorage.removeItem('lastHymn');
    if (fromPopstate) {
        fromPopstate = false;
    } else {
        const url = new URL(location.href);
        url.searchParams.delete('hymn');
        history.pushState(null, '', url);
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
    const num = parseInt(new URLSearchParams(location.search).get('hymn'));
    const hymn = num ? HYMNS.find(h => h.number === num) : null;
    fromPopstate = true;
    if (hymn) {
        selectHymn(hymn);
    } else {
        goHome();
    }
});

/** Escape HTML special characters to prevent XSS in innerHTML. */
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const canonicalBase = location.origin + '/';
document.getElementById('canonical-url').setAttribute('href', canonicalBase);
document.getElementById('og-url').setAttribute('content', canonicalBase);
document.addEventListener('DOMContentLoaded', () => {
    const hymView = document.getElementById('hymn-view');
    if (hymView) hymView.setAttribute('data-print-credit', 'SDA Hymnal Yorùbá - ' + location.hostname);
});

document.addEventListener('keydown', e => {
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
    applyTheme(next);
    if (typeof umami !== 'undefined') umami.track('theme_' + next);
}

['theme-btn', 'theme-btn-hdr'].forEach(id => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', cycleTheme);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemeMode() === 'system') applyTheme('system');
});

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

    function openNumpad() {
        numpadValue = '';
        updateDisplay();
        overlay.classList.add('open');
    }

    function closeNumpad() {
        overlay.classList.remove('open');
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
            tryGo();
        } else if (e.key === 'Escape') {
            closeNumpad();
        }
    });
})();
