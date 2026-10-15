'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {report, coverageSummary} = require('../scripts/render-report.cjs');
const {installReadOnlyGuard, launchBrowser} = require('../scripts/lib.cjs');
const root = path.resolve(__dirname, '..');

async function execute(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], {cwd: root});
    let stdout = '', stderr = '';
    child.stdout.on('data', data => {stdout += data;}); child.stderr.on('data', data => {stderr += data;});
    child.on('error', reject); child.on('close', code => resolve({code, stdout, stderr}));
  });
}

test('real browser evidence, width order, raw URLs, fields and read-only boundary', {timeout: 120000}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'site-audit-test-'));
  const hits = {post: 0, cart: 0, autosave: 0}; let origin;
  const png = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ2kAAAAASUVORK5CYII=', 'base64'), Buffer.alloc(310000)]);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    if (req.method === 'POST') hits.post++;
    if (pathname === '/cart/add/') hits.cart++;
    if (pathname === '/autosave') hits.autosave++;
    if (['/large.png', '/large-copy.png'].includes(pathname)) {res.writeHead(200, {'content-type': 'image/png'}); res.end(png); return;}
    if (pathname === '/site.css') {res.writeHead(200, {'content-type': 'text/css; charset=utf-8'}); res.end('/* linked-css-marker */ body { --fixture-site-css: #123456; }'); return;}
    if (pathname === '/site.js') {res.writeHead(200, {'content-type': 'application/javascript; charset=utf-8'}); res.end('/* linked-js-marker */ window.fixtureLinkedScript = true;'); return;}
    if (pathname === '/robots.txt') {res.writeHead(200, {'content-type': 'text/plain'}); res.end(''); return;}
    if (pathname === '/sitemap.xml') {res.writeHead(200, {'content-type': 'application/xml'}); res.end(`<urlset><url><loc>${origin}/about/</loc></url></urlset>`); return;}
    const heading = pathname === '/about/' ? '<h1>About</h1><h1>Duplicate</h1>' : pathname === '/' ? '' : '<h1>Product</h1>';
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(`<!doctype html><html lang="ru"><head><title>Fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Fixture description"><link rel="stylesheet" href="/site.css"><script src="/site.js" defer></script><style>html,body{margin:0;background:white;color:#111}input{color:#bbb;background:#fff;border:1px solid #ddd}input::placeholder{color:#ccc;opacity:1}input:focus{color:#222}img{width:40px;height:40px}</style></head><body>${heading}<a id="relative" href="/about/">Relative</a><a id="absolute" href="${origin}/about/">Absolute</a><a href="${origin.replace('http:', '')}/about/">Protocol-relative</a><a href="/catalog/product/p1/">Product one</a><a href="/catalog/product/p2/">Product two</a><a href="/catalog/product/p3/">Product three</a><a href="/cart/add/">Mutation</a><img src="/large.png"><img src="/large-copy.png" alt="Decorative"><form action="/subscribe/" method="post"><label for="email">Email</label><input id="email" type="email" placeholder="Email"><button type="submit">Send</button></form><button id="native-submit" onclick="document.forms[0].submit()">Native submit</button><button id="fetch-post" onclick="fetch('/subscribe/',{method:'POST',body:'x'}).catch(()=>{})">POST</button><button id="fetch-get" onclick="fetch('/cart/add/').catch(()=>{})">GET action</button><script>document.querySelector('#email').addEventListener('input',()=>fetch('/autosave?value=x').catch(()=>{}));</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {server.close(); fs.rmSync(directory, {recursive: true, force: true});});
  const profile = {name: 'local-fixture', url: origin + '/', testFixture: true, viewports: [{name: 'desktop', width: 2550, height: 900, mobile: false}, {name: 'mobile', width: 390, height: 844, mobile: true}, {name: 'breakpoint', width: 767, height: 900, mobile: false}], boundaryWidths: [768], maxImageBytes: 300000, repeatedPages: {samplesPerTemplate: 2, pathPatterns: ['^/catalog/product/']}, absoluteUrlPolicy: {approvedExternalHosts: []}, mutationPathPatterns: ['cart/add'], crawl: {delayMs: 0, maxScrollSteps: 5, navigationTimeoutMs: 10000}};
  const profilePath = path.join(directory, 'profile.json'); fs.writeFileSync(profilePath, JSON.stringify(profile));
  const output = path.join(directory, 'full');
  const run = await execute('audit.cjs', ['--profile', profilePath, '--output', output]);
  assert.equal(run.code, 0, run.stderr + run.stdout);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  const coverage = JSON.parse(fs.readFileSync(path.join(output, 'coverage.json')));
  const findings = JSON.parse(fs.readFileSync(path.join(output, 'findings.json')));
  assert.equal(manifest.captureComplete, true); assert.equal(manifest.auditComplete, false);
  assert.equal(manifest.sourceCaptureComplete, true);
  assert.equal(manifest.browser.name, 'Microsoft Edge'); assert.equal(manifest.browser.channel, 'msedge');
  assert.equal(manifest.pages.filter(p => p.included).length, 4);
  const homePage = manifest.pages.find(p => p.url === origin + '/');
  assert.ok(homePage.markup.response.saved && homePage.markup.rendered.saved);
  assert.ok(fs.readFileSync(path.join(output, homePage.markup.response.file), 'utf8').includes('<link rel="stylesheet"'));
  assert.ok(fs.readFileSync(path.join(output, homePage.markup.rendered.file), 'utf8').includes('Product one'));
  const cssSource = manifest.sourceFiles.find(source => source.url === origin + '/site.css');
  const jsSource = manifest.sourceFiles.find(source => source.url === origin + '/site.js');
  assert.ok(cssSource?.saved && jsSource?.saved);
  assert.ok(fs.readFileSync(path.join(output, cssSource.file), 'utf8').includes('linked-css-marker'));
  assert.ok(fs.readFileSync(path.join(output, jsSource.file), 'utf8').includes('linked-js-marker'));
  assert.ok(homePage.linkedSourceIds.includes(cssSource.id) && homePage.linkedSourceIds.includes(jsSource.id));
  assert.ok(manifest.pages.some(p => p.url.endsWith('/p3/') && !p.included));
  assert.ok(manifest.pages.some(p => p.reason === 'mutation-path'));
  assert.deepEqual(coverage.map(c => c.viewport), [2550,2550,2550,2550,390,390,390,390,767,767,767,767,768,768,768,768]);
  assert.ok(coverage.every(c => c.visual === 'not_checked' && c.interaction === 'not_checked'));
  assert.ok(findings.some(f => f.verification.rule === 'h1-count'));
  assert.ok(findings.some(f => f.verification.rule === 'input-contrast-text'));
  const internal = findings.filter(f => f.verification.rule === 'internal-absolute');
  assert.ok(internal.length > 0);
  assert.ok(!internal.some(f => f.occurrences.some(o => o.selector === '#relative')));
  assert.ok(internal.some(f => f.occurrences.some(o => o.selector === '#absolute')));
  assert.ok(findings.some(f => f.verification.rule === 'image-size'));
  assert.ok(manifest.identicalImageFiles.length > 0);
  assert.equal(hits.cart, 0);
  const browser = await launchBrowser('msedge', profile, require('playwright'));
  const context = await browser.newContext({serviceWorkers: 'block'}), blocked = [];
  try {
    await installReadOnlyGuard(context, profile, blocked);
    const page = await context.newPage(); await page.goto(origin);
    await page.locator('button[type=submit]').click();
    await page.locator('#native-submit').click();
    await page.locator('#fetch-post').click();
    await page.locator('#fetch-get').click();
    await page.waitForTimeout(150);
    assert.equal(hits.post, 0); assert.equal(hits.cart, 0);
    assert.ok(blocked.some(b => b.reason === 'mutation-method'));
    assert.ok(blocked.some(b => b.reason === 'mutation-path'));
  } finally {await context.close(); await browser.close();}
  const probeOutput = path.join(directory, 'probe.json');
  const probe = await execute('probe-input.cjs', ['--profile', profilePath, '--url', origin + '/', '--selector', '#email', '--output', probeOutput]);
  assert.equal(probe.code, 0, probe.stderr);
  const probeData = JSON.parse(fs.readFileSync(probeOutput));
  assert.ok(probeData.acceptedLength > 0); assert.equal(probeData.cleared, true); assert.equal(probeData.submitted, false);
  assert.equal(hits.autosave, 0); assert.equal(hits.post, 0);
  assert.ok(probeData.blockedRequests.some(b => b.reason === 'input-without-transmission'));
  assert.ok(fs.existsSync(probeData.evidence));
  const partial = await execute('audit.cjs', ['--profile', profilePath, '--output', path.join(directory, 'partial'), '--max-pages', '1']);
  assert.equal(partial.code, 2);
  const partialManifest = JSON.parse(fs.readFileSync(path.join(directory, 'partial', 'manifest.json')));
  assert.equal(partialManifest.captureComplete, false);
  assert.equal(partialManifest.discoveryComplete, false);
  // Resume must clear the page-limit limitation and finish collection without erasing review statuses.
  const resumed = await execute('audit.cjs', ['--profile', profilePath, '--output', path.join(directory, 'partial'), '--resume']);
  assert.equal(resumed.code, 0, resumed.stderr);
  const resumedManifest = JSON.parse(fs.readFileSync(path.join(directory, 'partial', 'manifest.json')));
  assert.equal(resumedManifest.captureComplete, true); assert.equal(resumedManifest.auditComplete, false);
});

test('checklist groups by requested order and links exact affected pages and resources', () => {
  const occurrence = {url: 'https://example.invalid/about/', viewport: 390, evidence: 'screenshots/test.png'};
  const findings = [
    {id: 'U-image', owner: 'user', status: 'confirmed', priority: 'P2', category: 'images', message: 'Image exceeds the size limit', recommendation: 'Optimize this image', occurrences: [{...occurrence, resourceUrl: 'https://cdn.example.invalid/heavy.webp'}]},
    {id: 'U-visual-p3', owner: 'user', status: 'confirmed', priority: 'P3', category: 'design', message: 'Minor color mismatch', recommendation: 'Review the token', occurrences: [occurrence]},
    {id: 'U-typo', owner: 'user', status: 'confirmed', priority: 'P3', category: 'content', message: 'Confirmed typo', recommendation: 'Fix text in CMS', occurrences: [occurrence]},
    {id: 'U-description', owner: 'user', status: 'confirmed', priority: 'P2', category: 'metadata', message: 'Missing meta description', recommendation: 'Fill description', occurrences: [{...occurrence, url: 'https://example.invalid/contacts/'}]},
    {id: 'A-layout', owner: 'codex', status: 'confirmed', priority: 'P1', category: 'layout', message: 'Confirmed overflow', recommendation: 'Fix width', occurrences: [occurrence]},
    {id: 'A-candidate', owner: 'codex', status: 'candidate', priority: 'P1', category: 'layout', message: 'Unverified overflow', recommendation: 'Review it', occurrences: [occurrence]}
  ];
  const output = report(findings);
  assert.ok(output.includes('U-image')); assert.ok(!output.includes('Unverified overflow'));
  assert.ok(output.includes('Для вас')); assert.ok(output.includes('Для Codex'));
  assert.ok(output.includes('[https://cdn.example.invalid/heavy.webp](<https://cdn.example.invalid/heavy.webp>)'));
  assert.ok(output.includes('[https://example.invalid/contacts/](<https://example.invalid/contacts/>)'));
  assert.ok(output.indexOf('1. Визуальные ошибки и дизайн') < output.indexOf('2. Вёрстка, стили и орфография'));
  assert.ok(output.indexOf('2. Вёрстка, стили и орфография') < output.indexOf('3. Глобальные проблемы'));
  assert.ok(output.indexOf('U-image') < output.indexOf('U-visual-p3'));
  assert.equal(output.match(/A-layout/g).length, 1);
});

test('checklist summary derives page, viewport, browser and source coverage from audit files', () => {
  const summary = coverageSummary({pages: [{url: 'https://example.invalid/', included: true}, {url: 'https://example.invalid/about/', included: true}], browser: {name: 'Microsoft Edge', version: '155'}, sourceCaptureComplete: false, sourceCaptureFailures: [{url: 'https://example.invalid/about/'}], limitations: [{}]}, [
    {url: 'https://example.invalid/', viewport: 390, capture: 'passed'},
    {url: 'https://example.invalid/', viewport: 768, capture: 'passed'},
    {url: 'https://example.invalid/about/', viewport: 390, capture: 'passed'},
    {url: 'https://example.invalid/about/', viewport: 768, capture: 'blocked'}
  ]);
  assert.ok(summary.includes('1/2 страниц'));
  assert.ok(summary.includes('390, 768 px'));
  assert.ok(summary.includes('Microsoft Edge 155'));
  assert.ok(summary.includes('сбор HTML/CSS/JS неполон; пропусков: 1'));
});
