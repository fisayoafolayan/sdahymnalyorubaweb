const { buildSync } = require('esbuild');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const WATCH = process.argv.includes('--watch');

const SOURCE_FILES = ['app.js', 'styles.css', 'index.html', 'privacy.html', 'hymns.json', 'sw.js', 'manifest.json', 'sitemap.xml'];

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
    for (const file of ['index.html', 'privacy.html', 'manifest.json', 'sitemap.xml']) {
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, path.join(DIST, file));
        }
    }

    // Copy .well-known (Android App Links verification)
    const wellKnownSrc = path.join(__dirname, '.well-known', 'assetlinks.json');
    if (fs.existsSync(wellKnownSrc)) {
        const wellKnownDst = path.join(DIST, '.well-known');
        fs.mkdirSync(wellKnownDst, { recursive: true });
        fs.copyFileSync(wellKnownSrc, path.join(wellKnownDst, 'assetlinks.json'));
    }

    // Report
    const jsOrig = fs.statSync('app.js').size;
    const jsMin = fs.statSync('dist/app.js').size;
    const cssOrig = fs.statSync('styles.css').size;
    const cssMin = fs.statSync('dist/styles.css').size;
    const jsonOrig = fs.statSync('hymns.json').size;
    const jsonMin = fs.statSync('dist/hymns.json').size;

    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] build ${buildHash} | app.js: ${(jsOrig / 1024).toFixed(1)}KB → ${(jsMin / 1024).toFixed(1)}KB (${Math.round((1 - jsMin / jsOrig) * 100)}%) | styles.css: ${(cssOrig / 1024).toFixed(1)}KB → ${(cssMin / 1024).toFixed(1)}KB (${Math.round((1 - cssMin / cssOrig) * 100)}%) | hymns.json: ${(jsonOrig / 1024).toFixed(1)}KB → ${(jsonMin / 1024).toFixed(1)}KB (${Math.round((1 - jsonMin / jsonOrig) * 100)}%)`);
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
