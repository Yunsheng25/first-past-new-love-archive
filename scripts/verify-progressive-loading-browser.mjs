import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createCdpSession,
  terminateChild,
  waitForDevToolsEndpoint,
  waitForSocketOpen,
} from './cdp-session.mjs';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const previewUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8080/';
const commandTimeoutMs = 15_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'progressive-loading-chrome-'));
  let browser;
  let socket;
  let session;

  try {
    browser = spawn(chrome, [
      '--headless=new',
      '--no-first-run',
      '--disable-gpu',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const browserWs = await waitForDevToolsEndpoint(browser, { timeoutMs: 10_000 });
    const { port } = new URL(browserWs);
    const targetResponse = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(previewUrl)}`,
      { method: 'PUT' },
    );
    if (!targetResponse.ok) throw Error(`CDP target creation failed with HTTP ${targetResponse.status}`);
    const target = await targetResponse.json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await waitForSocketOpen(socket, { timeoutMs: 10_000 });
    session = createCdpSession(socket, { timeoutMs: commandTimeoutMs });

    const requests = [];
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Network.requestWillBeSent') {
        requests.push(new URL(message.params.request.url).pathname);
      }
    });

    const send = session.send;
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
      return result.result.value;
    };
    const waitFor = async (expression, timeoutMs = 10_000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await evaluate(expression)) return Date.now() - started;
        await delay(50);
      }
      throw Error(`Browser condition timed out: ${expression}`);
    };
    const waitForHost = async (predicate, label, timeoutMs = 10_000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (predicate()) return Date.now() - started;
        await delay(50);
      }
      throw Error(`Browser condition timed out: ${label}`);
    };
    const hasRequest = (fragment) => requests.some((pathname) => pathname.includes(fragment));
    const click = async (selector) => {
      const point = await evaluate(`(() => {
        const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 350,
      downloadThroughput: 500_000,
      uploadThroughput: 250_000,
      connectionType: 'cellular4g',
    });

    const navigationStarted = Date.now();
    await send('Page.navigate', { url: previewUrl });
    await waitFor("document.querySelector('.intro-view') && document.querySelector('#site-preloader')?.hidden");
    const shellVisibleMs = Date.now() - navigationStarted;

    assert.ok(shellVisibleMs < 8_000, `shell took ${shellVisibleMs}ms to appear`);
    assert.equal(hasRequest('/assets/audio/'), false, 'BGM must not download before playback intent');
    assert.equal(hasRequest('/assets/video/full-film.mp4'), false, 'full film must not download on the intro');
    assert.equal(hasRequest('/assets/review-media/'), false, 'review media must not download on the intro');
    assert.equal(hasRequest('/assets/canvas-images/'), false, 'archive media must not download on the intro');
    assert.equal(hasRequest('/preload-manifest.js'), false, 'whole-site preload manifest must stay unused');
    assert.equal(hasRequest('/assets/video/intro-background.mp4'), true, 'intro background may load progressively');

    await click('[data-bgm-toggle]');
    await waitForHost(() => hasRequest('/assets/audio/'), 'BGM network request');
    assert.equal(hasRequest('/assets/audio/'), true, 'BGM should download after the music control is clicked');

    await click('[data-play-film]');
    await waitFor("location.hash === '#film' && document.querySelector('.film-video')");
    await waitForHost(() => hasRequest('/assets/video/full-film.mp4'), 'full-film network request');
    assert.equal(hasRequest('/assets/video/full-film.mp4'), true, 'full film should download after the film is opened');

    console.log(JSON.stringify({
      shellVisibleMs,
      initialPolicy: {
        introFilmRequested: true,
        bgmDeferredUntilClick: true,
        fullFilmDeferredUntilClick: true,
        reviewMediaDeferred: true,
        archiveMediaDeferred: true,
        wholeSitePreloadDisabled: true,
      },
      requestCount: requests.length,
    }, null, 2));
  } finally {
    session?.close('progressive loading verification cleanup');
    if (!session && socket && socket.readyState < 2) socket.close();
    await terminateChild(browser, { timeoutMs: 5_000 }).catch(() => {});
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(`Progressive loading browser verification failed: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
