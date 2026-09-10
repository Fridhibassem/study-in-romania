#!/usr/bin/env node
/**
 * Build script — Study in Romania
 *
 * Produces dist/ with content-hashed asset filenames so that
 * Cache-Control: immutable is actually TRUE for everything it is applied to.
 *
 * Runs at BUILD time only. No JavaScript is emitted into the site.
 *
 * Order matters: fonts are hashed first (they are leaf nodes), then the CSS
 * that references them is rewritten and only then hashed, then index.html is
 * rewritten last. Hashing a file before its dependencies would bake in a
 * stale reference and produce a hash that no longer matches its own content.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const TMP = path.join(ROOT, '.build-tmp');

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

const hashedName = (file, buf) => {
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  return `${base}.${hash(buf)}${ext}`;
};

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

// ---------------------------------------------------------------- 1. Styles
console.log('→ preparing local styles');
rmrf(TMP); mkdirp(TMP);
fs.copyFileSync(path.join(ROOT, 'src/input.css'), path.join(TMP, 'styles.css'));

// ---------------------------------------------------------------- 2. Layout
rmrf(DIST);
mkdirp(path.join(DIST, 'assets/css'));
mkdirp(path.join(DIST, 'assets/fonts'));
mkdirp(path.join(DIST, 'assets/webfonts'));
mkdirp(path.join(DIST, 'assets/images'));

// map: original relative path (from dist root) -> hashed relative path
const manifest = new Map();

// ------------------------------------------------- 3. Hash fonts (leaf nodes)
console.log('→ hashing font binaries');
for (const dir of ['assets/fonts', 'assets/webfonts']) {
  const srcDir = path.join(ROOT, dir);
  for (const file of fs.readdirSync(srcDir).sort()) {
    if (!file.endsWith('.woff2')) continue;
    const buf = fs.readFileSync(path.join(srcDir, file));
    const out = hashedName(file, buf);
    fs.writeFileSync(path.join(DIST, dir, out), buf);
    manifest.set(`${dir}/${file}`, `${dir}/${out}`);
  }
}

// ------------------------------------------------ 4. Hash local images (leaf nodes)
console.log('→ hashing local images');
const imageDir = path.join(ROOT, 'assets/images');
if (fs.existsSync(imageDir)) {
  for (const file of fs.readdirSync(imageDir).sort()) {
    if (!/\.(?:webp|png|jpe?g|svg)$/i.test(file)) continue;
    const buf = fs.readFileSync(path.join(imageDir, file));
    const out = hashedName(file, buf);
    fs.writeFileSync(path.join(DIST, 'assets/images', out), buf);
    manifest.set(`assets/images/${file}`, `assets/images/${out}`);
  }
}

// ------------------------------------- 5. Rewrite CSS font refs, then hash CSS
console.log('→ rewriting CSS references and hashing stylesheets');
const cssFiles = [
  { from: path.join(TMP, 'styles.css'), name: 'styles.css' },
  { from: path.join(ROOT, 'assets/css/fonts.css'), name: 'fonts.css' },
  { from: path.join(ROOT, 'assets/css/fontawesome.min.css'), name: 'fontawesome.min.css' },
  { from: path.join(ROOT, 'assets/css/solid.min.css'), name: 'solid.min.css' },
  { from: path.join(ROOT, 'assets/css/brands.min.css'), name: 'brands.min.css' },
];

for (const { from, name } of cssFiles) {
  let css = fs.readFileSync(from, 'utf8');

  // CSS lives at assets/css/, so its url() refs are ../fonts/x or ../webfonts/x
  for (const [orig, hashedPath] of manifest) {
    const origFile = path.basename(orig);
    const dir = path.dirname(orig).split('/').pop();   // fonts | webfonts
    const newFile = path.basename(hashedPath);
    css = css.split(`../${dir}/${origFile}`).join(`../${dir}/${newFile}`);
  }

  const buf = Buffer.from(css, 'utf8');
  const out = hashedName(name, buf);
  fs.writeFileSync(path.join(DIST, 'assets/css', out), buf);
  manifest.set(`assets/css/${name}`, `assets/css/${out}`);
}

// -------------------------------------------------------- 6. Rewrite the HTML
console.log('→ rewriting index.html');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const [orig, hashedPath] of manifest) {
  html = html.split(`./${orig}`).join(`./${hashedPath}`);
}
fs.writeFileSync(path.join(DIST, 'index.html'), html);

// ------------------------------------------------------------- 7. Sanity gate
const leftovers = [...html.matchAll(/\.\/(assets\/[^"']+)/g)].map((m) => m[1]);
const unhashed = leftovers.filter((p) => !/\.[0-9a-f]{10}\.[a-z0-9]+$/.test(p));
if (unhashed.length) {
  console.error('✗ BUILD FAILED — unhashed asset references remain:', unhashed);
  process.exit(1);
}

rmrf(TMP);
console.log(`✓ build complete — ${manifest.size} assets hashed → dist/`);
