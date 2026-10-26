const { buildSync } = require('esbuild');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const WATCH = process.argv.includes('--watch');
const SITE = 'https://sdahymnalyoruba.com';

const SOURCE_FILES = ['app.js', 'styles.css', 'index.html', 'privacy.html', 'hymns.json', 'sw.js', 'manifest.json', 'robots.txt'];

// ── SEO helpers ──

function slugify(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function hymnPath(h) { return '/hymn/' + h.number + '-' + slugify(h.title); }
function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const CR_PART_LABELS = { leader: 'Leader/Lile', congregation: 'All/Egbe', women: 'Women/Awọn obinrin', men: 'Men/Awọn ọkùnrin' };
function crPartLabel(part) { return CR_PART_LABELS[part] || (part ? part.charAt(0).toUpperCase() + part.slice(1) : 'All/Egbe'); }
const WIDE_LINES = 9; // blocks with >= this many lines span the full width; must stay in sync with app.js
let ALL_HYMNS = []; // assigned in build(); renderLyricsHTML reads it for prev/next nav hrefs

/** Render a hymn's lyrics to static HTML mirroring app.js renderHymn(), so crawlers and
 *  no-JS visitors get the full content. The SPA overwrites #hymn-view on hydrate. */
function renderLyricsHTML(hymn, idx, total) {
    const refs = Object.entries(hymn.references || {})
        .map(([k, v]) => `<span class="ref-tag">${escHtml(k)} ${escHtml(v)}</span>`).join('');
    const prev = idx > 0 ? hymnPath(ALL_HYMNS[idx - 1]) : null;
    const next = idx < total - 1 ? hymnPath(ALL_HYMNS[idx + 1]) : null;
    let html = `<div class="hymn-hdr">
  <div class="h-num"><span class="sr-only">Hymn </span>${hymn.number}</div>
  <h1 class="h-title" lang="yo" tabindex="-1" id="hymn-title">${escHtml(hymn.title)}</h1>
  ${hymn.english_title ? `<div class="h-en" lang="en">${escHtml(hymn.english_title)}</div>` : ''}
  ${refs ? `<div class="h-refs">${refs}</div>` : ''}
</div>`;
    html += '<div class="lyrics" data-blocks="' + hymn.lyrics.length + '">';
    let firstChorus = null;   // mirrors app.js hymnHTML: collapse identical repeated choruses
    hymn.lyrics.forEach(block => {
        const wide = block.type === 'call_response' || block.lines.length >= WIDE_LINES;
        if (block.type === 'chorus') {
            const key = JSON.stringify(block.lines);
            if (firstChorus === null) firstChorus = key;
            else if (key === firstChorus) {
                html += '<div class="stanza chorus-ref-block"><div class="s-label">Chorus</div><div class="chorus-ref">Repeat the chorus</div></div>';
                return;
            }
        }
        if (block.type === 'call_response') {
            const rows = block.lines.map(l =>
                `<div class="cr-line ${l.part}"><span class="cr-part">${escHtml(crPartLabel(l.part))}</span><span class="cr-text">${escHtml(l.text)}</span></div>`).join('');
            html += `<div class="stanza${wide ? ' wide' : ''}"><div class="s-label">Call &amp; Response ${block.index}</div><div class="cr-block">${rows}</div></div>`;
        } else {
            const isChorus = block.type === 'chorus';
            const label = isChorus ? 'Chorus' : 'Verse ' + block.index;
            const lines = block.lines.map(l => `<span class="s-line">${escHtml(l)}</span>`).join('');
            const inner = isChorus ? `<div class="chorus-block">${lines}</div>` : `<div class="verse-block">${lines}</div>`;
            html += `<div class="stanza${wide ? ' wide' : ''}"><div class="s-label">${label}</div>${inner}</div>`;
        }
    });
    html += '</div>';
    // Nav goes after the content so the page opens on the hymn itself (matches the design)
    html += `<div class="hymn-nav">
  <a class="hymn-nav-btn"${prev ? ` href="${prev}"` : ''} aria-label="Previous hymn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg><span class="nav-label">Previous</span></a>
  <div class="hymn-nav-center"><span>${idx + 1} of ${total}</span></div>
  <a class="hymn-nav-btn"${next ? ` href="${next}"` : ''} aria-label="Next hymn"><span class="nav-label">Next</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></a>
</div>`;
    return html;
}

function mustReplace(html, find, repl) {
    if (!html.includes(find)) throw new Error('buildHymnPage: template anchor missing -> ' + find);
    return html.replace(find, repl);
}

/** Produce a full prerendered HTML document for a hymn from the index.html template. */
function buildHymnPage(template, hymn, idx, total) {
    const url = SITE + hymnPath(hymn);
    const title = `Hymn ${hymn.number} – ${hymn.title} (${hymn.english_title}) | SDA Hymnal Yorùbá`;
    const desc = `Hymn ${hymn.number} “${hymn.title}” (${hymn.english_title}) — read the full Yorùbá lyrics from the Seventh-day Adventist hymnal.`;
    const eTitle = escHtml(title), eDesc = escHtml(desc);
    const ld = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        name: hymn.title,
        alternateName: hymn.english_title,
        headline: `Hymn ${hymn.number}: ${hymn.title}`,
        inLanguage: 'yo',
        genre: 'Hymn',
        url,
        isPartOf: { '@type': 'Book', name: 'SDA Hymnal Yorùbá', inLanguage: 'yo' },
        position: hymn.number
    });
    let html = template;
    html = mustReplace(html, '<title>SDA Hymnal Yorùbá</title>', `<title>${eTitle}</title>`);
    html = mustReplace(html,
            '<meta name="description" content="SDA Hymnal Yorùbá - a complete Yorùbá hymnal for Seventh-day Adventist worship, study and church projection. Browse, search and present over 620 hymns.">',
            `<meta name="description" content="${eDesc}">`);
    html = mustReplace(html,
            '<link rel="canonical" id="canonical-url" href="https://sdahymnalyoruba.com/">',
            `<link rel="canonical" id="canonical-url" href="${url}">`);
    html = mustReplace(html,
            '<meta property="og:url" id="og-url" content="https://sdahymnalyoruba.com/">',
            `<meta property="og:url" id="og-url" content="${url}">`);
    html = mustReplace(html,
            '<meta property="og:title" content="SDA Hymnal Yorùbá">',
            `<meta property="og:title" content="${eTitle}">`);
    html = mustReplace(html,
            '<meta property="og:description" content="A complete Yorùbá hymnal for Seventh-day Adventist worship, study and church projection. Search hymns by title, number or lyrics.">',
            `<meta property="og:description" content="${eDesc}">`);
    html = mustReplace(html,
            '<meta name="twitter:title" content="SDA Hymnal Yorùbá">',
            `<meta name="twitter:title" content="${eTitle}">`);
    html = mustReplace(html,
            '<meta name="twitter:description" content="A complete Yorùbá hymnal for Seventh-day Adventist worship, study and church projection. Search hymns by title, number or lyrics.">',
            `<meta name="twitter:description" content="${eDesc}">`);
    html = mustReplace(html, '</head>', `    <script type="application/ld+json">${ld}</script>\n</head>`);
    html = mustReplace(html, '<div id="empty">', '<div id="empty" style="display:none">');
    html = mustReplace(html, '<div id="hymn-content">', '<div id="hymn-content" style="display:block">');
    html = mustReplace(html, '<div id="loading"', '<div id="loading" style="display:none"');
    // data-print-credit is baked in so the printed sheet has a credit line even without JS
    // (app.js overwrites it with the real hostname on hydration)
    html = mustReplace(html, '<div id="hymn-view"></div>',
        `<div id="hymn-view" data-print-credit="SDA Hymnal Yorùbá - sdahymnalyoruba.com">${renderLyricsHTML(hymn, idx, total)}</div>`);
    return html;
}

/** Build sitemap.xml from the hymn list using clean URLs. */
function generateSitemap(hymns) {
    const urls = [
        { loc: SITE + '/', changefreq: 'monthly', priority: '1.0' },
        { loc: SITE + '/privacy', changefreq: 'yearly', priority: '0.3' },
        ...hymns.map(h => ({ loc: SITE + hymnPath(h), changefreq: 'yearly', priority: '0.7' }))
    ];
    const body = urls.map(u =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function build() {
    fs.mkdirSync(DIST, { recursive: true });

    // Minify JS
    buildSync({
        entryPoints: ['app.js'],
        outfile: 'dist/app.js',
        minify: true,
        target: ['es2020'],
    });

    // Minify CSS
    buildSync({
        entryPoints: ['styles.css'],
        outfile: 'dist/styles.css',
        minify: true,
    });

    // Minify JSON
    if (fs.existsSync('hymns.json')) {
        const data = JSON.parse(fs.readFileSync('hymns.json', 'utf8'));
        fs.writeFileSync(path.join(DIST, 'hymns.json'), JSON.stringify(data));
    }

    // Generate content hash from built assets for cache busting
    const hash = crypto.createHash('md5');
    for (const file of ['dist/app.js', 'dist/styles.css', 'dist/hymns.json']) {
        if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
    }
    const buildHash = hash.digest('hex').substring(0, 8);

    // Inject build hash into sw.js and copy
    const sw = fs.readFileSync('sw.js', 'utf8').replace('__BUILD_HASH__', buildHash);
    fs.writeFileSync(path.join(DIST, 'sw.js'), sw);

    // Copy remaining static files
    for (const file of ['index.html', 'privacy.html', 'manifest.json', 'robots.txt']) {
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, path.join(DIST, file));
        }
    }

    // Copy self-hosted fonts
    const fontsSrc = path.join(__dirname, 'fonts');
    if (fs.existsSync(fontsSrc)) {
        const fontsDst = path.join(DIST, 'fonts');
        fs.mkdirSync(fontsDst, { recursive: true });
        for (const f of fs.readdirSync(fontsSrc)) {
            fs.copyFileSync(path.join(fontsSrc, f), path.join(fontsDst, f));
        }
    }

    // Font subset guard: the self-hosted woff2 files contain only the glyphs listed in
    // fonts/charset.txt. A hymn introducing any other character would render as tofu, so fail
    // the build loudly instead — the same reasoning as mustReplace for the prerender anchors.
    const charsetFile = path.join(fontsSrc, 'charset.txt');
    if (fs.existsSync(charsetFile) && fs.existsSync('hymns.json')) {
        const allowed = new Set(fs.readFileSync(charsetFile, 'utf8'));
        const missing = new Set();
        for (const h of JSON.parse(fs.readFileSync('hymns.json', 'utf8'))) {
            const text = [
                h.title, h.english_title,
                ...(h.lyrics || []).flatMap(b => b.lines.map(l => (typeof l === 'string' ? l : l.text))),
                ...Object.entries(h.references || {}).flat()
            ].filter(Boolean).join('');
            for (const ch of text) if (!allowed.has(ch)) missing.add(ch);
        }
        if (missing.size) {
            throw new Error('hymns.json uses characters missing from the font subset: ' +
                [...missing].map(c => `"${c}" U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(', ') +
                ' — regenerate fonts/ so the new glyphs are included.');
        }
    }

    // Copy .well-known (Android App Links verification)
    const wellKnownSrc = path.join(__dirname, '.well-known', 'assetlinks.json');
    if (fs.existsSync(wellKnownSrc)) {
        const wellKnownDst = path.join(DIST, '.well-known');
        fs.mkdirSync(wellKnownDst, { recursive: true });
        fs.copyFileSync(wellKnownSrc, path.join(wellKnownDst, 'assetlinks.json'));
    }

    // Prerender one static page per hymn (/hymn/<n>-<slug>/index.html) with baked
    // content + per-hymn meta/canonical/structured data, and regenerate the sitemap.
    let hymnPages = 0;
    if (fs.existsSync('hymns.json')) {
        const hymns = JSON.parse(fs.readFileSync('hymns.json', 'utf8'));
        const template = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
        ALL_HYMNS = hymns;
        for (const [idx, hymn] of hymns.entries()) {
            const dir = path.join(DIST, 'hymn', hymn.number + '-' + slugify(hymn.title));
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'index.html'), buildHymnPage(template, hymn, idx, hymns.length));
            hymnPages++;
        }
        fs.writeFileSync(path.join(DIST, 'sitemap.xml'), generateSitemap(hymns));
    }

    // Report
    const jsOrig = fs.statSync('app.js').size;
    const jsMin = fs.statSync('dist/app.js').size;
    const cssOrig = fs.statSync('styles.css').size;
    const cssMin = fs.statSync('dist/styles.css').size;
    const jsonOrig = fs.statSync('hymns.json').size;
    const jsonMin = fs.statSync('dist/hymns.json').size;

    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] build ${buildHash} | app.js: ${(jsOrig / 1024).toFixed(1)}KB → ${(jsMin / 1024).toFixed(1)}KB (${Math.round((1 - jsMin / jsOrig) * 100)}%) | styles.css: ${(cssOrig / 1024).toFixed(1)}KB → ${(cssMin / 1024).toFixed(1)}KB (${Math.round((1 - cssMin / cssOrig) * 100)}%) | hymns.json: ${(jsonOrig / 1024).toFixed(1)}KB → ${(jsonMin / 1024).toFixed(1)}KB (${Math.round((1 - jsonMin / jsonOrig) * 100)}%) | prerendered: ${hymnPages} hymn pages`);
}

// Initial build
build();

if (WATCH) {
    console.log('Watching for changes...');
    for (const file of SOURCE_FILES) {
        if (fs.existsSync(file)) {
            fs.watchFile(file, { interval: 300 }, () => {
                try { build(); } catch (e) { console.error('Build error:', e.message); }
            });
        }
    }
}
