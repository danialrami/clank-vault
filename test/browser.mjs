import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { chromium as playwrightChromium } from 'playwright';
import { verifyReplay } from '../dist/src/engine.js';
import { createServer } from '../dist/src/server.js';

async function browserLaunchOptions() {
  if (process.env.CHROMIUM_PATH) {
    return { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'], headless: true };
  }
  try {
    const imported = await import('@sparticuz/chromium');
    const chromium = imported.default;
    const executablePath = await chromium.executablePath();
    return { executablePath, args: chromium.args, headless: true };
  } catch (error) {
    const executablePath = playwrightChromium.executablePath();
    return { executablePath, args: [], headless: true, fallbackError: error };
  }
}

const pendingDeadlines = new Set();
const clock = {
  setTimeout(callback) { pendingDeadlines.add(callback); return callback; },
  clearTimeout(handle) { pendingDeadlines.delete(handle); },
};
const app = createServer({ turnTimeoutMs: 10_000, clock });
let browser;
try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const options = await browserLaunchOptions();
  try {
    browser = await playwrightChromium.launch({ executablePath: options.executablePath, args: options.args, headless: true });
  } catch (error) {
    const detail = options.fallbackError instanceof Error ? `; Sparticuz lookup also failed: ${options.fallbackError.message}` : '';
    throw new Error(`No usable Chromium browser. Set CHROMIUM_PATH or install @sparticuz/chromium/Playwright browsers: ${error instanceof Error ? error.message : String(error)}${detail}`);
  }
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText ?? 'failed';
    // EventSource.close() deliberately cancels its long-lived HTTP request when
    // a terminal snapshot has been rendered. Other cancellations still fail.
    if (request.url().endsWith('/stream') && error === 'net::ERR_ABORTED') return;
    failedRequests.push(`${request.method()} ${request.url()}: ${error}`);
  });

  await page.goto(address, { waitUntil: 'networkidle' });
  await page.getByText('Board game only').waitFor();
  assert.equal(await page.locator('.node').count(), 5);
  await page.locator('#preset').selectOption('max');
  assert.deepEqual(await page.locator('[data-budget]').allTextContents(), ['4 / 4 defense points', '4 / 4 defense points']);
  await page.locator('#preset').selectOption('open');
  await page.locator('#note-a').fill('Browser private coaching note');
  await page.locator('#raider-a').selectOption('direct');

  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/matches') && response.request().method() === 'POST');
  await page.locator('#start').click();
  const createResponse = await createResponsePromise;
  assert.equal(createResponse.status(), 201);
  const created = await createResponse.json();
  const firstId = created.data.id;
  assert(firstId);
  await page.locator('#match-status').filter({ hasText: 'COMPLETED' }).waitFor();
  await page.locator('#series-outcome').filter({ hasText: 'Series complete' }).waitFor();
  assert.match(await page.locator('#stats').innerText(), /HP \d/u);
  assert.match(await page.locator('#stats').innerText(), /Tools \d/u);
  assert.match(await page.locator('#match-status').innerText(), /Seat [AB] raids/u);
  assert((await page.locator('#revelations li').count()) > 1);
  assert.equal(await page.locator('#load-replay').isEnabled(), true);

  await page.locator('#load-replay').click();
  await page.locator('#replay-viewer').waitFor({ state: 'visible' });
  const beforeCounter = await page.locator('#replay-counter').innerText();
  assert.match(beforeCounter, /Beat 1/u);
  if (await page.locator('#replay-next').isEnabled()) {
    await page.locator('#replay-next').click();
    assert.notEqual(await page.locator('#replay-counter').innerText(), beforeCounter);
  }
  assert.match(await page.locator('#replay-proof').innerText(), /SHA-256/u);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-replay').click();
  const download = await downloadPromise;
  const path = await download.path();
  assert(path);
  const downloadedReplay = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(verifyReplay(downloadedReplay).ok, true);
  assert(!JSON.stringify(downloadedReplay).includes('Browser private coaching note'));

  await page.locator('#sentinel-a').selectOption('pursuit');
  await page.locator('#note-a').fill('Changed for rematch');
  const rematchRequestPromise = page.waitForRequest((request) => request.url().includes('/rematch') && request.method() === 'POST');
  const rematchResponsePromise = page.waitForResponse((response) => response.url().includes('/rematch') && response.request().method() === 'POST');
  await page.locator('#rematch').click();
  const [rematchRequest, rematchResponse] = await Promise.all([rematchRequestPromise, rematchResponsePromise]);
  assert.equal(rematchResponse.status(), 201);
  const rematchBody = await rematchResponse.json();
  assert.notEqual(rematchBody.data.id, firstId);
  const rematchPayload = rematchRequest.postDataJSON();
  assert.equal(rematchPayload.config.coaching.A, 'Changed for rematch');
  assert.equal(rematchPayload.config.styles.A.sentinel, 'pursuit');
  await page.locator('#match-status').filter({ hasText: 'COMPLETED' }).waitFor();

  await page.locator('summary').click();
  await page.getByText('clank-vault observe').waitFor();
  assert.match(await page.locator('details').innerText(), /unverified\/null/u);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#load-replay').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#load-replay').isVisible(), true);
  await page.locator('#load-replay').click();
  await page.locator('#replay-viewer').waitFor({ state: 'visible' });
  const boardBox = await page.locator('#board').boundingBox();
  assert(boardBox && boardBox.x >= 0 && boardBox.x + boardBox.width <= 390, 'mobile board must fit viewport');
  assert.equal(await page.locator('#rematch').isVisible(), true);

  // A timeout before the first move is a valid zero-turn replay, not a UI crash.
  await page.locator('#mode-a').selectOption('external');
  await page.locator('#mode-b').selectOption('external');
  const pendingCreation = page.waitForResponse((response) => response.url().endsWith('/api/matches') && response.request().method() === 'POST');
  await page.locator('#start').click();
  const pendingCreated = await (await pendingCreation).json();
  assert.equal(pendingCreated.data.view.phase, 'active');
  await page.locator('#match-status').filter({ hasText: 'ACTIVE' }).waitFor();
  for (const callback of [...pendingDeadlines]) { pendingDeadlines.delete(callback); callback(); }
  await page.locator('#match-status').filter({ hasText: 'ABORTED' }).waitFor();
  await page.locator('#load-replay').click();
  await page.locator('#replay-counter').filter({ hasText: 'No resolved beats' }).waitFor();
  assert.equal(await page.locator('#replay-next').isDisabled(), true);
  const abortedDownloadPromise = page.waitForEvent('download');
  await page.locator('#download-replay').click();
  const abortedDownload = await abortedDownloadPromise;
  const abortedReplay = JSON.parse(await readFile(await abortedDownload.path(), 'utf8'));
  assert.equal(abortedReplay.turns.length, 0);
  assert.equal(abortedReplay.result.winner, null);
  assert.equal(verifyReplay(abortedReplay).ok, true);

  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(failedRequests, []);

  await context.close();
  process.stdout.write('browser E2E passed: clicked setup, completed practice, inspected and downloaded verified replay, changed note/style, and rematched\n');
} finally {
  if (browser) await browser.close();
  await app.close();
}
