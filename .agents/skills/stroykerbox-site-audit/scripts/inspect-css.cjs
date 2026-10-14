#!/usr/bin/env node
'use strict';
// Applies user CSS to a synthetic local fixture in Microsoft Edge. Never loads site HTML or runs user JS.
const fs = require('node:fs');
const path = require('node:path');
const {argumentsOf, writeJson, launchBrowser, safeMessage} = require('./lib.cjs');

function colorRgb(value) {
  const m = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)/i);
  return m ? {rgb: m.slice(1, 4).map(Number), alpha: m[4] === undefined ? 1 : Number(m[4])} : null;
}
function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;});
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(foreground, background) {
  let fg = colorRgb(foreground); const bg = colorRgb(background);
  if (!fg || !bg) return null;
  fg = fg.rgb.map((v, i) => v * fg.alpha + bg.rgb[i] * (1 - fg.alpha));
  const a = luminance(fg), b = luminance(bg.rgb);
  return Number(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2));
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (!args.inventory || !args.output) throw new Error('Usage: node inspect-css.cjs --inventory FILE --output JSON [--screenshot PNG]');
  const inventory = JSON.parse(fs.readFileSync(path.resolve(args.inventory), 'utf8'));
  const cssFiles = inventory.files.filter(f => f.kind === '.css');
  if (!cssFiles.length) throw new Error('Inventory contains no CSS files.');
  const sourceFiles = cssFiles.map(f => ({name: f.name, sha256: f.sha256, text: fs.readFileSync(f.path, 'utf8')}));
  const profile = {url: 'http://127.0.0.1/source-fixture/', browserExecutable: null};
  const browser = await launchBrowser('msedge', profile, require('playwright'));
  try {
    const context = await browser.newContext({viewport: {width: 1000, height: 800}, serviceWorkers: 'block'});
    const blockedRequests = [];
    await context.route('**/*', route => {
      blockedRequests.push({url: route.request().url().replace(/\?.*$/, '?[redacted]'), reason: 'offline-source-fixture'});
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>CSS source fixture</title></head><body style="margin:24px;background:#fff;color:#4c4c4c">
      <p id="source-plain">Проверочный текст <strong id="source-bold">полужирный фрагмент</strong></p>
      <div class="fancybox-content"><button class="button-theme" id="source-button">Проверочная кнопка</button></div>
      <input class="search-input-group__input" id="source-search" placeholder="Проверочное поле" aria-label="Проверочное поле">
      </body></html>`);
    for (const file of sourceFiles) await page.addStyleTag({content: file.text});
    await page.waitForTimeout(450);
    const sample = async selector => page.locator(selector).evaluate(el => {
      const s = getComputedStyle(el);
      return {color: s.color, backgroundColor: s.backgroundColor, fontFamily: s.fontFamily,
        fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight,
        outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor,
        borderStyle: s.borderStyle, boxShadow: s.boxShadow,
        placeholderColor: el.matches('input,textarea') ? getComputedStyle(el, '::placeholder').color : null};
    });
    const initial = {};
    for (const [name, selector] of Object.entries({plain: '#source-plain', bold: '#source-bold', button: '#source-button', input: '#source-search'})) initial[name] = await sample(selector);
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const document = await cdp.send('DOM.getDocument');
    const button = await cdp.send('DOM.querySelector', {nodeId: document.root.nodeId, selector: '#source-button'});
    await cdp.send('CSS.forcePseudoState', {nodeId: button.nodeId, forcedPseudoClasses: ['hover']});
    await page.waitForTimeout(450);
    const hover = await sample('#source-button');
    await cdp.send('CSS.forcePseudoState', {nodeId: button.nodeId, forcedPseudoClasses: []});
    await page.locator('#source-search').focus();
    await page.waitForTimeout(450);
    const focus = await sample('#source-search');
    const cssom = await page.evaluate(() => {
      const fontFaces = [];
      const inspect = rules => {for (const rule of rules) {
        if (rule instanceof CSSFontFaceRule) fontFaces.push({family: rule.style.getPropertyValue('font-family').trim(),
          src: rule.style.getPropertyValue('src').trim(), fontStyle: rule.style.getPropertyValue('font-style').trim(),
          fontWeight: rule.style.getPropertyValue('font-weight').trim()});
        if (rule.cssRules) inspect(rule.cssRules);
      }};
      for (const sheet of document.styleSheets) {try {inspect(sheet.cssRules);} catch {}}
      return fontFaces;
    });
    const unsupported = await page.evaluate(rules => {
      const bad = [];
      for (const row of rules) for (const d of row.declarations) {
        if (row.selector.startsWith('@font-face')) continue; // These are descriptors, not CSS.supports() properties.
        if (d.name.startsWith('--') || d.name.startsWith('-')) continue;
        if (/^-(?:ms|moz|webkit|o)-/i.test(d.value)) continue; // Legacy prefixed fallback values are not standalone defects.
        if (!CSS.supports(d.name, d.value)) bad.push({file: row.file, line: d.line, selector: row.selector, property: d.name, value: d.value});
      }
      return bad;
    }, inventory.rules);
    if (args.screenshot) await page.screenshot({path: path.resolve(args.screenshot), fullPage: true});
    const report = {version: 1, scope: 'isolated-css-fixture', browser: {name: 'Microsoft Edge', channel: 'msedge', version: browser.version(), fallbackAllowed: false},
      files: sourceFiles.map(({name, sha256}) => ({name, sha256})), sourceJsExecuted: false, liveWebsiteChecked: false,
      note: 'Synthetic local DOM with uploaded CSS only; no site HTML/CMS stylesheet was loaded. Forced :hover checks CSS declaration outcome, not pointer interaction on the website.',
      computed: {normal: initial, hoverForced: hover, focus: focus,
        contrast: {buttonHoverTextToBackground: contrast(hover.color, hover.backgroundColor),
          buttonNormalTextToBackground: contrast(initial.button.color, initial.button.backgroundColor),
          inputTextToBackground: contrast(initial.input.color, initial.input.backgroundColor),
          inputPlaceholderToBackground: contrast(initial.input.placeholderColor, initial.input.backgroundColor)},
        fontFaces: cssom}, unsupportedStandardDeclarations: unsupported,
      blockedRequests};
    writeJson(path.resolve(args.output), report);
    process.stdout.write(JSON.stringify({output: path.resolve(args.output), browser: report.browser, fontFaces: cssom.length, unsupportedStandardDeclarations: unsupported.length}) + '\n');
    await context.close();
  } finally {await browser.close();}
}
main().catch(error => {process.stderr.write(safeMessage(error) + '\n'); process.exitCode = 1;});
