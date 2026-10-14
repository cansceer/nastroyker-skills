#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {argumentsOf, writeJson, hostsOf, mutationUrl, safeMessage, launchBrowser} = require('./lib.cjs');
async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (!args.profile || !args.input || !args.output) throw new Error('Usage: check-links.cjs --profile FILE --input AUDIT_DIRECTORY --output FILE [--external]');
  const profile = JSON.parse(fs.readFileSync(args.profile, 'utf8'));
  const directory = path.join(path.resolve(args.input), 'snapshots'), targets = new Map();
  for (const filename of fs.readdirSync(directory).filter(f => f.endsWith('.json'))) {
    const snapshot = JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'));
    for (const a of snapshot.rawUrls.filter(r => r.tag === 'a' && r.attribute === 'href')) {
      if (!a.value.trim() || a.value.trim().startsWith('#')) continue;
      let url; try {url = new URL(a.value, snapshot.url);} catch {continue;}
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
      url.hash = '';
      const key = url.href, occurrences = targets.get(key) || [];
      occurrences.push({url: snapshot.url, selector: a.selector, viewport: snapshot.viewport.width}); targets.set(key, occurrences);
    }
  }
  const browser = await launchBrowser('msedge', profile, require('playwright'));
  const browserContext = await browser.newContext({serviceWorkers: 'block'});
  const context = browserContext.request;
  const browserInfo = {name: 'Microsoft Edge', channel: 'msedge', version: browser.version()};
  const results = [];
  try {
    for (const [target, occurrences] of targets) {
      const record = {target, occurrences, method: 'HEAD', httpStatus: null, state: 'not_checked', destinationContent: 'not_checked'};
      let current = target;
      for (let redirect = 0; redirect <= 5; redirect++) {
        if (mutationUrl(current, profile)) {record.state = 'blocked-mutation'; break;}
        if (!args.external && !hostsOf(profile).has(new URL(current).host.toLowerCase())) {record.state = 'external-not-checked'; break;}
        try {
          let response = await context.head(current, {maxRedirects: 0, timeout: 15000});
          if ([405, 501].includes(response.status())) {response = await context.get(current, {maxRedirects: 0, timeout: 15000}); record.method = 'GET-fallback';}
          record.httpStatus = response.status(); record.finalUrl = current;
          if ([301, 302, 303, 307, 308].includes(response.status()) && response.headers().location) {
            if (redirect === 5) {record.state = 'redirect-limit'; break;}
            const next = new URL(response.headers().location, current);
            if (!/^https?:$/.test(next.protocol) || next.username || next.password) {record.state = 'unsafe-redirect'; break;}
            current = next.href; continue;
          }
          record.state = [401, 403, 429].includes(response.status()) ? 'restricted-or-rate-limited; not-proven-broken' : response.status() >= 400 ? 'http-error-candidate' : 'http-ok; verify-destination-and-soft404';
          break;
        } catch (error) {record.state = 'request-failed; not-proven-broken'; record.reason = safeMessage(error); break;}
      }
      results.push(record); writeJson(args.output, {browser: browserInfo, complete: results.length === targets.size, targets: targets.size, results});
      await new Promise(resolve => setTimeout(resolve, profile.crawl?.delayMs ?? 400));
    }
    writeJson(args.output, {browser: browserInfo, complete: true, targets: targets.size, results, note: 'HTTP OK is not proof of correct destination; form submissions and mutation URLs were not tested.'});
  } finally {await browserContext.close(); await browser.close();}
}
main().catch(error => {console.error(safeMessage(error)); process.exitCode = 1;});
