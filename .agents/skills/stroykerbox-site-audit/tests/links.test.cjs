'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

test('link pass covers unsampled products, protects redirects and keeps access errors inconclusive', {timeout: 30000}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'site-audit-links-'));
  let origin, mutationHits = 0, fallbackGet = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/cart/add/') mutationHits++;
    if (req.url === '/redirect/') {res.writeHead(302, {location: '/cart/add/'}); res.end(); return;}
    if (req.url === '/missing/') {res.writeHead(404); res.end(); return;}
    if (req.url === '/restricted/') {res.writeHead(403); res.end(); return;}
    if (req.url === '/fallback/' && req.method === 'HEAD') {res.writeHead(405); res.end(); return;}
    if (req.url === '/fallback/' && req.method === 'GET') fallbackGet++;
    res.writeHead(200, {'content-type': 'text/html'}); res.end('Read-only fixture');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {server.close(); fs.rmSync(directory, {recursive: true, force: true});});
  const profile = {url: origin, mutationPathPatterns: ['cart/add'], crawl: {delayMs: 0}};
  fs.writeFileSync(path.join(directory, 'profile.json'), JSON.stringify(profile));
  fs.mkdirSync(path.join(directory, 'snapshots'));
  fs.writeFileSync(path.join(directory, 'snapshots', 'page.json'), JSON.stringify({url: origin, viewport: {width: 2550}, rawUrls: ['/catalog/product/outside-visual-sample/', '/missing/', '/restricted/', '/redirect/', '/cart/add/', '/fallback/', '#section', 'mailto:demo@example.invalid'].map((value, i) => ({tag: 'a', attribute: 'href', value, selector: `#link${i}`}))}));
  const output = path.join(directory, 'links.json');
  const run = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../scripts/check-links.cjs'), '--profile', path.join(directory, 'profile.json'), '--input', directory, '--output', output]);
    let stderr = ''; child.stderr.on('data', b => {stderr += b;}); child.on('error', reject); child.on('close', code => resolve({code, stderr}));
  });
  assert.equal(run.code, 0, run.stderr);
  const data = JSON.parse(fs.readFileSync(output));
  assert.equal(data.complete, true);
  assert.equal(data.browser.name, 'Microsoft Edge');
  assert.ok(data.results.some(r => r.target.endsWith('/outside-visual-sample/') && r.state.startsWith('http-ok')));
  assert.ok(data.results.some(r => r.target.endsWith('/missing/') && r.state === 'http-error-candidate'));
  assert.ok(data.results.some(r => r.target.endsWith('/restricted/') && r.state.includes('not-proven-broken')));
  assert.ok(data.results.some(r => r.target.endsWith('/redirect/') && r.state === 'blocked-mutation'));
  assert.equal(mutationHits, 0); assert.equal(fallbackGet, 1);
});
