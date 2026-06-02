import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStudioSmokeUrl,
  createStudioSmokeInitScript,
  createSmokeSummary,
  normalizeFrontendBaseUrl,
  REQUIRED_STUDIO_CHECK_IDS,
  runStudioFrontendSmoke,
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
    workspaceScreenshotPath: '/tmp/dreamy-workspace.png',
    evidenceScreenshotPath: '/tmp/dreamy-evidence.png',
  });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.screenshotPath, '/tmp/dreamy-evidence.png');
  assert.deepEqual(summary.screenshots, {
    workspace: '/tmp/dreamy-workspace.png',
    evidence: '/tmp/dreamy-evidence.png',
  });
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

test('createSmokeSummary fails when required dispatch queue interaction checks are missing', () => {
  const requiredDispatchChecks = [
    'dispatch-batch-planned',
    'dispatch-session-started',
    'dispatch-next-target-ready',
    'dispatch-navigation-target-selected',
    'dispatch-selected-batch-planned',
    'dispatch-selected-session-started',
    'dispatch-target-opened',
    'studio-return-dock-visible',
    'studio-return-restored',
    'dispatch-target-visited',
  ];
  for (const id of requiredDispatchChecks) {
    assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes(id), `${id} should be required`);
  }
  const summary = createSmokeSummary({
    frontendUrl: 'http://127.0.0.1:5174',
    checkedAt: '2026-06-02T00:00:00.000Z',
    checks: [{ id: 'studio-title', label: 'Studio title', ok: true }],
    requiredCheckIds: requiredDispatchChecks,
  });

  assert.equal(summary.status, 'failed');
  assert.deepEqual(
    summary.failures.map((failure) => failure.id),
    requiredDispatchChecks,
  );
});

test('runStudioFrontendSmoke records the delivery command center surface', () => {
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('delivery-command-center'));
  assert.match(runStudioFrontendSmoke.toString(), /delivery-command-center/);
});

test('runStudioFrontendSmoke records starter presets and direct preset generation', () => {
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('starter-presets'));
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('ai-recommendation-agent'));
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('ai-recommendation-run'));
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('starter-visual-recommendations'));
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('starter-bot-preview-image'));
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('starter-preset-direct-generate'));
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('starter-preset-prompt-ready'));
  assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes('starter-preset-result-visible'));
  assert.match(runStudioFrontendSmoke.toString(), /starter-presets/);
  assert.match(runStudioFrontendSmoke.toString(), /ai-recommendation-agent/);
  assert.match(runStudioFrontendSmoke.toString(), /ai-recommendation-run/);
  assert.match(runStudioFrontendSmoke.toString(), /starter-visual-recommendations/);
  assert.match(runStudioFrontendSmoke.toString(), /starter-bot-preview-image/);
  assert.match(runStudioFrontendSmoke.toString(), /starter-preset-direct-generate/);
  assert.match(runStudioFrontendSmoke.toString(), /starter-preset-prompt-ready/);
  assert.match(runStudioFrontendSmoke.toString(), /starter-preset-result-visible/);
  assert.doesNotMatch(runStudioFrontendSmoke.toString(), /getByDisplayValue/);
});

test('runStudioFrontendSmoke records canvas flow and segment export controls', () => {
  const newWorkflowChecks = [
    'preview-segment-rerun',
    'preview-export-all-segments',
    'video-fast-status',
    'canvas-auto-flow-presets',
    'canvas-material-flow-ready',
  ];
  for (const id of newWorkflowChecks) {
    assert.ok(REQUIRED_STUDIO_CHECK_IDS.includes(id), `${id} should be required`);
    assert.match(runStudioFrontendSmoke.toString(), new RegExp(id));
  }
});
