#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const DEFAULT_FRONTEND_URL = 'http://127.0.0.1:5174';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_GLOBAL_TIMEOUT_MS = 180_000;
const AGE_GATE_STORAGE_KEY = 'dp_age_gate_passed';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const currentFile = fileURLToPath(import.meta.url);

export const REQUIRED_STUDIO_CHECK_IDS = Object.freeze([
  'studio-title',
  'ai-recommendation-agent',
  'ai-recommendation-run',
  'starter-presets',
  'starter-visual-recommendations',
  'starter-bot-preview-image',
  'starter-bot-preview-real',
  'all-bot-previews',
  'all-bot-preview-card',
  'all-bot-preview-image',
  'starter-preset-direct-generate',
  'starter-preset-prompt-ready',
  'starter-preset-result-visible',
  'preview-segment-rerun',
  'preview-export-all-segments',
  'timeline-export-created',
  'timeline-export-output-card',
  'video-fast-status',
  'canvas-mode',
  'canvas-auto-flow-presets',
  'canvas-material-flow-ready',
  'layers-panel',
  'inspector-panel',
  'canvas-generate',
  'footer-evidence',
  'footer-plan-remaining',
  'footer-start-queue',
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
  'open-evidence-drawer',
  'delivery-evidence',
  'delivery-command-center',
  'page-selector',
  'agent-selector',
  'page-registry',
  'dispatch-matrix',
  'dispatch-queue',
  'audit-json',
  'no-error-boundary',
]);

export function normalizeFrontendBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) throw new Error('Frontend URL is required');
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Frontend URL must be http or https: ${trimmed}`);
  }
  parsed.hash = '';
  if (parsed.pathname === '/' && !parsed.search) return parsed.origin;
  return parsed.toString().replace(/\/$/, '');
}

export function buildStudioSmokeUrl(frontendUrl) {
  const normalized = normalizeFrontendBaseUrl(frontendUrl);
  const url = new URL(normalized);
  if (!url.pathname || url.pathname === '/') url.pathname = '/';
  url.searchParams.set('test_route', 'dreamy');
  return url.toString();
}

export function createStudioSmokeInitScript() {
  return `
    try {
      window.localStorage.setItem('${AGE_GATE_STORAGE_KEY}', '1');
    } catch {}
  `;
}

export function createSmokeSummary({
  frontendUrl,
  checkedAt = new Date().toISOString(),
  checks = [],
  consoleErrors = [],
  screenshotPath = '',
  workspaceScreenshotPath = '',
  evidenceScreenshotPath = '',
  allowConsoleErrors = false,
  requiredCheckIds = [],
}) {
  const recordedCheckIds = new Set(checks.map((check) => check.id));
  const missingRequiredChecks = requiredCheckIds
    .filter((id) => !recordedCheckIds.has(id))
    .map((id) => ({
      id,
      label: `Required smoke check: ${id}`,
      ok: false,
      message: 'Required smoke check was not recorded',
    }));
  const allChecks = [...checks, ...missingRequiredChecks];
  const failures = allChecks.filter((check) => !check.ok);
  const blockingConsoleErrors = allowConsoleErrors ? [] : consoleErrors;
  const evidenceScreenshot = evidenceScreenshotPath || screenshotPath;
  const workspaceScreenshot = workspaceScreenshotPath || '';
  return {
    status: failures.length || blockingConsoleErrors.length ? 'failed' : 'ok',
    checkedAt,
    frontendUrl,
    screenshotPath: evidenceScreenshot || workspaceScreenshot || screenshotPath,
    screenshots: {
      workspace: workspaceScreenshot,
      evidence: evidenceScreenshot,
    },
    summary: {
      total: allChecks.length,
      passed: allChecks.filter((check) => check.ok).length,
      failed: failures.length,
      consoleErrors: consoleErrors.length,
    },
    checks: allChecks,
    failures,
    consoleErrors,
  };
}

function parseArgs(argv) {
  const defaultScreenshotDir = path.join(frontendRoot, '.studio-smoke');
  const defaultEvidenceScreenshot = path.join(defaultScreenshotDir, 'dreamy-evidence.png');
  const args = {
    frontendUrl: process.env.STUDIO_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    globalTimeoutMs: Number(process.env.STUDIO_FRONTEND_SMOKE_GLOBAL_TIMEOUT_MS || DEFAULT_GLOBAL_TIMEOUT_MS),
    screenshotPath: defaultEvidenceScreenshot,
    workspaceScreenshotPath: path.join(defaultScreenshotDir, 'dreamy-workspace.png'),
    evidenceScreenshotPath: defaultEvidenceScreenshot,
    reportPath: process.env.STUDIO_FRONTEND_SMOKE_REPORT || '',
    allowConsoleErrors: false,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--url' || arg === '--frontend-url') {
      args.frontendUrl = next;
      index += 1;
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(next);
      index += 1;
    } else if (arg === '--global-timeout-ms') {
      args.globalTimeoutMs = Number(next);
      index += 1;
    } else if (arg === '--screenshot') {
      args.screenshotPath = next;
      args.evidenceScreenshotPath = next;
      index += 1;
    } else if (arg === '--workspace-screenshot') {
      args.workspaceScreenshotPath = next;
      index += 1;
    } else if (arg === '--evidence-screenshot') {
      args.evidenceScreenshotPath = next;
      args.screenshotPath = next;
      index += 1;
    } else if (arg === '--report') {
      args.reportPath = next;
      index += 1;
    } else if (arg === '--no-screenshot') {
      args.screenshotPath = '';
      args.workspaceScreenshotPath = '';
      args.evidenceScreenshotPath = '';
    } else if (arg === '--allow-console-errors') {
      args.allowConsoleErrors = true;
    } else if (arg === '--headed') {
      args.headed = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }
  if (!Number.isFinite(args.globalTimeoutMs) || args.globalTimeoutMs <= 0) {
    throw new Error('--global-timeout-ms must be a positive number');
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/studio-frontend-smoke.mjs [options]',
    '',
    'Options:',
    '  --url, --frontend-url <url>   Frontend dev/preview URL. Default: STUDIO_FRONTEND_URL or http://127.0.0.1:5174',
  '  --timeout-ms <ms>             Per-check timeout. Default: 15000',
  '  --global-timeout-ms <ms>      Whole smoke timeout. Default: 180000',
    '  --screenshot <path>           Legacy alias for --evidence-screenshot',
    '  --workspace-screenshot <path> Canvas workspace screenshot path',
    '  --evidence-screenshot <path>  Delivery Evidence drawer screenshot path',
    '  --report <path>               Write the full smoke JSON report to a file',
    '  --no-screenshot               Skip screenshot capture',
    '  --allow-console-errors        Record console errors without failing the smoke',
    '  --headed                      Launch a visible browser',
  ].join('\n');
}

async function checkVisible(checks, page, id, label, locator, timeoutMs) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
    checks.push({ id, label, ok: true });
  } catch (error) {
    checks.push({
      id,
      label,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function clickVisible(checks, page, id, label, locator, timeoutMs) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
    await locator.first().click({ timeout: timeoutMs });
    checks.push({ id, label, ok: true });
  } catch (error) {
    checks.push({
      id,
      label,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkEnabled(checks, page, id, label, locator, timeoutMs) {
  const target = locator.first();
  const started = Date.now();
  try {
    await target.waitFor({ state: 'visible', timeout: timeoutMs });
    while (Date.now() - started < timeoutMs) {
      if (await target.isEnabled().catch(() => false)) {
        checks.push({ id, label, ok: true });
        return;
      }
      await page.waitForTimeout(100);
    }
    checks.push({ id, label, ok: false, message: 'Control did not become enabled' });
  } catch (error) {
    checks.push({
      id,
      label,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function clickEnabled(checks, page, id, label, locator, timeoutMs) {
  const target = locator.first();
  try {
    await checkEnabled(checks, page, id, label, target, timeoutMs);
    const recorded = checks.find((check) => check.id === id);
    if (!recorded?.ok) return;
    await target.click({ timeout: timeoutMs });
  } catch (error) {
    checks.push({
      id,
      label,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function captureScreenshot(page, screenshotPath) {
  if (!screenshotPath) return;
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
}

function resolveScreenshotPaths(options) {
  const evidenceScreenshotPath = options.evidenceScreenshotPath || options.screenshotPath || '';
  const workspaceScreenshotPath = options.workspaceScreenshotPath || '';
  return {
    workspaceScreenshotPath,
    evidenceScreenshotPath,
    screenshotPath: evidenceScreenshotPath || workspaceScreenshotPath || options.screenshotPath || '',
  };
}

export async function runStudioFrontendSmoke(options = {}) {
  const frontendUrl = options.frontendUrl || DEFAULT_FRONTEND_URL;
  const smokeUrl = buildStudioSmokeUrl(frontendUrl);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const screenshotPaths = resolveScreenshotPaths(options);
  const checks = [];
  const consoleErrors = [];
  const browser = await chromium.launch({ headless: !options.headed });

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(createStudioSmokeInitScript());
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location();
        consoleErrors.push([message.text(), location.url].filter(Boolean).join(' @ '));
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto(smokeUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);

    await checkVisible(checks, page, 'studio-title', 'Dreamy Studio title', page.getByText('Dreamy Studio').first(), timeoutMs);
    await checkVisible(
      checks,
      page,
      'ai-recommendation-agent',
      'AI recommendation agent',
      page.getByTestId('ai-recommendation-agent'),
      timeoutMs,
    );
    await checkEnabled(
      checks,
      page,
      'ai-recommendation-run',
      'AI recommendation can run directly',
      page.getByTestId('ai-recommendation-run'),
      timeoutMs,
    );
    await checkVisible(checks, page, 'starter-presets', 'Starter presets', page.getByTestId('starter-presets'), timeoutMs);
    await checkVisible(
      checks,
      page,
      'starter-visual-recommendations',
      'Visual bot recommendations',
      page.getByTestId('starter-visual-recommendations'),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'starter-bot-preview-image',
      'Starter bot preview images',
      page.getByTestId('starter-bot-preview-image').first(),
      timeoutMs,
    );
    await checkVisible(checks, page, 'all-bot-previews', 'All connected bot previews', page.getByTestId('all-bot-previews'), timeoutMs);
    await checkVisible(
      checks,
      page,
      'all-bot-preview-card',
      'All connected bot preview cards',
      page.getByTestId('all-bot-preview-card').first(),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'all-bot-preview-image',
      'All connected bot preview images',
      page.getByTestId('all-bot-preview-image').first(),
      timeoutMs,
    );
    try {
      const previewImage = page.getByTestId('starter-bot-preview-image').first();
      await previewImage.waitFor({ state: 'visible', timeout: timeoutMs });
      const previewSource = (await previewImage.getAttribute('src')) || '';
      checks.push({
        id: 'starter-bot-preview-real',
        label: 'Starter bot preview uses generated MyShell media',
        ok: /\/generated\/bot-previews\//i.test(previewSource),
        message: /\/generated\/bot-previews\//i.test(previewSource)
          ? undefined
          : `Preview source is not a generated MyShell asset: ${previewSource}`,
      });
    } catch (error) {
      checks.push({
        id: 'starter-bot-preview-real',
        label: 'Starter bot preview uses generated MyShell media',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await clickEnabled(
      checks,
      page,
      'starter-preset-direct-generate',
      'Run starter preset directly',
      page.getByRole('button', { name: /generate cinematic portrait preset/i }),
      timeoutMs,
    );
    const chatLog = page.getByTestId('studio-chat-log');
    await checkVisible(
      checks,
      page,
      'starter-preset-prompt-ready',
      'Starter preset prompt is sent',
      chatLog.getByText(/cinematic neon rain portrait/i),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'starter-preset-result-visible',
      'Starter preset generation returns a Studio result',
      chatLog.getByText(/Segment is running in Dreamy|Segment is ready|client execution needs attention|Dreamy Miniapp needs Telegram auth/i),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'preview-segment-rerun',
      'Single segment rerun control',
      page.getByTestId('preview-segment-rerun'),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'preview-export-all-segments',
      'Export all segments control',
      page.getByTestId('preview-export-all-segments'),
      timeoutMs,
    );
    await clickEnabled(
      checks,
      page,
      'timeline-export-click',
      'Create backend timeline export',
      page.getByTestId('preview-export-all-segments'),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'timeline-export-created',
      'Timeline export result is visible',
      chatLog.getByText(/Timeline export/i),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'timeline-export-output-card',
      'Timeline export output card',
      page.getByTestId('timeline-export-output-card'),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'video-fast-status',
      'Fast video handoff status',
      page.getByTestId('video-fast-status'),
      timeoutMs,
    );

    const canvasButton = page.getByRole('button', { name: /switch studio mode to canvas/i });
    if (await canvasButton.count()) {
      await canvasButton.first().click().catch(() => undefined);
    }

    await checkVisible(checks, page, 'canvas-mode', 'Canvas mode indicator', page.getByText('Canvas').first(), timeoutMs);
    await checkVisible(
      checks,
      page,
      'canvas-auto-flow-presets',
      'Canvas auto flow presets',
      page.getByTestId('canvas-auto-flow-presets'),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'canvas-material-flow-ready',
      'Canvas material flow ready state',
      page.getByTestId('canvas-material-flow-ready'),
      timeoutMs,
    );
    await checkVisible(checks, page, 'layers-panel', 'Layers & Agents panel', page.getByText('Layers & Agents'), timeoutMs);
    await checkVisible(checks, page, 'inspector-panel', 'Inspector panel', page.getByText('Inspector'), timeoutMs);
    await checkVisible(checks, page, 'canvas-generate', 'Canvas generate control', page.getByRole('button', { name: /generate/i }), timeoutMs);
    await checkVisible(checks, page, 'footer-evidence', 'Evidence footer control', page.getByRole('button', { name: /evidence/i }), timeoutMs);
    await checkVisible(checks, page, 'footer-plan-remaining', 'Plan remaining footer control', page.getByRole('button', { name: /plan remaining/i }), timeoutMs);
    await checkVisible(checks, page, 'footer-start-queue', 'Start queue footer control', page.getByRole('button', { name: /start queue/i }), timeoutMs);
    await captureScreenshot(page, screenshotPaths.workspaceScreenshotPath);

    await clickVisible(checks, page, 'open-evidence-drawer', 'Open evidence drawer', page.getByRole('button', { name: /evidence/i }), timeoutMs);
    await checkVisible(checks, page, 'delivery-evidence', 'Delivery Evidence drawer', page.getByText('Delivery Evidence'), timeoutMs);
    await checkVisible(checks, page, 'delivery-command-center', 'Delivery command center', page.getByTestId('delivery-command-center'), timeoutMs);
    await clickVisible(
      checks,
      page,
      'dispatch-navigation-target-selected',
      'Select Explore navigation target',
      page.getByLabel(/include explore in selected dispatch batch/i),
      timeoutMs,
    );
    await clickEnabled(checks, page, 'dispatch-plan-selected-click', 'Click Plan Selected', page.getByRole('button', { name: /plan selected/i }), timeoutMs);
    await checkVisible(checks, page, 'dispatch-batch-planned', 'Dispatch batch planned', page.getByText(/Batch (ready|planned)/i), timeoutMs);
    await checkEnabled(checks, page, 'dispatch-selected-batch-planned', 'Selected dispatch batch planned', page.getByRole('button', { name: /start selected/i }), timeoutMs);
    await clickEnabled(checks, page, 'dispatch-start-selected-click', 'Click Start Selected', page.getByRole('button', { name: /start selected/i }), timeoutMs);
    await checkVisible(checks, page, 'dispatch-session-started', 'Dispatch session started', page.getByText(/Queue active/i), timeoutMs);
    await checkVisible(checks, page, 'dispatch-selected-session-started', 'Selected dispatch session started', page.getByText(/Queue active/i), timeoutMs);
    await checkEnabled(checks, page, 'dispatch-next-target-ready', 'Next dispatch target is ready', page.getByRole('button', { name: /open next|run next/i }), timeoutMs);
    await clickEnabled(checks, page, 'dispatch-open-next-click', 'Click Open Next', page.getByRole('button', { name: /open next/i }), timeoutMs);
    await checkVisible(checks, page, 'dispatch-target-opened', 'Dispatch target page opened', page.getByRole('button', { name: /return to studio/i }), timeoutMs);
    await checkVisible(checks, page, 'studio-return-dock-visible', 'Studio return dock is visible', page.getByRole('button', { name: /return to studio/i }), timeoutMs);
    await clickVisible(checks, page, 'studio-return-click', 'Click Return to Studio', page.getByRole('button', { name: /return to studio/i }), timeoutMs);
    await checkVisible(checks, page, 'studio-return-restored', 'Studio restored after target navigation', page.getByText('Dreamy Studio').first(), timeoutMs);
    await clickVisible(checks, page, 'reopen-evidence-drawer', 'Reopen evidence drawer after return', page.getByRole('button', { name: /evidence/i }), timeoutMs);
    await checkVisible(checks, page, 'dispatch-target-visited', 'Dispatch target marked visited after return', page.getByText(/Focus Explore visited|1 visited/i), timeoutMs);
    await checkVisible(checks, page, 'page-selector', 'Page selector', page.getByLabel('Studio page adapter').last(), timeoutMs);
    await checkVisible(checks, page, 'agent-selector', 'Agent selector', page.getByLabel('Studio agent').last(), timeoutMs);
    await checkVisible(checks, page, 'page-registry', 'Page Registry section', page.getByText('Page Registry'), timeoutMs);
    await checkVisible(checks, page, 'dispatch-matrix', 'Dispatch Matrix section', page.getByText('Dispatch Matrix'), timeoutMs);
    await checkVisible(checks, page, 'dispatch-queue', 'Dispatch Queue section', page.getByText('Dispatch Queue'), timeoutMs);
    await checkVisible(checks, page, 'audit-json', 'Audit JSON action', page.getByRole('button', { name: /audit json/i }), timeoutMs);

    const errorBoundary = page.getByText('Something went wrong');
    checks.push({
      id: 'no-error-boundary',
      label: 'No React error boundary',
      ok: (await errorBoundary.count()) === 0,
      message: (await errorBoundary.count()) === 0 ? undefined : 'React error boundary is visible',
    });

    await captureScreenshot(page, screenshotPaths.evidenceScreenshotPath);
  } finally {
    await browser.close();
  }

  return createSmokeSummary({
    frontendUrl: smokeUrl,
    checks,
    consoleErrors,
    screenshotPath: screenshotPaths.screenshotPath,
    workspaceScreenshotPath: screenshotPaths.workspaceScreenshotPath,
    evidenceScreenshotPath: screenshotPaths.evidenceScreenshotPath,
    allowConsoleErrors: options.allowConsoleErrors,
    requiredCheckIds: REQUIRED_STUDIO_CHECK_IDS,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  let globalTimer;
  const summary = await Promise.race([
    runStudioFrontendSmoke(args),
    new Promise((_, reject) => {
      globalTimer = setTimeout(
        () => reject(new Error(`Studio frontend smoke exceeded ${args.globalTimeoutMs}ms global timeout`)),
        args.globalTimeoutMs,
      );
    }),
  ]).finally(() => {
    if (globalTimer) clearTimeout(globalTimer);
  });
  if (args.reportPath) {
    await fs.mkdir(path.dirname(args.reportPath), { recursive: true });
    await fs.writeFile(args.reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== 'ok') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
