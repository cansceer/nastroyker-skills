#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const {argumentsOf, writeJson, mutationUrl, launchBrowser, installReadOnlyGuard, safeMessage} = require('./lib.cjs');
const {collectSnapshot} = require('./snapshot.cjs');
async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (!args.profile || !args.url || !args.selector || !args.output) throw new Error('Usage: probe-input.cjs --profile FILE --url URL --selector CSS --output FILE [--width 390]');
  const profile = JSON.parse(fs.readFileSync(args.profile, 'utf8'));
  if (mutationUrl(args.url, profile)) throw new Error('Mutation URL blocked');
  if (new URL(args.url).origin !== new URL(profile.url).origin) throw new Error('Input probe requires project origin');
  const browser = await launchBrowser('msedge', profile, require('playwright'));
  const context = await browser.newContext({viewport: {width: Number(args.width || 390), height: 844}, serviceWorkers: 'block'});
  const blocked = [], state = await installReadOnlyGuard(context, profile, blocked);
  try {
    const page = await context.newPage(); await page.goto(args.url, {waitUntil: 'domcontentloaded'});
    const input = page.locator(args.selector); if (await input.count() !== 1) throw new Error('Selector must identify exactly one field');
    const type = await input.getAttribute('type'), tag = await input.evaluate(el => el.tagName.toLowerCase());
    if (!['input', 'textarea'].includes(tag) || ['hidden', 'file', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'password'].includes(type)) throw new Error('Use a text/number/email/tel field; passwords and actions are not probed automatically');
    if (!(await input.isEditable())) throw new Error('Field is not editable');
    const before = (await collectSnapshot(page)).fields;
    state.freezeDynamic = true;
    const value = type === 'email' ? 'audit@example.invalid' : type === 'tel' ? '0000000000' : type === 'number' ? '2' : 'Проверка поля';
    await input.fill(value); await input.focus();
    const acceptedLength = (await input.inputValue()).length;
    const focused = (await collectSnapshot(page)).fields;
    await page.screenshot({path: args.output + '.focused.png', fullPage: true});
    await input.fill(''); await input.blur();
    const cleared = (await input.inputValue()).length === 0;
    const after = (await collectSnapshot(page)).fields;
    writeJson(args.output, {browser: {name: 'Microsoft Edge', channel: 'msedge', version: browser.version()}, url: args.url, selector: args.selector, width: Number(args.width || 390), typed: true, acceptedLength, cleared, submitted: false, before, focused, after, evidence: args.output + '.focused.png', blockedRequests: blocked, limitations: ['No submission, server validation, autofill, mask edge cases or select/checkbox behavior proven by this probe.']});
  } finally {await context.close(); await browser.close();}
}
main().catch(error => {console.error(safeMessage(error)); process.exitCode = 1;});
