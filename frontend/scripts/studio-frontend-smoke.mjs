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
  'conversation-workspace-panel',
  'bot-selection-panel',
  'bot-selection-scroll-region',
  'manual-bot-id-panel',
  'manual-bot-id-input',
  'manual-bot-sequence-list',
  'manual-bot-run-selected',
  'manual-bot-run-sequence',
  'manual-bot-sequence-run',
  'studio-chat-region',
  'studio-composer',
  'preview-workspace-panel',
  'studio-layout-no-overlap',
  'studio-left-sections-readable',
  'ai-recommendation-agent',
  'ai-recommendation-run',
  'starter-presets',
  'starter-visual-recommendations',
  'starter-bot-preview-image',
  'starter-bot-preview-asset',
  'all-bot-previews',
  'all-bot-preview-card',
  'all-bot-preview-image',
  'dreamy-bot-list-only',
  'starter-preset-selection',
  'dreamy-bot-selection-state',
  'selected-dreamy-bot-preview',
  'preview-selected-dreamy-bot',
  'starter-preset-direct-generate',
  'starter-preset-prompt-ready',
  'starter-preset-result-visible',
  'preview-segment-rerun',
  'preview-append-next-segment',
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
  'canvaspro-workspace-switch',
  'canvaspro-workspace-route',
  'canvaspro-workspace-panel',
  'canvaspro-iframe',
  'canvaspro-iframe-entry',
  'canvaspro-bridge-status',
  'canvaspro-runtime-api',
  'canvaspro-upstream-author-links-hidden',
  'canvaspro-license-disclosure-menu',
  'canvaspro-license-disclosure-dialog',
  'canvaspro-no-direct-proxy-error',
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

export const REQUIRED_CANVASPRO_CHECK_IDS = Object.freeze([
  'canvaspro-workspace-route',
  'canvaspro-workspace-panel',
  'canvaspro-iframe',
  'canvaspro-iframe-entry',
  'canvaspro-bridge-status',
  'canvaspro-runtime-api',
  'canvaspro-upstream-author-links-hidden',
  'canvaspro-license-disclosure-menu',
  'canvaspro-license-disclosure-dialog',
  'canvaspro-no-direct-proxy-error',
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
  return url.toString();
}

export function buildCanvasProSmokeUrl(frontendUrl) {
  const normalized = normalizeFrontendBaseUrl(frontendUrl);
  const url = new URL(normalized);
  url.pathname = '/dreamy';
  url.search = 'workspace=canvaspro';
  url.hash = '';
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
    browserExecutablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH || '',
    canvasproOnly: false,
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
    } else if (arg === '--browser-executable') {
      args.browserExecutablePath = next;
      index += 1;
    } else if (arg === '--canvaspro-only') {
      args.canvasproOnly = true;
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
    '  --browser-executable <path>    Chromium/Chrome executable path. Defaults to PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH',
    '  --canvaspro-only              Only verify /dreamy?workspace=canvaspro',
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

function recordedCheckOk(checks, id) {
  for (let index = checks.length - 1; index >= 0; index -= 1) {
    if (checks[index].id === id) return Boolean(checks[index].ok);
  }
  return false;
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

async function checkStudioLayoutGeometry(checks, page, timeoutMs) {
  const locators = {
    left: page.getByTestId('conversation-workspace-panel'),
    bot: page.getByTestId('bot-selection-panel'),
    chatRegion: page.getByTestId('studio-chat-region'),
    chat: page.getByTestId('studio-chat-log'),
    composer: page.getByTestId('studio-composer'),
    preview: page.getByTestId('preview-workspace-panel'),
  };
  try {
    await Promise.all(
      Object.values(locators).map((locator) => locator.first().waitFor({ state: 'visible', timeout: timeoutMs })),
    );
    const [left, bot, chatRegion, chat, composer, preview] = await Promise.all(
      Object.values(locators).map((locator) => locator.first().boundingBox()),
    );
    const missing = { left, bot, chatRegion, chat, composer, preview };
    if (!left || !bot || !chatRegion || !chat || !composer || !preview) {
      checks.push({
        id: 'studio-layout-no-overlap',
        label: 'Studio layout sections do not overlap',
        ok: false,
        message: `Missing layout box: ${Object.entries(missing)
          .filter(([, box]) => !box)
          .map(([key]) => key)
          .join(', ')}`,
      });
      return;
    }
    const failures = [];
    if (bot.y + bot.height > chatRegion.y + 1) failures.push('bot selection overlaps chat region');
    if (chatRegion.y + chatRegion.height > composer.y + 1) failures.push('chat region overlaps composer');
    if (composer.y + composer.height > left.y + left.height + 1) failures.push('composer is clipped by left panel');
    if (left.x + left.width > preview.x + 1) failures.push('left panel overlaps preview panel');
    checks.push({
      id: 'studio-layout-no-overlap',
      label: 'Studio layout sections do not overlap',
      ok: failures.length === 0,
      message: failures.length ? failures.join('; ') : undefined,
    });

    const readableFailures = [];
    const maxBotHeight = Math.min(260, Math.max(180, left.height * 0.34));
    if (bot.height > maxBotHeight + 1) readableFailures.push(`bot selection too tall (${Math.round(bot.height)}px)`);
    if (chat.height < 180) readableFailures.push(`chat log too short (${Math.round(chat.height)}px)`);
    if (composer.height < 86) readableFailures.push(`composer clipped (${Math.round(composer.height)}px)`);
    if (preview.width < left.width) readableFailures.push('right preview is narrower than left control column');
    checks.push({
      id: 'studio-left-sections-readable',
      label: 'Left Studio sections stay readable and bounded',
      ok: readableFailures.length === 0,
      message: readableFailures.length ? readableFailures.join('; ') : undefined,
    });
  } catch (error) {
    checks.push({
      id: 'studio-layout-no-overlap',
      label: 'Studio layout sections do not overlap',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
    checks.push({
      id: 'studio-left-sections-readable',
      label: 'Left Studio sections stay readable and bounded',
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

async function checkCanvasProWorkspace(checks, page, frontendUrl, consoleErrors, timeoutMs) {
  const canvasProUrl = buildCanvasProSmokeUrl(frontendUrl);
  await page.goto(canvasProUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);

  checks.push({
    id: 'canvaspro-workspace-route',
    label: 'CanvasPro opens inside the single Studio route',
    ok: page.url().includes('/dreamy') && page.url().includes('workspace=canvaspro'),
    message: page.url().includes('/dreamy') && page.url().includes('workspace=canvaspro')
      ? undefined
      : `Unexpected CanvasPro URL: ${page.url()}`,
  });
  await checkVisible(
    checks,
    page,
    'canvaspro-workspace-panel',
    'CanvasPro workspace panel',
    page.getByTestId('canvaspro-workspace-panel'),
    timeoutMs,
  );
  const iframe = page.getByTestId('canvaspro-iframe');
  await checkVisible(checks, page, 'canvaspro-iframe', 'CanvasPro iframe', iframe, timeoutMs);
  try {
    const iframeSrc = (await iframe.getAttribute('src')) || '';
    checks.push({
      id: 'canvaspro-iframe-entry',
      label: 'CanvasPro iframe uses the local Studio static mount',
      ok: /\/ai-canvaspro\/index\.html/i.test(iframeSrc),
      message: /\/ai-canvaspro\/index\.html/i.test(iframeSrc)
        ? undefined
        : `Unexpected CanvasPro iframe src: ${iframeSrc || 'empty'}`,
    });
  } catch (error) {
    checks.push({
      id: 'canvaspro-iframe-entry',
      label: 'CanvasPro iframe uses the local Studio static mount',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  await checkVisible(
    checks,
    page,
    'canvaspro-bridge-status',
    'CanvasPro bridge status chip',
    page.getByTestId('canvaspro-bridge-status'),
    timeoutMs,
  );

  try {
    const runtimeUrl = new URL('/ai-canvaspro-api/api/v2/runtime/info', normalizeFrontendBaseUrl(frontendUrl));
    const response = await page.request.get(runtimeUrl.toString(), { timeout: timeoutMs });
    checks.push({
      id: 'canvaspro-runtime-api',
      label: 'CanvasPro runtime API is reachable through Studio backend proxy',
      ok: response.status() < 500,
      message: response.status() < 500 ? undefined : `Runtime API returned HTTP ${response.status()}`,
    });
  } catch (error) {
    checks.push({
      id: 'canvaspro-runtime-api',
      label: 'CanvasPro runtime API is reachable through Studio backend proxy',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await checkCanvasProAuthorSignalPolicy(checks, page, timeoutMs);

  const directProxyError = consoleErrors.find((error) => /ECONNREFUSED.*127\.0\.0\.1:8777|127\.0\.0\.1:8777.*ECONNREFUSED/i.test(error));
  checks.push({
    id: 'canvaspro-no-direct-proxy-error',
    label: 'CanvasPro smoke does not hit the native 8777 API directly from Vite',
    ok: !directProxyError,
    message: directProxyError,
  });
}

async function checkCanvasProAuthorSignalPolicy(checks, page, timeoutMs) {
  const frame = page.frameLocator('[data-testid="canvaspro-iframe"]');
  try {
    await frame.locator('#userAvatar').waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 8000) });
    await frame.locator('#userAvatar').click({ timeout: timeoutMs });

    const menuPolicy = await frame.locator('body').evaluate(() => {
      const hiddenIds = ['btnTutorial', 'btnGithubOfficial', 'btnFeatureFeedback'];
      const visibleUpstreamIds = hiddenIds.filter((id) => {
        const element = document.getElementById(id);
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      });
      return {
        authorSignals: document.documentElement.dataset.studioCanvasproAuthorSignals || '',
        visibleUpstreamIds,
        aboutLabel: document.getElementById('btnAbout')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      };
    });

    checks.push({
      id: 'canvaspro-upstream-author-links-hidden',
      label: 'CanvasPro upstream tutorial, GitHub, and feedback links are hidden',
      ok: menuPolicy.visibleUpstreamIds.length === 0 && menuPolicy.authorSignals === 'hidden',
      message:
        menuPolicy.visibleUpstreamIds.length === 0 && menuPolicy.authorSignals === 'hidden'
          ? undefined
          : `Visible upstream ids: ${menuPolicy.visibleUpstreamIds.join(', ') || 'none'}; policy=${menuPolicy.authorSignals || 'unset'}`,
    });
    checks.push({
      id: 'canvaspro-license-disclosure-menu',
      label: 'CanvasPro About menu points to third-party license disclosure',
      ok: /第三方组件\s*\/\s*授权声明/.test(menuPolicy.aboutLabel),
      message: /第三方组件\s*\/\s*授权声明/.test(menuPolicy.aboutLabel)
        ? undefined
        : `Unexpected About label: ${menuPolicy.aboutLabel || 'empty'}`,
    });

    await frame.locator('#btnAbout').click({ timeout: timeoutMs });
    const disclosurePolicy = await frame.locator('body').evaluate(() => {
      const modal = document.getElementById('studioCanvasproLicenseModal');
      const modalVisible = Boolean(
        modal &&
          !modal.hidden &&
          modal.getAttribute('aria-hidden') === 'false' &&
          window.getComputedStyle(modal).display !== 'none' &&
          modal.getClientRects().length > 0,
      );
      const disclosureText =
        modal?.querySelector('.studio-canvaspro-license-disclosure')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const title =
        modal?.querySelector('.studio-canvaspro-license-modal-title')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const authorText = document.querySelector('#aboutOverlay .about-author')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const bilibili = document.getElementById('btnBilibili');
      const bilibiliVisible = Boolean(
        bilibili &&
          !bilibili.hidden &&
          window.getComputedStyle(bilibili).display !== 'none' &&
          bilibili.getClientRects().length > 0,
      );
      return {
        modalVisible,
        title,
        disclosureText,
        authorText,
        bilibiliVisible,
      };
    });
    const dialogOk =
      disclosurePolicy.modalVisible &&
      /第三方组件\s*\/\s*授权声明/.test(disclosurePolicy.title) &&
      /AI-CanvasPro/.test(disclosurePolicy.disclosureText) &&
      /书面授权/.test(disclosurePolicy.disclosureText) &&
      !disclosurePolicy.authorText &&
      !disclosurePolicy.bilibiliVisible;
    checks.push({
      id: 'canvaspro-license-disclosure-dialog',
      label: 'CanvasPro About dialog is replaced with third-party license disclosure',
      ok: dialogOk,
      message: dialogOk
        ? undefined
        : `modalVisible=${disclosurePolicy.modalVisible}; title=${disclosurePolicy.title || 'empty'}; hasDisclosure=${Boolean(disclosurePolicy.disclosureText)}; author=${disclosurePolicy.authorText || 'hidden'}; bilibiliVisible=${disclosurePolicy.bilibiliVisible}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      id: 'canvaspro-upstream-author-links-hidden',
      label: 'CanvasPro upstream tutorial, GitHub, and feedback links are hidden',
      ok: false,
      message,
    });
    checks.push({
      id: 'canvaspro-license-disclosure-menu',
      label: 'CanvasPro About menu points to third-party license disclosure',
      ok: false,
      message,
    });
    checks.push({
      id: 'canvaspro-license-disclosure-dialog',
      label: 'CanvasPro About dialog is replaced with third-party license disclosure',
      ok: false,
      message,
    });
  }
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
  const summaryUrl = options.canvasproOnly ? buildCanvasProSmokeUrl(frontendUrl) : smokeUrl;
  const browser = await chromium.launch({
    headless: !options.headed,
    ...(options.browserExecutablePath ? { executablePath: options.browserExecutablePath } : {}),
  });

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

    if (options.canvasproOnly) {
      await checkCanvasProWorkspace(checks, page, frontendUrl, consoleErrors, timeoutMs);
      await captureScreenshot(page, screenshotPaths.workspaceScreenshotPath || screenshotPaths.evidenceScreenshotPath);
      return createSmokeSummary({
        frontendUrl: summaryUrl,
        checks,
        consoleErrors,
        screenshotPath: screenshotPaths.screenshotPath,
        workspaceScreenshotPath: screenshotPaths.workspaceScreenshotPath,
        evidenceScreenshotPath: screenshotPaths.evidenceScreenshotPath,
        allowConsoleErrors: options.allowConsoleErrors,
        requiredCheckIds: REQUIRED_CANVASPRO_CHECK_IDS,
      });
    }

    await page.goto(smokeUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);

    await checkVisible(checks, page, 'studio-title', 'Dreamy Studio title', page.getByText('Dreamy Studio').first(), timeoutMs);
    await checkVisible(
      checks,
      page,
      'conversation-workspace-panel',
      'Left conversation workspace panel',
      page.getByTestId('conversation-workspace-panel'),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'bot-selection-panel',
      'Bot selection panel',
      page.getByTestId('bot-selection-panel'),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'bot-selection-scroll-region',
      'Bot selection scroll region',
      page.getByTestId('bot-selection-scroll-region'),
      timeoutMs,
    );
    const manualBotPanel = page.getByTestId('manual-bot-id-panel');
    await checkVisible(
      checks,
      page,
      'manual-bot-id-panel',
      'Manual bot id panel',
      manualBotPanel,
      timeoutMs,
    );
    if (recordedCheckOk(checks, 'manual-bot-id-panel')) {
      await manualBotPanel.first().evaluate((element) => {
        if (element instanceof HTMLDetailsElement) {
          element.open = true;
        }
      });
    }
    const manualBotInput = page.getByTestId('manual-bot-id-input');
    await checkVisible(checks, page, 'manual-bot-id-input', 'Manual bot id input', manualBotInput, timeoutMs);
    if (recordedCheckOk(checks, 'manual-bot-id-input')) {
      await manualBotInput.fill(
        [
          'manual_image_bot|Manual Image Bot|text-to-image|manual-image',
          'manual_video_bot|Manual Video Bot|image-to-video|manual-video',
        ].join('\n'),
      );
    }
    await checkVisible(
      checks,
      page,
      'manual-bot-sequence-list',
      'Manual bot sequence list',
      page.getByTestId('manual-bot-sequence-list'),
      timeoutMs,
    );
    await checkEnabled(
      checks,
      page,
      'manual-bot-run-selected',
      'Manual selected bot run control',
      page.getByTestId('manual-bot-run-selected'),
      timeoutMs,
    );
    const manualSequenceButton = page.getByTestId('manual-bot-run-sequence');
    await checkEnabled(checks, page, 'manual-bot-run-sequence', 'Manual bot sequence run control', manualSequenceButton, timeoutMs);
    try {
      await manualSequenceButton.click({ timeout: timeoutMs });
      await page.waitForFunction(
        () => document.body.textContent?.includes('Manual Video Bot') && document.body.textContent?.includes('Manual Image Bot'),
        undefined,
        { timeout: timeoutMs },
      );
      checks.push({
        id: 'manual-bot-sequence-run',
        label: 'Manual bot sequence creates visible chained jobs',
        ok: true,
      });
    } catch (error) {
      checks.push({
        id: 'manual-bot-sequence-run',
        label: 'Manual bot sequence creates visible chained jobs',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await checkVisible(
      checks,
      page,
      'studio-chat-region',
      'Conversation log region',
      page.getByTestId('studio-chat-region'),
      timeoutMs,
    );
    await checkVisible(checks, page, 'studio-composer', 'Studio composer', page.getByTestId('studio-composer'), timeoutMs);
    await checkVisible(
      checks,
      page,
      'preview-workspace-panel',
      'Right preview workspace panel',
      page.getByTestId('preview-workspace-panel'),
      timeoutMs,
    );
    await checkStudioLayoutGeometry(checks, page, timeoutMs);
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
      const usesGeneratedPreview = /\/generated\/bot-previews\//i.test(previewSource);
      const usesDreamyCatalogPreview = /^https?:\/\/placehold\.co\//i.test(previewSource);
      checks.push({
        id: 'starter-bot-preview-asset',
        label: 'Starter bot preview uses generated or Dreamy catalog media asset',
        ok: usesGeneratedPreview || usesDreamyCatalogPreview,
        message: usesGeneratedPreview || usesDreamyCatalogPreview
          ? undefined
          : `Preview source is not a generated or Dreamy catalog asset: ${previewSource}`,
      });
    } catch (error) {
      checks.push({
        id: 'starter-bot-preview-asset',
        label: 'Starter bot preview uses generated or Dreamy catalog media asset',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      const botCardTexts = await page.getByTestId('all-bot-preview-card').evaluateAll((cards) =>
        cards.map((card) => (card.textContent || '').replace(/\s+/g, ' ').trim()),
      );
      const hasArtBot = botCardTexts.some((text) => /Seedream|Sora|Kling|Brat|Neon Art/i.test(text));
      checks.push({
        id: 'dreamy-bot-list-only',
        label: 'Connected bot list is scoped to Dreamy bots',
        ok: botCardTexts.length >= 3 && botCardTexts.some((text) => /Aurora Dusk/i.test(text)) && !hasArtBot,
        message: hasArtBot
          ? `Art bot leaked into Dreamy list: ${botCardTexts.join(' | ')}`
          : botCardTexts.length < 3
            ? `Expected multiple Dreamy bot cards, saw ${botCardTexts.length}`
            : undefined,
      });
    } catch (error) {
      checks.push({
        id: 'dreamy-bot-list-only',
        label: 'Connected bot list is scoped to Dreamy bots',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await clickEnabled(
      checks,
      page,
      'starter-preset-selection',
      'Select Dreamy bot card',
      page.getByTestId('all-bot-preview-card').filter({ hasText: 'Aurora Dusk' }),
      timeoutMs,
    );
    try {
      const selectedSlug = await page.getByTestId('dreamy-studio-root').getAttribute('data-selected-bot-slug');
      checks.push({
        id: 'dreamy-bot-selection-state',
        label: 'Selected Dreamy bot slug drives Studio state',
        ok: selectedSlug === 'aurora-dusk',
        message: selectedSlug === 'aurora-dusk' ? undefined : `Selected slug was ${selectedSlug || 'empty'}`,
      });
    } catch (error) {
      checks.push({
        id: 'dreamy-bot-selection-state',
        label: 'Selected Dreamy bot slug drives Studio state',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await checkVisible(
      checks,
      page,
      'selected-dreamy-bot-preview',
      'Selected Dreamy bot handoff preview',
      page.getByTestId('selected-dreamy-bot-preview'),
      timeoutMs,
    );
    await checkVisible(
      checks,
      page,
      'preview-selected-dreamy-bot',
      'Right preview follows selected Dreamy bot',
      page.getByTestId('preview-selected-dreamy-bot'),
      timeoutMs,
    );
    await clickEnabled(
      checks,
      page,
      'starter-preset-direct-generate',
      'Run selected starter preset',
      page.getByTestId('starter-preset-direct-generate'),
      timeoutMs,
    );
    const chatLog = page.getByTestId('studio-chat-log');
    await checkVisible(
      checks,
      page,
      'starter-preset-prompt-ready',
      'Starter preset prompt is sent',
      chatLog.getByText(/full body character scene|Animate the selected Dreamy source image|cinematic neon rain portrait/i),
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
      'preview-append-next-segment',
      'Append next segment control',
      page.getByTestId('preview-append-next-segment'),
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
    await checkVisible(
      checks,
      page,
      'canvaspro-workspace-switch',
      'CanvasPro workspace switch',
      page.getByTestId('canvaspro-workspace-switch'),
      timeoutMs,
    );
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
    await checkCanvasProWorkspace(checks, page, frontendUrl, consoleErrors, timeoutMs);
  } finally {
    await browser.close();
  }

  return createSmokeSummary({
    frontendUrl: summaryUrl,
    checks,
    consoleErrors,
    screenshotPath: screenshotPaths.screenshotPath,
    workspaceScreenshotPath: screenshotPaths.workspaceScreenshotPath,
    evidenceScreenshotPath: screenshotPaths.evidenceScreenshotPath,
    allowConsoleErrors: options.allowConsoleErrors,
    requiredCheckIds: options.canvasproOnly ? REQUIRED_CANVASPRO_CHECK_IDS : REQUIRED_STUDIO_CHECK_IDS,
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
