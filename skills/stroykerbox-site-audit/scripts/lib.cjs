'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

function argumentsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hostsOf(profile) {
  return new Set([new URL(profile.url).host, ...(profile.internalHosts || [])].map(h => h.toLowerCase()));
}
function mutationUrl(url, profile) {
  try {
    const parsed = new URL(url, profile.url);
    if (!hostsOf(profile).has(parsed.host.toLowerCase())) return false;
    return (profile.mutationPathPatterns || []).some(p => new RegExp(p, 'i').test(parsed.pathname + parsed.search));
  } catch { return true; }
}
function normalizeUrl(raw, base, profile) {
  try {
    if (!raw || /^(?:mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return null;
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !hostsOf(profile).has(url.host.toLowerCase())) return null;
    if (mutationUrl(url.href, profile)) return null;
    // Discovery audits unique paths. Query states remain in raw links for manual review.
    url.hash = ''; url.search = '';
    for (const p of profile.excludePaths || []) if (new RegExp(p).test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
function repeatedTemplate(url, profile) {
  const pathname = new URL(url).pathname;
  const patterns = profile.repeatedPages?.pathPatterns || [];
  return patterns.find(p => new RegExp(p).test(pathname)) || null;
}
// HTML srcset tokenisation, including commas inside data URLs.
function srcsetUrls(value) {
  const urls = []; let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++;
    const start = i;
    while (i < value.length && !/\s/.test(value[i])) i++;
    let url = value.slice(start, i);
    const ended = /,$/.test(url);
    url = url.replace(/,+$/, '');
    if (url) urls.push(url);
    if (ended) continue;
    let parentheses = 0;
    while (i < value.length) {
      const c = value[i++];
      if (c === '(') parentheses++; else if (c === ')') parentheses--;
      else if (c === ',' && parentheses === 0) break;
    }
  }
  return urls;
}
function classifyRawUrl(raw, base, profile) {
  if (!/^(?:https?:)?\/\//i.test(raw.trim())) return null;
  const url = new URL(raw.trim(), base);
  if (hostsOf(profile).has(url.host.toLowerCase())) return 'internal-absolute';
  if ((profile.absoluteUrlPolicy?.approvedExternalHosts || []).includes(url.host)) return 'approved-external';
  return 'external-exception-needed';
}
function safeMessage(error) {
  return String(error.message || error).replace(/([a-z]+:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|key|password|secret|session|auth)[^=]*=)[^&\s]+/gi, '$1[redacted]');
}
function proxyConfiguration(siteUrl) {
  const host = new URL(siteUrl).hostname;
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) return undefined;
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return undefined;
  const url = new URL(raw);
  return {server: `${url.protocol}//${url.host}`, ...(url.username ? {username: decodeURIComponent(url.username), password: decodeURIComponent(url.password)} : {})};
}
async function launchBrowser(engine, profile, playwright) {
  if (engine !== 'msedge') throw new Error('Microsoft Edge is required. Browser substitution is forbidden. Use --browser msedge.');
  const options = {headless: true, channel: 'msedge'};
  const proxy = proxyConfiguration(profile.url);
  if (proxy) options.proxy = proxy;
  let executable = process.env.AUDIT_EDGE_EXECUTABLE || profile.browserExecutable;
  if (!executable) {
    const runtime = path.resolve(__dirname, '../../../.edge-runtime.json');
    if (fs.existsSync(runtime)) executable = JSON.parse(fs.readFileSync(runtime, 'utf8')).executablePath;
  }
  if (executable) {
    if (!fs.existsSync(executable)) throw new Error('Configured Microsoft Edge executable is unavailable. Audit stopped; no fallback browser will run.');
    if (!/^(?:msedge(?:\.exe)?|microsoft-edge(?:-stable|-beta|-dev)?(?:\.exe)?)$/i.test(path.basename(executable))) throw new Error('Executable must be Microsoft Edge; another browser path is forbidden.');
    if (process.platform !== 'win32') {
      const identity = execFileSync(executable, ['--version'], {encoding: 'utf8', timeout: 5000}).trim();
      if (!/^Microsoft Edge\s+\d+\./i.test(identity)) throw new Error('Executable did not identify itself as Microsoft Edge. Audit stopped.');
    }
    options.executablePath = executable;
  }
  if (process.platform === 'linux') options.args = ['--no-sandbox'];
  // Playwright uses this API namespace to launch the real msedge channel.
  // The Edge channel is mandatory, with no alternative executable or retry.
  try {
    return await playwright.chromium.launch(options);
  } catch (error) {
    throw new Error(`Microsoft Edge could not start. Audit stopped without browser substitution. ${safeMessage(error)}`);
  }
}
async function installReadOnlyGuard(context, profile, blocked, state = {freezeDynamic: false}) {
  await context.route('**/*', async route => {
    const req = route.request();
    const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method());
    const unsafePath = mutationUrl(req.url(), profile);
    const frozen = state.freezeDynamic && ['xhr', 'fetch', 'document', 'other', 'websocket'].includes(req.resourceType());
    if (unsafeMethod || unsafePath || frozen) {
      blocked.push({url: req.url().replace(/\?.*$/, '?[redacted]'), method: req.method(), reason: unsafeMethod ? 'mutation-method' : unsafePath ? 'mutation-path' : 'input-without-transmission'});
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await context.addInitScript(() => {
    document.addEventListener('submit', event => {event.preventDefault(); event.stopImmediatePropagation();}, true);
    HTMLFormElement.prototype.submit = function () {};
    HTMLFormElement.prototype.requestSubmit = function () {};
    // No service worker/WebSocket/EventSource side channels for form autosave.
    window.WebSocket = class { constructor() { throw new Error('Read-only audit blocks WebSocket'); } };
    window.EventSource = class { constructor() { throw new Error('Read-only audit blocks EventSource'); } };
  });
  return state;
}
module.exports = {argumentsOf, writeJson, hash, hostsOf, mutationUrl, normalizeUrl, repeatedTemplate, srcsetUrls, classifyRawUrl, safeMessage, proxyConfiguration, launchBrowser, installReadOnlyGuard};
