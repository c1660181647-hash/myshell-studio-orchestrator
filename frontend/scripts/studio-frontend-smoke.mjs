#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const DEFAULT_FRONTEND_URL = 'http://127.0.0.1:5174';
const DEFAULT_TIMEOUT_MS = 15_000;
const AGE_GATE_STORAGE_KEY = 'dp_age_gate_passed';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const currentFile = fileURLToPath(import.meta.url);

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
  allowConsoleErrors = false,
}) {
  const failures = checks.filter((check) => !check.ok);
  const blockingConsoleErrors = allowConsoleErrors ? [] : consoleErrors;
  return {
    status: failures.length || blockingConsoleErrors.length ? 'failed' : 'ok',
    checkedAt,
    frontendUrl,
    screenshotPath,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.ok).length,
      failed: failures.length,
      consoleErrors: consoleErrors.length,
    },
    checks,
    failures,
    consoleErrors,
  };
}

function parseArgs(argv) {
  const args = {
    frontendUrl: process.env.STUDIO_FRONTEND_URL || DEFAULT_FRONTEND_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    screenshotPath: path.join(frontendRoot, '.studio-smoke', 'dreamy.png'),
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
    } else if (arg === '--screenshot') {
      args.screenshotPath = next;
      index += 1;
    } else if (arg === '--no-screenshot') {
      args.screenshotPath = '';
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
  return args;
}

function usage() {
  return [
    'Usage: node scripts/studio-frontend-smoke.mjs [options]',
    '',
    'Options:',
    '  --url, --frontend-url <url>   Frontend dev/preview URL. Default: STUDIO_FRONTEND_URL or http://127.0.0.1:5174',
    '  --timeout-ms <ms>             Per-check timeout. Default: 15000',
    '  --screenshot <path>           Screenshot path. Default: frontend/.studio-smoke/dreamy.png',
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
    await locator.first().click();
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

export async function runStudioFrontendSmoke(options = {}) {
  const frontendUrl = options.frontendUrl || DEFAULT_FRONTEND_URL;
  const smokeUrl = buildStudioSmokeUrl(frontendUrl);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const checks = [];
  const consoleErrors = [];
  const browser = await chromium.launch({ headless: !options.headed });

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(createStudioSmokeInitScript());
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto(smokeUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);

    await checkVisible(checks, page, 'studio-title', 'Dreamy Studio title', page.getByText('Dreamy Studio').first(), timeoutMs);

    const canvasButton = page.getByRole('button', { name: /switch studio mode to canvas/i });
    if (await canvasButton.count()) {
      await canvasButton.first().click().catch(() => undefined);
    }

    await checkVisible(checks, page, 'canvas-mode', 'Canvas mode indicator', page.getByText('Canvas').first(), timeoutMs);
    await checkVisible(checks, page, 'layers-panel', 'Layers & Agents panel', page.getByText('Layers & Agents'), timeoutMs);
    await checkVisible(checks, page, 'inspector-panel', 'Inspector panel', page.getByText('Inspector'), timeoutMs);
    await checkVisible(checks, page, 'canvas-generate', 'Canvas generate control', page.getByRole('button', { name: /generate/i }), timeoutMs);
    await checkVisible(checks, page, 'footer-evidence', 'Evidence footer control', page.getByRole('button', { name: /evidence/i }), timeoutMs);
    await checkVisible(checks, page, 'footer-plan-remaining', 'Plan remaining footer control', page.getByRole('button', { name: /plan remaining/i }), timeoutMs);
    await checkVisible(checks, page, 'footer-start-queue', 'Start queue footer control', page.getByRole('button', { name: /start queue/i }), timeoutMs);

    await clickVisible(checks, page, 'open-evidence-drawer', 'Open evidence drawer', page.getByRole('button', { name: /evidence/i }), timeoutMs);
    await checkVisible(checks, page, 'delivery-evidence', 'Delivery Evidence drawer', page.getByText('Delivery Evidence'), timeoutMs);
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

    if (options.screenshotPath) {
      await fs.mkdir(path.dirname(options.screenshotPath), { recursive: true });
      await page.screenshot({ path: options.screenshotPath, fullPage: true });
    }
  } finally {
    await browser.close();
  }

  return createSmokeSummary({
    frontendUrl: smokeUrl,
    checks,
    consoleErrors,
    screenshotPath: options.screenshotPath || '',
    allowConsoleErrors: options.allowConsoleErrors,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const summary = await runStudioFrontendSmoke(args);
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
