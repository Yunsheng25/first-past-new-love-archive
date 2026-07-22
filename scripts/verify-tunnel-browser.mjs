import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCdpSession, removeDirectoryWithRetry, terminateChild, waitForDevToolsEndpoint, waitForSocketOpen } from "./cdp-session.mjs";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = process.cwd();
const output = path.resolve("output/playwright");
const commandTimeoutMs = 15000;

function withTimeout(promise, label, timeoutMs = commandTimeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const file = path.resolve(root, relative);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw Error("outside root");
      const body = await readFile(file);
      const extension = path.extname(file);
      response.setHeader("content-type", ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".mp4": "video/mp4" })[extension] ?? "application/octet-stream");
      response.end(body);
    } catch { response.statusCode = 404; response.end("Not found"); }
  });
  await withTimeout(new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }), "static server startup");
  return { server, port: server.address().port };
}

async function stopStaticServer(server) {
  if (!server?.listening) return;
  await withTimeout(new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())), "static server shutdown", 5000);
}

async function main() {
  await mkdir(output, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), "archive-tunnel-chrome-"));
  let server; let browser; let socket; let session;
  try {
    const hosted = await startStaticServer(); server = hosted.server;
    const archiveUrl = `http://127.0.0.1:${hosted.port}/#archive`;
    browser = spawn(chrome, ["--headless=new", "--no-first-run", "--disable-gpu", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    const browserWs = await waitForDevToolsEndpoint(browser, { timeoutMs: 10000 });
    const { port } = new URL(browserWs);
    const response = await withTimeout(fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(archiveUrl)}`, { method: "PUT" }), "CDP target creation");
    if (!response.ok) throw Error(`CDP target creation failed with HTTP ${response.status}`);
    const target = await withTimeout(response.json(), "CDP target response");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await waitForSocketOpen(socket, { timeoutMs: 10000 });
    session = createCdpSession(socket, { timeoutMs: commandTimeoutMs });
    const send = session.send;
    const evaluate = async (expression, awaitPromise = false) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      if (result.exceptionDetails) throw Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
      return result.result.value;
    };
    const waitFor = async (expression, timeoutMs = 10000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error(`Browser condition timed out after ${timeoutMs}ms: ${expression}`);
    };
    const screenshot = async (name) => {
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(path.join(output, name), Buffer.from(data, "base64"));
    };
    const metrics = () => evaluate(`(() => {const cards=[...document.querySelectorAll('.archive-tunnel-card')],visible=cards.filter(card=>!card.hidden),mouth=document.querySelector('[data-tunnel-rewind]'),guide=document.querySelector('.archive-tunnel-guide')?.getBoundingClientRect(),back=document.querySelector('.archive-return-after')?.getBoundingClientRect(),overlap=(a,b)=>!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return {current:document.querySelector('[data-tunnel-current]')?.textContent,inRange:cards.filter(card=>card.dataset.inRange==='true').length,visible:visible.length,ready:visible.filter(card=>card.dataset.paintReady==='ready').length,failed:visible.filter(card=>card.dataset.paintReady==='failed').length,pendingVisible:visible.filter(card=>card.dataset.paintReady==='pending').length,mouthText:mouth?.textContent,mouthDisabled:mouth?.disabled,mouthPointer:getComputedStyle(mouth).pointerEvents,guideBackOverlap:overlap(guide,back),controlsInside:[mouth,document.querySelector('.archive-tunnel-guide'),document.querySelector('.archive-return-after'),document.querySelector('.archive-tunnel-count')].every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})};})()`);
    const allRangeReady = `document.querySelectorAll('.archive-tunnel-card[data-in-range="true"]').length>0&&[...document.querySelectorAll('.archive-tunnel-card[data-in-range="true"]')].every(card=>card.dataset.paintReady!=='pending'&&!card.hidden)`;

    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor("document.querySelectorAll('.archive-tunnel-card').length===138");
    await evaluate("document.querySelector('[data-tunnel-cruise]').click()"); await waitFor(allRangeReady);
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))", true);
    const entrance = await metrics();
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 1800 }); await waitFor("Number(document.querySelector('[data-tunnel-current]').textContent)>1");
    const afterWheel = await metrics();
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 720, y: 140, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 720, y: 40, button: "left", buttons: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 720, y: 40, button: "left", clickCount: 1 });
    await waitFor(`Number(document.querySelector('[data-tunnel-current]').textContent)>${Number(afterWheel.current)}`); const afterDrag = await metrics();
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 5000 }); await waitFor("Number(document.querySelector('[data-tunnel-current]').textContent)>=60"); await waitFor(allRangeReady);
    await evaluate("Promise.all([...document.querySelectorAll('.archive-tunnel-card[data-in-range=\"true\"] img')].map(img=>img.decode?.().catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))", true);
    const middle = await metrics(); await screenshot("v15-browser-middle.png");
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 99999 }); await waitFor("document.querySelector('[data-tunnel-current]').textContent==='138'"); const ended = await metrics();
    await evaluate("document.querySelector('[data-tunnel-rewind]').click()"); await waitFor("document.querySelector('[data-tunnel-current]').textContent==='001'&&document.querySelector('[data-tunnel-rewind]').textContent==='ARCHIVE'", 6000); const rewound = await metrics();
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await send("Page.navigate", { url: "about:blank" }); await waitFor("location.href==='about:blank'"); await send("Page.navigate", { url: archiveUrl });
    await waitFor("location.hash==='#archive'&&document.readyState==='complete'&&document.querySelectorAll('.archive-tunnel-card').length===138"); await waitFor(allRangeReady); await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))", true);
    const mobile = await metrics(); await screenshot("v15-browser-mobile.png");
    assert.deepEqual([entrance.current, entrance.inRange, entrance.visible, entrance.ready, entrance.pendingVisible, entrance.mouthPointer], ["001", 92, 92, 92, 0, "none"]); assert.ok(Number(afterWheel.current)>1); assert.ok(Number(afterDrag.current)>Number(afterWheel.current)); assert.equal(middle.visible,middle.inRange); assert.equal(middle.ready,middle.visible); assert.equal(middle.pendingVisible,0); assert.deepEqual([ended.current,ended.mouthDisabled,ended.mouthPointer],["138",false,"auto"]); assert.deepEqual([rewound.current,rewound.mouthText,rewound.mouthPointer],["001","ARCHIVE","none"]); assert.equal(mobile.visible,mobile.inRange); assert.equal(mobile.ready,mobile.visible); assert.equal(mobile.pendingVisible,0); assert.equal(mobile.guideBackOverlap,false); assert.equal(mobile.controlsInside,true);
    console.log(JSON.stringify({ entrance, afterWheel, afterDrag, middle, ended, rewound, mobile }, null, 2));
  } finally {
    session?.close("acceptance cleanup");
    if (!session && socket && (socket.readyState === 0 || socket.readyState === 1)) socket.close();
    const cleanup = [];
    for (const operation of [() => stopStaticServer(server), () => terminateChild(browser, { timeoutMs: 5000 }), () => removeDirectoryWithRetry(profile, { timeoutMs: 5000 })]) {
      try { await operation(); } catch (error) { cleanup.push(error); }
    }
    const failures = cleanup.map((error) => error?.message ?? String(error));
    if (failures.length) throw Error(`Acceptance cleanup failed: ${failures.join("; ")}`);
  }
}

main().catch((error) => { console.error(`Tunnel browser acceptance failed: ${error?.stack ?? error}`); process.exitCode = 1; });
