'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {launchBrowser} = require('../scripts/lib.cjs');

test('non-Edge selectors are rejected before launching any browser', async () => {
  let calls = 0;
  const runtime = {chromium: {launch: async () => {calls++;}}};
  for (const selector of ['chromium', 'firefox', 'webkit', 'chrome']) await assert.rejects(launchBrowser(selector, {url: 'http://localhost'}, runtime), /Microsoft Edge is required/);
  assert.equal(calls, 0);
});

test('Edge startup failure never causes a fallback launch', async () => {
  const calls = [];
  const runtime = {chromium: {launch: async options => {calls.push(options); throw new Error('Edge startup test failure');}}};
  await assert.rejects(launchBrowser('msedge', {url: 'http://localhost'}, runtime), /without browser substitution/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, 'msedge');
});
