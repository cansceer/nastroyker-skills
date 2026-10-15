#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {argumentsOf, writeJson, hash, normalizeUrl, repeatedTemplate, mutationUrl, safeMessage, launchBrowser, installReadOnlyGuard} = require('./lib.cjs');
const {collectSnapshot} = require('./snapshot.cjs');
const {candidatesFor, mergeFindings} = require('./findings.cjs');

const SOURCE_FILE_LIMIT = 20_000_000;
const SOURCE_TOTAL_LIMIT = 200_000_000;
const MARKUP_FILE_LIMIT = 20_000_000;

function safeResourceUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[redacted]');
    return url.href;
  } catch { return '[invalid-url]'; }
}

function sourceExtension(contentType, rawUrl) {
  const mime = (contentType || '').split(';')[0].trim().toLowerCase();
  const mimeExtensions = {'text/css': 'css', 'application/javascript': 'js', 'text/javascript': 'js', 'application/x-javascript': 'js', 'text/html': 'html', 'application/xhtml+xml': 'html'};
  if (mimeExtensions[mime]) return mimeExtensions[mime];
  try {
    const extension = path.extname(new URL(rawUrl).pathname).slice(1).toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin';
  } catch { return 'bin'; }
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (!args.profile || !args.output) throw new Error('Usage: node audit.cjs --profile FILE --output DIRECTORY [--browser msedge] [--max-pages N] [--resume]');
  const profile = JSON.parse(fs.readFileSync(path.resolve(args.profile), 'utf8'));
  const output = path.resolve(args.output), engine = args.browser || 'msedge';
  if (engine !== 'msedge') throw new Error('Microsoft Edge is required; other browsers are forbidden.');
  if (!args.resume && fs.existsSync(path.join(output, 'manifest.json'))) throw new Error('Output already contains an audit; use --resume or a new directory');
  const maxPages = args['max-pages'] ? Number(args['max-pages']) : Infinity;
  if (!(maxPages > 0)) throw new Error('--max-pages must be positive');
  if (!profile.url || !profile.viewports?.length || profile.viewports[0].width !== 2550 && !profile.testFixture) throw new Error('Profile requires url and first viewport 2550 px');
  for (const folder of ['snapshots', 'screenshots', 'assets', 'markup', 'sources']) fs.mkdirSync(path.join(output, folder), {recursive: true});
  const load = (file, fallback) => args.resume && fs.existsSync(path.join(output, file)) ? JSON.parse(fs.readFileSync(path.join(output, file), 'utf8')) : fallback;
  let findings = load('findings.json', []), coverage = load('coverage.json', []);
  const manifest = load('manifest.json', {version: 2, project: profile.name, url: profile.url, startedAt: new Date().toISOString(), status: 'collecting', browser: {name: 'Microsoft Edge', channel: 'msedge', engine, version: null, fallbackAllowed: false, requestedBrands: ['Microsoft Edge']}, pages: [], assets: [], sourceFiles: [], blockedRequests: [], limitations: [], discoveryComplete: false, captureComplete: false, auditComplete: false});
  manifest.sourceFiles ||= [];
  if (manifest.url !== profile.url || manifest.browser.engine !== engine) throw new Error('Resume requires the same URL and browser; use a separate output for each engine');
  manifest.limitations = manifest.limitations.filter(l => !/--max-pages/.test(l.reason));
  const persist = () => {writeJson(path.join(output, 'manifest.json'), manifest); writeJson(path.join(output, 'coverage.json'), coverage); writeJson(path.join(output, 'findings.json'), findings);};
  persist();
  let browser;
  try {browser = await launchBrowser(engine, profile, require('playwright'));}
  catch (error) {manifest.status = 'blocked'; manifest.limitations.push({scope: 'browser-start', reason: safeMessage(error)}); persist(); process.exitCode = 2; return;}
  manifest.browser.version = browser.version();
  let axePath = null;
  try {axePath = require.resolve('axe-core/axe.min.js');} catch {manifest.limitations.push({scope: 'axe', reason: 'Optional axe-core not installed; accessibility requires manual review.'});}
  const viewports = [...profile.viewports, ...(profile.boundaryWidths || []).map(width => ({name: `boundary-${width}`, width, height: 900, mobile: false}))];
  const pageMap = new Map(manifest.pages.map(p => [p.url, p]));
  const sampling = new Map();
  for (const p of manifest.pages.filter(p => p.included && p.template)) sampling.set(p.template, (sampling.get(p.template) || 0) + 1);
  const queue = [];
  const discover = (raw, base, source, explicit = false) => {
    let original;
    try {original = new URL(raw, base);} catch {return;}
    if (original.search) manifest.queryStatesOmitted = true;
    const url = normalizeUrl(raw, base, profile);
    if (!url) {
      if (mutationUrl(original.href, profile) && !pageMap.has(original.href)) {const row = {url: original.href.replace(/\?.*$/, ''), included: false, reason: 'mutation-path', source}; pageMap.set(row.url, row); manifest.pages.push(row);}
      return;
    }
    if (pageMap.has(url)) return;
    const template = repeatedTemplate(url, profile);
    const count = sampling.get(template) || 0;
    const included = !template || explicit || count < (profile.repeatedPages?.samplesPerTemplate || 5);
    if (included && template) sampling.set(template, count + 1);
    const row = {url, source, template, included, reason: included ? template ? 'template-sample-needs-agent-validation' : 'unique-page' : 'repeated-template-outside-sample'};
    pageMap.set(url, row); manifest.pages.push(row);
    if (included) queue.push(url);
  };
  // Main page must be first. For resume, pending desktop captures go back into the queue.
  discover(profile.url, profile.url, 'homepage', true);
  for (const seed of profile.seedPaths || []) discover(seed, profile.url, 'explicit-seed', true);
  if (args.resume) for (const p of manifest.pages.filter(p => p.included)) if (!coverage.some(c => c.url === p.url && c.viewport === viewports[0].width && c.capture === 'passed')) if (!queue.includes(p.url)) queue.push(p.url);
  const assetsByUrl = new Map(manifest.assets.map(a => [a.url, a]));
  const sourceFilesById = new Map(manifest.sourceFiles.map(file => [file.id, file]));
  let sourceBytesSaved = manifest.sourceFiles.filter(file => file.saved).reduce((sum, file) => sum + (file.bytes || 0), 0);
  let sourceCaptureChain = Promise.resolve();
  function queueSource(response, pageUrl, pending, linkedSourceIds) {
    const request = response.request();
    const resourceType = request.resourceType();
    if (!['document', 'stylesheet', 'script'].includes(resourceType)) return;
    const rawUrl = response.url();
    const id = hash(`${resourceType}\n${rawUrl}`);
    let file = sourceFilesById.get(id);
    if (!file) {
      file = {id, url: safeResourceUrl(rawUrl), resourceType, contentType: response.headers()['content-type'] || '', status: response.status(), bytes: null, sha256: null, file: null, saved: false, pages: [], error: null};
      sourceFilesById.set(id, file); manifest.sourceFiles.push(file);
      sourceCaptureChain = sourceCaptureChain.then(async () => {
        try {
          const declaredBytes = Number(response.headers()['content-length']);
          if (declaredBytes > SOURCE_FILE_LIMIT) {file.saveLimitation = 'File exceeds the 20 MB per-file evidence limit.'; return;}
          if (sourceBytesSaved >= SOURCE_TOTAL_LIMIT) {file.saveLimitation = 'The 200 MB total source-evidence limit was reached.'; return;}
          const buffer = await response.body();
          file.bytes = buffer.length; file.sha256 = hash(buffer);
          if (buffer.length > SOURCE_FILE_LIMIT) {file.saveLimitation = 'File exceeds the 20 MB per-file evidence limit.'; return;}
          if (sourceBytesSaved + buffer.length > SOURCE_TOTAL_LIMIT) {file.saveLimitation = 'Saving would exceed the 200 MB total source-evidence limit.'; return;}
          const extension = sourceExtension(file.contentType, rawUrl);
          file.file = `sources/${file.sha256}.${extension}`;
          fs.writeFileSync(path.join(output, file.file), buffer);
          file.saved = true; sourceBytesSaved += buffer.length;
        } catch (error) {file.error = safeMessage(error);}
      });
      pending.push(sourceCaptureChain);
    }
    if (!file.pages.includes(pageUrl)) file.pages.push(pageUrl);
    if (!linkedSourceIds.includes(id)) linkedSourceIds.push(id);
  }
  function saveMarkup(relativePath, value) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    const result = {file: relativePath, bytes: buffer.length, saved: false};
    if (buffer.length > MARKUP_FILE_LIMIT) {result.limitation = 'Markup exceeds the 20 MB per-file evidence limit.'; return result;}
    try {fs.writeFileSync(path.join(output, relativePath), buffer); result.saved = true;}
    catch (error) {result.error = safeMessage(error);}
    return result;
  }
  const designRows = load('design-code.json', {captures: []}).captures;
  let siteAccessible = true;
  async function capture(url, viewport, discoverLinks) {
    const previous = coverage.find(c => c.url === url && c.viewport === viewport.width && c.engine === engine);
    const priorPage = pageMap.get(url);
    const desktopEvidenceSaved = priorPage?.markup?.response?.saved && priorPage?.markup?.rendered?.saved && (priorPage.linkedSourceIds || []).every(id => sourceFilesById.get(id)?.saved);
    if (args.resume && previous?.capture === 'passed' && (viewport.width !== viewports[0].width || desktopEvidenceSaved)) return;
    const slug = `${hash(url).slice(0, 12)}-${viewport.width}-${engine}`;
    const evidence = `screenshots/${slug}.png`;
    const row = {url, viewport: viewport.width, mode: viewport.name, engine, capture: 'pending', visual: 'not_checked', interaction: 'not_checked', content: 'not_checked', image_semantics: 'not_checked'};
    if (previous) coverage.splice(coverage.indexOf(previous), 1);
    coverage.push(row);
    const context = await browser.newContext({viewport: {width: viewport.width, height: viewport.height}, deviceScaleFactor: viewport.mobile ? 2 : 1, hasTouch: viewport.mobile, isMobile: viewport.mobile, locale: 'ru-RU', timezoneId: 'Europe/Samara', serviceWorkers: 'block'});
    await installReadOnlyGuard(context, profile, manifest.blockedRequests);
    await context.addInitScript(() => {
      window.__siteAuditMetrics = {lcpMs: null, cls: 0, longTasks: 0};
      for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
        try {new PerformanceObserver(list => {for (const e of list.getEntries()) {if (type === 'largest-contentful-paint') window.__siteAuditMetrics.lcpMs = Math.round(e.startTime); if (type === 'layout-shift' && !e.hadRecentInput) window.__siteAuditMetrics.cls += e.value; if (type === 'longtask') window.__siteAuditMetrics.longTasks++;}}).observe({type, buffered: true});} catch {}
      }
    });
    const page = await context.newPage(), pending = [], imageRows = [], linkedSourceIds = [], errors = [], failedRequests = [];
    page.on('pageerror', error => errors.push(safeMessage(error)));
    page.on('console', msg => {if (msg.type() === 'error') errors.push(safeMessage(msg.text()));});
    page.on('requestfailed', req => failedRequests.push({url: req.url().replace(/\?.*$/, '?[redacted]'), failure: req.failure()?.errorText}));
    page.on('response', response => {
      const type = response.headers()['content-type'] || '';
      queueSource(response, url, pending, linkedSourceIds);
      if (!type.startsWith('image/')) return;
      pending.push((async () => {
        const imageUrl = response.url();
        if (assetsByUrl.has(imageUrl)) {imageRows.push(assetsByUrl.get(imageUrl)); return;}
        const asset = {url: imageUrl, contentType: type, status: response.status(), bytes: null, sha256: null, file: null, saved: false};
        try {
          const buffer = await response.body(); asset.bytes = buffer.length; asset.sha256 = hash(buffer);
          const extensions = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico'};
          const extension = extensions[type.split(';')[0]] || 'bin';
          if (buffer.length <= 20_000_000) {asset.file = `assets/${asset.sha256}.${extension}`; fs.writeFileSync(path.join(output, asset.file), buffer); asset.saved = true;}
          else asset.saveLimitation = 'File exceeds 20 MB local evidence limit; semantic review still pending.';
        } catch (error) {asset.error = safeMessage(error);}
        if (!assetsByUrl.has(imageUrl)) {assetsByUrl.set(imageUrl, asset); manifest.assets.push(asset);}
        imageRows.push(asset);
      })());
    });
    try {
      const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: profile.crawl?.navigationTimeoutMs || 30000});
      row.httpStatus = response?.status() || null;
      const pageRecord = pageMap.get(url);
      if (viewport.width === viewports[0].width && pageRecord) {
        const prefix = `markup/${hash(url).slice(0, 16)}`;
        const markup = {response: null, rendered: null, linkedSourceIds};
        try {markup.response = response ? saveMarkup(`${prefix}-response.html`, await response.body()) : {saved: false, limitation: 'No main-document response body was available.'};}
        catch (error) {markup.response = {saved: false, error: safeMessage(error)};}
        pageRecord.markup = markup;
      }
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3000))]));
      await page.waitForTimeout(250);
      let scrollComplete = false;
      for (let step = 0; step < (profile.crawl?.maxScrollSteps || 100); step++) {
        const atEnd = await page.evaluate(() => {
          const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
          const end = scrollY + innerHeight >= height - 2;
          if (!end) window.scrollBy(0, Math.max(innerHeight * .8, 100));
          return end;
        });
        await page.waitForTimeout(100);
        if (atEnd) {scrollComplete = true; break;}
      }
      row.scrollComplete = scrollComplete;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      await Promise.allSettled(pending);
      if (pageRecord) pageRecord.linkedSourceIds = [...new Set([...(pageRecord.linkedSourceIds || []), ...linkedSourceIds])];
      if (viewport.width === viewports[0].width && pageRecord?.markup) {
        try {pageRecord.markup.rendered = saveMarkup(`markup/${hash(url).slice(0, 16)}-rendered.html`, await page.evaluate(() => document.documentElement.outerHTML));}
        catch (error) {pageRecord.markup.rendered = {saved: false, error: safeMessage(error)};}
      }
      const snapshot = await collectSnapshot(page);
      snapshot.errors = errors; snapshot.failedRequests = failedRequests; snapshot.httpStatus = row.httpStatus; snapshot.scrollComplete = scrollComplete; snapshot.imageResources = imageRows;
      if (axePath) {
        try {await page.addScriptTag({path: axePath}); const axe = await page.evaluate(async () => {const r = await window.axe.run(document); return {violations: r.violations.map(v => ({id: v.id, impact: v.impact, description: v.description, helpUrl: v.helpUrl, nodes: v.nodes.map(n => ({target: n.target, failureSummary: n.failureSummary}))})), incomplete: r.incomplete.map(v => ({id: v.id, nodes: v.nodes.map(n => ({target: n.target}))}))};}); snapshot.axe = axe;}
        catch (error) {snapshot.axe = {status: 'blocked', reason: safeMessage(error)};}
      } else snapshot.axe = {status: 'not_checked'};
      writeJson(path.join(output, `snapshots/${slug}.json`), snapshot);
      await page.screenshot({path: path.join(output, evidence), fullPage: true, timeout: 30000});
      row.capture = scrollComplete ? 'passed' : 'partial'; row.snapshot = `snapshots/${slug}.json`; row.evidence = evidence;
      findings = mergeFindings(findings, candidatesFor(snapshot, profile, evidence, imageRows));
      designRows.push({url, viewport: viewport.width, headings: snapshot.headings, buttons: snapshot.buttons, paragraphs: snapshot.paragraphs});
      if (discoverLinks) for (const a of snapshot.rawUrls.filter(a => a.tag === 'a' && a.attribute === 'href')) discover(a.value, snapshot.url, url);
      if (row.httpStatus >= 400) findings = mergeFindings(findings, [{id: `U-${hash('http:' + url).slice(0, 10)}`, owner: 'user', priority: 'P2', status: 'candidate', category: 'links', message: `Страница отвечает HTTP ${row.httpStatus}`, recommendation: 'Проверить назначение ссылки и публикацию страницы в CMS.', occurrences: [{url, viewport: viewport.width, selector: null, evidence}], cmsOrigin: 'unknown', cmsConstraint: 'permissions-not-confirmed', verification: {status: 'not_checked'}}]);
      console.log(`${viewport.width}px ${url}: captured, review pending`);
    } catch (error) {
      row.capture = 'blocked'; row.reason = safeMessage(error);
      if (url === profile.url && viewport.width === viewports[0].width) siteAccessible = false;
      console.log(`${viewport.width}px ${url}: blocked`);
    } finally {
      await Promise.allSettled(pending);
      const pageRecord = pageMap.get(url);
      if (pageRecord) pageRecord.linkedSourceIds = [...new Set([...(pageRecord.linkedSourceIds || []), ...linkedSourceIds])];
      await context.close(); persist();
    }
    await new Promise(resolve => setTimeout(resolve, profile.crawl?.delayMs ?? 400));
  }
  try {
    // Main first, followed by every included page at desktop width.
    let desktopCount = 0;
    if (queue.length) {await capture(queue.shift(), viewports[0], true); desktopCount++;}
    if (siteAccessible) {
      const sitemapContext = await browser.newContext({serviceWorkers: 'block'});
      try {
        const origin = new URL(profile.url).origin;
        const sitemapQueue = [`${origin}/sitemap.xml`], seenSitemaps = new Set();
        try {
          const robots = await sitemapContext.request.get(`${origin}/robots.txt`, {timeout: 10000, maxRedirects: 0});
          if (robots.ok()) for (const line of (await robots.text()).split('\n')) {const m = line.match(/^Sitemap:\s*(\S+)/i); if (m) sitemapQueue.push(m[1]);}
        } catch {}
        while (sitemapQueue.length && seenSitemaps.size < 30) {
          const sitemap = sitemapQueue.shift();
          if (seenSitemaps.has(sitemap) || !normalizeUrl(sitemap, profile.url, profile)) continue;
          seenSitemaps.add(sitemap);
          try {
            const response = await sitemapContext.request.get(sitemap, {timeout: 15000, maxRedirects: 0});
            if (!response.ok()) continue;
            const xml = await response.text(), locations = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<]+?)(?:\]\]>)?\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
            if (locations.length > (profile.crawl?.maxSitemapUrls || 10000)) manifest.limitations.push({scope: 'discovery', reason: 'Sitemap URL limit reached; map is incomplete.'});
            for (const url of locations.slice(0, profile.crawl?.maxSitemapUrls || 10000)) if (/<sitemapindex[\s>]/.test(xml)) sitemapQueue.push(url); else discover(url, profile.url, 'sitemap');
          } catch (error) {manifest.limitations.push({scope: 'sitemap', url: sitemap, reason: safeMessage(error)});}
        }
        if (sitemapQueue.length) manifest.limitations.push({scope: 'discovery', reason: 'Sitemap index limit reached; map is incomplete.'});
      } finally {await sitemapContext.close();}
      while (queue.length && desktopCount < maxPages) {await capture(queue.shift(), viewports[0], true); desktopCount++;}
      if (queue.length) manifest.limitations.push({scope: 'discovery', reason: `--max-pages ${maxPages} reached; pending pages remain.`});
      manifest.discoveryComplete = !queue.length && !manifest.limitations.some(l => l.scope === 'discovery') && !coverage.some(c => c.mode === viewports[0].name && c.capture !== 'passed');
      const capturedPages = manifest.pages.filter(p => p.included && coverage.some(c => c.url === p.url && c.viewport === viewports[0].width && c.capture === 'passed')).map(p => p.url);
      // Width outermost: finish every page before moving to the next viewport.
      for (const viewport of viewports.slice(1)) for (const url of capturedPages) await capture(url, viewport, false);
      manifest.captureComplete = manifest.discoveryComplete && manifest.pages.filter(p => p.included).every(p => viewports.every(v => coverage.some(c => c.url === p.url && c.viewport === v.width && c.capture === 'passed')));
      manifest.status = 'evidence-collected-review-pending';
    } else {manifest.status = 'blocked'; manifest.limitations.push({scope: 'site-access', reason: 'Main-page browser navigation failed. No visual, form or image-content audit was completed.'});}
    const hashes = new Map();
    for (const asset of manifest.assets.filter(a => a.sha256)) {const urls = hashes.get(asset.sha256) || []; urls.push(asset.url); hashes.set(asset.sha256, urls);}
    manifest.identicalImageFiles = [...hashes.entries()].filter(([, urls]) => urls.length > 1).map(([sha256, urls]) => ({sha256, urls, assessment: 'duplicate-bytes; semantic relevance needs review'}));
    manifest.auditComplete = false;
    const markupComplete = manifest.pages.filter(page => page.included).every(page => page.markup?.response?.saved && page.markup?.rendered?.saved);
    const linkedSourcesComplete = manifest.sourceFiles.every(file => file.saved);
    manifest.sourceCaptureComplete = markupComplete && linkedSourcesComplete;
    manifest.sourceCaptureFailures = [
      ...manifest.pages.filter(page => page.included && (!page.markup?.response?.saved || !page.markup?.rendered?.saved)).map(page => ({url: page.url, kind: 'markup', reason: 'Original response or rendered DOM was not saved.'})),
      ...manifest.sourceFiles.filter(file => !file.saved).map(file => ({id: file.id, url: file.url, resourceType: file.resourceType, reason: file.saveLimitation || file.error || 'Resource body was not saved.'}))
    ];
    manifest.sourceBytesSaved = sourceBytesSaved;
    manifest.finishedAt = new Date().toISOString();
    writeJson(path.join(output, 'design-code.json'), {status: 'inferred-tokens-need-agent-review', reference: profile.designReference, captures: designRows});
  } finally {await browser.close(); persist();}
  if (!manifest.captureComplete) process.exitCode = 2;
}
main().catch(error => {console.error(safeMessage(error)); process.exitCode = 1;});
