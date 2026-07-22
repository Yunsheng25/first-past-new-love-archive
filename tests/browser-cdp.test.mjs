import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createCdpSession, removeDirectoryWithRetry, terminateChild, waitForDevToolsEndpoint } from "../scripts/cdp-session.mjs";

class FakeSocket extends EventTarget {
  constructor() { super(); this.readyState = 1; this.sent = []; this.closed = 0; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closed += 1; this.readyState = 3; }
  message(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
  fail() { this.dispatchEvent(new Event("error")); }
  shut() { this.readyState = 3; this.dispatchEvent(new CloseEvent("close", { code: 1006, reason: "lost" })); }
}

function fakeTimers() {
  const timers = new Map(); let id = 0;
  return {
    timers,
    setTimeoutFn(callback) { const token = ++id; timers.set(token, callback); return token; },
    clearTimeoutFn(token) { timers.delete(token); },
  };
}

test("CDP socket close rejects every pending command with a clear connection error", async () => {
  const socket = new FakeSocket();
  const session = createCdpSession(socket, { timeoutMs: 1000 });
  const first = session.send("Page.enable");
  const second = session.send("Runtime.enable");
  socket.shut();
  await assert.rejects(first, /CDP socket closed.*1006.*lost/);
  await assert.rejects(second, /CDP socket closed.*1006.*lost/);
  assert.equal(session.pendingCount(), 0);
});

test("CDP socket error rejects all pending commands and future sends fail immediately", async () => {
  const socket = new FakeSocket();
  const session = createCdpSession(socket, { timeoutMs: 1000 });
  const pending = session.send("Page.captureScreenshot");
  socket.fail();
  await assert.rejects(pending, /CDP socket error/);
  await assert.rejects(session.send("Page.enable"), /CDP session is closed/);
});

test("each CDP command has an injected deterministic timeout which clears its pending entry", async () => {
  const clock = fakeTimers(); const socket = new FakeSocket();
  const session = createCdpSession(socket, { timeoutMs: 25, ...clock });
  const pending = session.send("Runtime.evaluate");
  assert.equal(clock.timers.size, 1);
  [...clock.timers.values()][0]();
  await assert.rejects(pending, /CDP command timed out after 25ms: Runtime\.evaluate/);
  assert.equal(session.pendingCount(), 0);
});

test("successful CDP response clears timeout and close rejects remaining work", async () => {
  const clock = fakeTimers(); const socket = new FakeSocket();
  const session = createCdpSession(socket, { timeoutMs: 25, ...clock });
  const completed = session.send("Page.enable");
  socket.message({ id: socket.sent[0].id, result: { ok: true } });
  assert.deepEqual(await completed, { ok: true });
  assert.equal(clock.timers.size, 0);
  const pending = session.send("Runtime.enable");
  session.close("acceptance cleanup");
  await assert.rejects(pending, /acceptance cleanup/);
  assert.equal(socket.closed, 1);
});

test("DevTools startup rejects on timeout and early child exit instead of hanging", async () => {
  const timeoutClock = fakeTimers();
  const child = new EventEmitter(); child.stderr = new EventEmitter();
  const timeout = waitForDevToolsEndpoint(child, { timeoutMs: 50, ...timeoutClock });
  [...timeoutClock.timers.values()][0]();
  await assert.rejects(timeout, /Chrome DevTools endpoint timed out after 50ms/);

  const exited = new EventEmitter(); exited.stderr = new EventEmitter();
  const early = waitForDevToolsEndpoint(exited, { timeoutMs: 50 });
  exited.emit("exit", 17, null);
  await assert.rejects(early, /Chrome exited before DevTools was ready \(code 17\)/);
});

test("child termination waits for exit and clears its shutdown timer", async () => {
  const clock = fakeTimers();
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.kill = () => true;
  const stopping = terminateChild(child, { timeoutMs: 50, ...clock });
  assert.equal(clock.timers.size, 1);
  child.exitCode = 0; child.emit("exit", 0, null);
  await stopping;
  assert.equal(clock.timers.size, 0);
});

test("temporary profile cleanup retries transient Windows locks and then succeeds", async () => {
  let attempts = 0;
  await removeDirectoryWithRetry("profile", {
    timeoutMs: 100,
    retryMs: 1,
    remove: async () => { attempts += 1; if (attempts < 3) throw Object.assign(Error("locked"), { code: "EBUSY" }); },
    wait: async () => {},
  });
  assert.equal(attempts, 3);
});

test("temporary profile cleanup reports a persistent lock with its path", async () => {
  let now = 0;
  await assert.rejects(removeDirectoryWithRetry("locked-profile", {
    timeoutMs: 10,
    retryMs: 5,
    now: () => now,
    remove: async () => { now += 6; throw Object.assign(Error("locked"), { code: "EPERM" }); },
    wait: async () => {},
  }), /Could not remove temporary Chrome profile locked-profile.*EPERM/);
});
