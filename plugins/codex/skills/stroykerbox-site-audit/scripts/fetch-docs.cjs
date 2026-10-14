#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {argumentsOf, writeJson, launchBrowser, safeMessage, installReadOnlyGuard} = require('./lib.cjs');
async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (!args.url || !args.output) throw new Error('Usage: fetch-docs.cjs --url HTTPS_URL --output FILE; credentials are read from private stdin');
  const url = new URL(args.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Documentation URL must use HTTPS without embedded credentials');
  let input = '';
  for await (const chunk of process.stdin) {input += chunk.toString(); if (input.length > 16384) throw new Error('Credential input too large');}
  const credentials = JSON.parse(input);
  if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string' || !credentials.username || !credentials.password) throw new Error('Username and password required through private stdin');
  const profile = {url: args.url, internalHosts: [url.host], mutationPathPatterns: []};
  const browser = await launchBrowser('msedge', profile, require('playwright'));
  const context = await browser.newContext({httpCredentials: {...credentials, origin: url.origin}, serviceWorkers: 'block'});
  try {
    await installReadOnlyGuard(context, profile, []);
    const page = await context.newPage();
    const response = await page.goto(args.url, {waitUntil: 'domcontentloaded', timeout: 30000});
    if (!response?.ok()) throw new Error(`Documentation returned HTTP ${response?.status() || 'unknown'}; response not saved`);
    await page.waitForTimeout(300);
    const content = await page.content();
    if (content.includes(credentials.password) || content.includes(credentials.username)) throw new Error('Response contains supplied credentials; refusing to save');
    fs.mkdirSync(path.dirname(path.resolve(args.output)), {recursive: true});
    fs.writeFileSync(args.output, content);
    writeJson(args.output + '.metadata.json', {url: args.url, status: response.status(), browser: {name: 'Microsoft Edge', channel: 'msedge', version: browser.version()}, authMechanism: 'HTTP Basic challenge; form login not tested'});
    console.log('Documentation response saved through Microsoft Edge. Verify it is documentation, not a login page.');
  } finally {await context.close(); await browser.close();}
}
main().catch(error => {console.error(safeMessage(error)); process.exitCode = 2;});
