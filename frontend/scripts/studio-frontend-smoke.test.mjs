import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStudioSmokeUrl,
  createStudioSmokeInitScript,
  createSmokeSummary,
  normalizeFrontendBaseUrl,
} from './studio-frontend-smoke.mjs';

test('buildStudioSmokeUrl opens the Dreamy test route from a bare dev server URL', () => {
  assert.equal(
    buildStudioSmokeUrl('http://127.0.0.1:5174'),
    'http://127.0.0.1:5174/?test_route=dreamy',
  );
});

test('normalizeFrontendBaseUrl trims trailing slash and rejects missing URL', () => {
  assert.equal(normalizeFrontendBaseUrl(' http://localhost:5174/ '), 'http://localhost:5174');
  assert.throws(() => normalizeFrontendBaseUrl(''), /frontend URL is required/i);
});

test('createSmokeSummary records checked UI surfaces and console errors', () => {
  const summary = createSmokeSummary({
    frontendUrl: 'http://127.0.0.1:5174',
    checkedAt: '2026-06-02T00:00:00.000Z',
    checks: [
      { id: 'title', label: 'Studio title', ok: true },
      { id: 'evidence', label: 'Evidence drawer', ok: false, message: 'not visible' },
    ],
    consoleErrors: ['boom'],
    screenshotPath: '/tmp/dreamy.png',
  });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.summary.total, 2);
  assert.equal(summary.summary.passed, 1);
  assert.equal(summary.summary.failed, 1);
  assert.equal(summary.failures[0].id, 'evidence');
  assert.equal(summary.consoleErrors.length, 1);
});

test('createStudioSmokeInitScript bypasses the production age gate for smoke runs', () => {
  const script = createStudioSmokeInitScript();

  assert.match(script, /dp_age_gate_passed/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /'1'/);
});
