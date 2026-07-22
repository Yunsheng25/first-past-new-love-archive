import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const output = path.resolve("output/playwright");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "archive-tunnel-chrome-"));
const processRef = spawn(chrome, ["--headless=new", "--no-first-run", "--disable-gpu", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });

const browserWs = await new Promise((resolve, reject) => {
  let text = "";
  const timer = setTimeout(() => reject(Error("Chrome DevTools endpoint timeout")), 10000);
  processRef.stderr.on("data", (chunk) => {
    text += chunk;
    const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  processRef.once("exit", (code) => reject(Error(`Chrome exited early (${code})`)));
});
const { port } = new URL(browserWs);
const target = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:8080/%23archive`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
  if (message.error) reject(Error(message.error.message)); else resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const response = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw Error(response.exceptionDetails.text);
  return response.result.value;
};
const waitFor = async (expression, timeout = 10000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(`Timed out: ${expression}`);
};
const screenshot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path.join(output, name), Buffer.from(data, "base64"));
};
const metrics = () => evaluate(`(() => {
  const cards=[...document.querySelectorAll('.archive-tunnel-card')];
  const visible=cards.filter(card=>!card.hidden);
  const mouth=document.querySelector('[data-tunnel-rewind]');
  const guide=document.querySelector('.archive-tunnel-guide')?.getBoundingClientRect();
  const back=document.querySelector('.archive-return-after')?.getBoundingClientRect();
  const overlap=(a,b)=>!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  return {current:document.querySelector('[data-tunnel-current]')?.textContent,inRange:cards.filter(card=>card.dataset.inRange==='true').length,visible:visible.length,ready:visible.filter(card=>card.dataset.paintReady==='ready').length,failed:visible.filter(card=>card.dataset.paintReady==='failed').length,pendingVisible:visible.filter(card=>card.dataset.paintReady==='pending').length,mouthText:mouth?.textContent,mouthDisabled:mouth?.disabled,mouthPointer:getComputedStyle(mouth).pointerEvents,guideBackOverlap:overlap(guide,back),controlsInside:[mouth,document.querySelector('.archive-tunnel-guide'),document.querySelector('.archive-return-after'),document.querySelector('.archive-tunnel-count')].every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})};
})()`);

try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor("document.querySelectorAll('.archive-tunnel-card').length===138");
  await evaluate("document.querySelector('[data-tunnel-cruise]').click()");
  await waitFor("document.querySelectorAll('.archive-tunnel-card[data-in-range=\"true\"]').length>0 && [...document.querySelectorAll('.archive-tunnel-card[data-in-range=\"true\"]')].every(card=>card.dataset.paintReady!=='pending'&&!card.hidden)");
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))", true);
  const entrance = await metrics();
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 1800 });
  await waitFor("Number(document.querySelector('[data-tunnel-current]').textContent)>1");
  const afterWheel = await metrics();
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 720, y: 140, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 720, y: 40, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 720, y: 40, button: "left", clickCount: 1 });
  await waitFor(`Number(document.querySelector('[data-tunnel-current]').textContent)>${Number(afterWheel.current)}`);
  const afterDrag = await metrics();
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 5000 });
  await waitFor("Number(document.querySelector('[data-tunnel-current]').textContent)>=60");
  await waitFor("document.querySelectorAll('.archive-tunnel-card[data-in-range=\"true\"]').length>0 && [...document.querySelectorAll('.archive-tunnel-card[data-in-range=\"true\"]')].every(card=>card.dataset.paintReady!=='pending'&&!card.hidden)");
  await evaluate("Promise.all([...document.querySelectorAll('.archive-tunnel-card[data-in-range=\"true\"] img')].map(img=>img.decode?.().catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))", true);
  const middle = await metrics(); await screenshot("v15-browser-middle.png");
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 99999 });
  await waitFor("document.querySelector('[data-tunnel-current]').textContent==='138'");
  const ended = await metrics();
  await evaluate("document.querySelector('[data-tunnel-rewind]').click()");
  await waitFor("document.querySelector('[data-tunnel-current]').textContent==='001' && document.querySelector('[data-tunnel-rewind]').textContent==='ARCHIVE'", 6000);
  const rewound = await metrics();
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: "about:blank" });
  await waitFor("location.href==='about:blank'");
  await send("Page.navigate", { url: "http://127.0.0.1:8080/#archive" });
  await waitFor("location.hash==='#archive' && document.readyState==='complete' && document.querySelectorAll('.archive-tunnel-card').length===138");
  await waitFor("document.querySelectorAll('.archive-tunnel-card[data-in-range=\"true\"]').length>0 && [...document.querySelectorAll('.archive-tunnel-card[data-in-range=\"true\"]')].every(card=>card.dataset.paintReady!=='pending'&&!card.hidden)");
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))", true);
  const mobile = await metrics(); await screenshot("v15-browser-mobile.png");
  assert.deepEqual([entrance.current, entrance.inRange, entrance.visible, entrance.ready, entrance.pendingVisible, entrance.mouthPointer], ["001", 92, 92, 92, 0, "none"]);
  assert.ok(Number(afterWheel.current) > 1);
  assert.ok(Number(afterDrag.current) > Number(afterWheel.current));
  assert.equal(middle.visible, middle.inRange); assert.equal(middle.ready, middle.visible); assert.equal(middle.pendingVisible, 0);
  assert.deepEqual([ended.current, ended.mouthDisabled, ended.mouthPointer], ["138", false, "auto"]);
  assert.deepEqual([rewound.current, rewound.mouthText, rewound.mouthPointer], ["001", "ARCHIVE", "none"]);
  assert.equal(mobile.visible, mobile.inRange); assert.equal(mobile.ready, mobile.visible); assert.equal(mobile.pendingVisible, 0);
  assert.equal(mobile.guideBackOverlap, false); assert.equal(mobile.controlsInside, true);
  console.log(JSON.stringify({ entrance, afterWheel, afterDrag, middle, ended, rewound, mobile }, null, 2));
} finally {
  socket.close(); processRef.kill();
}
