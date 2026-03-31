let HYMNS = [];
let filtered = [];
let current = null;
let presBlocks = [];
let presIdx    = 0;
let presFz     = parseFloat(localStorage.getItem('presFz')) || 1.0;
let readFz     = parseFloat(localStorage.getItem('readFz')) || 1.0;

const $ = id => document.getElementById(id);

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
  <p style="max-width:320px;text-align:center;line-height:1.6">Could not load data store</p>`;
        return false;
    }
    return true;
}

// Normalise text — strips diacritics
function normalise(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/gi, '').toLowerCase();
}

// Pre-built search index — built once on load, reused on every keystroke
let searchIndex = [];

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

// ── Virtual list — only renders visible rows ──
const ROW_H = 62; // px per hymn row — must match CSS padding
let listScrollTop = 0;

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

function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

const debouncedSearch = debounce(syncSearch, 150);

$('search').addEventListener('input', () => {
    debouncedSearch($('search').value.trim());
});

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

function selectHymn(hymn) {
    current = hymn;
    document.querySelectorAll('.hymn-row').forEach(el => el.classList.toggle('active', parseInt(el.dataset.n) === hymn.number));
    renderHymn(hymn);
    $('pres-open').disabled = false;
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
    if (window.innerWidth < 769) closeSidebar();
    $('main').scrollTo({ top: 0, behavior: 'smooth' });
    localStorage.setItem('lastHymn', hymn.number);
    const url = new URL(location.href);
    url.searchParams.set('hymn', hymn.number);
    history.replaceState(null, '', url);
    if (typeof umami !== 'undefined') umami.track('hymn_' + hymn.number);
    scrollSidebarToActive();
}

function renderHymn(hymn) {
    $('empty').style.display = 'none';
    $('hymn-content').style.display = 'block';
    const view = $('hymn-view');
    view.classList.add('fading');
    setTimeout(() => {
        const refs = Object.entries(hymn.references || {}).map(([k,v]) => `<span class="ref-tag">${k} ${v}</span>`).join('');
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
  <span class="hymn-nav-center">${idx + 1} of ${HYMNS.length}</span>
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
        view.classList.remove('fading');
        // Move focus to hymn title on desktop for screen reader users
        if (window.innerWidth >= 769) {
            const title = document.getElementById('hymn-title');
            if (title) title.focus();
        }
    }, 80);
}

function applyReadFz() {
    $('hymn-view').querySelectorAll('.s-line').forEach(el => el.style.fontSize = (1.08 * readFz) + 'rem');
}

$('fs-up').addEventListener('click',   () => { readFz = Math.min(readFz + 0.12, 1.8); applyReadFz(); localStorage.setItem('readFz', readFz); });
$('fs-down').addEventListener('click', () => { readFz = Math.max(readFz - 0.12, 0.7); applyReadFz(); localStorage.setItem('readFz', readFz); });

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
        ? '— / ' + (presBlocks.length - 1)
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
function advance()  { if (presIdx <= presBlocks.length - 1) { presIdx++; renderPresBlock(); } }
function retreat()  { if (presIdx > 0) { presIdx--; renderPresBlock(); } }
$('p-exit').addEventListener('click', closePres);
$('pf-up').addEventListener('click',   () => { presFz = Math.min(presFz + 0.15, 2.5); applyPresFz(); localStorage.setItem('presFz', presFz); });
$('pf-down').addEventListener('click', () => { presFz = Math.max(presFz - 0.15, 0.4); applyPresFz(); localStorage.setItem('presFz', presFz); });
function presKey(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); advance(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); retreat(); }
    else if (e.key === 'Escape') closePres();
    else if (e.key === '+' || e.key === '=') { presFz = Math.min(presFz + 0.15, 2.5); applyPresFz(); localStorage.setItem('presFz', presFz); }
    else if (e.key === '-') { presFz = Math.max(presFz - 0.15, 0.4); applyPresFz(); localStorage.setItem('presFz', presFz); }
}
function closePres() {
    if (!$('pres').classList.contains('on')) return;
    $('pres').classList.remove('on');
    document.removeEventListener('keydown', presKey);
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
    if (history.state && history.state.presentation) history.back();
}

// Auto-scroll sidebar to keep active hymn visible (virtual list aware)
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

$('menu-btn').addEventListener('click', () => {
    $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
});
$('home-btn').addEventListener('click', goHome);
$('sb-overlay').addEventListener('click', closeSidebar);

function goHome() {
    current = null;
    $('hymn-content').style.display = 'none';
    $('empty').style.display = '';
    $('pres-open').disabled = true;
    $('search').value = '';
    $('empty-search').value = '';
    filtered = [...HYMNS];
    renderList();
    localStorage.removeItem('lastHymn');
    const url = new URL(location.href);
    url.searchParams.delete('hymn');
    history.replaceState(null, '', url);
    $('main').scrollTo({ top: 0, behavior: 'smooth' });
}

function openSidebar() {
    $('sidebar').classList.add('open');
    $('sb-overlay').classList.add('show');
    history.pushState({ sidebar: true }, '');
    setTimeout(() => $('search').focus(), 250);
}
function closeSidebar() {
    if (!$('sidebar').classList.contains('open')) return;
    $('sidebar').classList.remove('open');
    $('sb-overlay').classList.remove('show');
    if (history.state && history.state.sidebar) history.back();
}

window.addEventListener('popstate', e => {
    if ($('pres').classList.contains('on')) {
        closePres();
    } else if ($('sidebar').classList.contains('open')) {
        closeSidebar();
    }
});

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const canonicalBase = location.origin + '/';
document.getElementById('canonical-url').setAttribute('href', canonicalBase);
document.getElementById('og-url').setAttribute('content', canonicalBase);
document.addEventListener('DOMContentLoaded', () => {
    const hymView = document.getElementById('hymn-view');
    if (hymView) hymView.setAttribute('data-print-credit', 'SDA Hymnal Yoruba — ' + location.hostname);
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

// ── Theme toggle ──
const sunSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const moonSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function getEffectiveTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = $('theme-btn');
    if (btn) btn.innerHTML = theme === 'dark' ? sunSvg : moonSvg;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1A1840' : '#5B52C8');
}

applyTheme(getEffectiveTheme());

$('theme-btn').addEventListener('click', () => {
    const current = getEffectiveTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
    if (typeof umami !== 'undefined') umami.track('theme_' + next);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem('theme')) applyTheme(getEffectiveTheme());
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}
