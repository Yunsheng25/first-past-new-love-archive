function errorMessage(value, fallback) {
  if (value instanceof Error && value.message) return value.message;
  return fallback;
}

export function createCdpSession(socket, {
  timeoutMs = 10000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!socket?.addEventListener || typeof socket.send !== "function") throw new TypeError("CDP session requires a WebSocket-like object");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("CDP timeout must be positive");
  let sequence = 0;
  let closedReason = null;
  const pending = new Map();
  const rejectAll = (reason) => {
    if (!closedReason) closedReason = reason instanceof Error ? reason : Error(String(reason));
    for (const { reject, timer } of pending.values()) { clearTimeoutFn(timer); reject(closedReason); }
    pending.clear();
  };
  const onMessage = ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { rejectAll(Error("CDP socket sent invalid JSON")); return; }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id); pending.delete(message.id); clearTimeoutFn(request.timer);
    if (message.error) request.reject(Error(`CDP ${request.method} failed: ${message.error.message ?? "unknown error"}`));
    else request.resolve(message.result);
  };
  const onError = (event) => rejectAll(Error(`CDP socket error: ${errorMessage(event?.error, "connection failed")}`));
  const onClose = (event) => rejectAll(Error(`CDP socket closed (code ${event?.code ?? "unknown"}${event?.reason ? `, ${event.reason}` : ""})`));
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);

  const send = (method, params = {}) => {
    if (closedReason || socket.readyState !== 1) return Promise.reject(Error(`CDP session is closed: ${closedReason?.message ?? "socket unavailable"}`));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeoutFn(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(Error(`CDP command timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      pending.set(id, { method, resolve, reject, timer });
      try { socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeoutFn(timer); pending.delete(id); reject(Error(`CDP send failed for ${method}: ${errorMessage(error, "unknown error")}`)); }
    });
  };
  const close = (reason = "CDP session closed") => {
    rejectAll(Error(reason));
    socket.removeEventListener?.("message", onMessage);
    socket.removeEventListener?.("error", onError);
    socket.removeEventListener?.("close", onClose);
    if (socket.readyState === 0 || socket.readyState === 1) socket.close();
  };
  return Object.freeze({ send, close, pendingCount: () => pending.size });
}

export function waitForDevToolsEndpoint(child, {
  timeoutMs = 10000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  return new Promise((resolve, reject) => {
    let text = ""; let settled = false;
    const cleanup = () => { clearTimeoutFn(timer); child.stderr?.removeListener?.("data", onData); child.removeListener?.("exit", onExit); child.removeListener?.("error", onError); };
    const finish = (callback, value) => { if (settled) return; settled = true; cleanup(); callback(value); };
    const onData = (chunk) => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(resolve, match[1]);
    };
    const onExit = (code, signal) => finish(reject, Error(`Chrome exited before DevTools was ready (code ${code ?? "unknown"}${signal ? `, signal ${signal}` : ""})`));
    const onError = (error) => finish(reject, Error(`Chrome failed to start: ${errorMessage(error, "unknown error")}`));
    const timer = setTimeoutFn(() => finish(reject, Error(`Chrome DevTools endpoint timed out after ${timeoutMs}ms`)), timeoutMs);
    child.stderr?.on?.("data", onData); child.once?.("exit", onExit); child.once?.("error", onError);
  });
}

export function waitForSocketOpen(socket, { timeoutMs = 10000 } = {}) {
  if (socket.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.removeEventListener("open", onOpen); socket.removeEventListener("error", onError); socket.removeEventListener("close", onClose); };
    const finish = (callback, value) => { cleanup(); callback(value); };
    const onOpen = () => finish(resolve);
    const onError = () => finish(reject, Error("CDP socket failed before opening"));
    const onClose = (event) => finish(reject, Error(`CDP socket closed before opening (code ${event.code})`));
    const timer = setTimeout(() => finish(reject, Error(`CDP socket open timed out after ${timeoutMs}ms`)), timeoutMs);
    socket.addEventListener("open", onOpen, { once: true }); socket.addEventListener("error", onError, { once: true }); socket.addEventListener("close", onClose, { once: true });
  });
}

export async function terminateChild(child, { timeoutMs = 5000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  let timer;
  const timedOut = new Promise((_, reject) => { timer = setTimeoutFn(() => reject(Error(`Chrome did not exit within ${timeoutMs}ms`)), timeoutMs); });
  try { await Promise.race([exited, timedOut]); }
  finally { clearTimeoutFn(timer); }
}

export async function removeDirectoryWithRetry(directory, {
  timeoutMs = 5000,
  retryMs = 50,
  remove = (target) => rm(target, { recursive: true, force: true }),
  wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  now = Date.now,
} = {}) {
  const started = now();
  while (true) {
    try { await remove(directory); return; }
    catch (error) {
      const transient = ["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code);
      if (!transient || now() - started >= timeoutMs) {
        throw Error(`Could not remove temporary Chrome profile ${directory}: ${error?.code ?? "unknown"} ${error?.message ?? error}`);
      }
      await wait(retryMs);
    }
  }
}
import { rm } from "node:fs/promises";
