export const TUNNEL_CRUISE_MS = 90000;
export const TUNNEL_REWIND_MS = 3200;

const MODES = new Set(["cruising", "paused", "ended"]);

function requireFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number greater than or equal to zero`);
  }
}

function clamp(value, maximum) {
  return Math.min(maximum, Math.max(0, value));
}

function easeInOutCubic(progress) {
  return progress < 0.5
    ? 4 * progress ** 3
    : 1 - ((-2 * progress + 2) ** 3 / 2);
}

/**
 * Creates a deterministic, clock-free tunnel travel controller.
 * Tick deltas are milliseconds; progress spans zero through maxProgress.
 */
export function createTunnelState({ maxProgress, initialProgress = 0, initialMode } = {}) {
  requireFiniteNonNegative(maxProgress, "maxProgress");
  requireFiniteNonNegative(initialProgress, "initialProgress");
  if (initialMode !== undefined && !MODES.has(initialMode)) {
    throw new RangeError("initialMode must be cruising, paused, or ended");
  }

  let progress = clamp(initialProgress, maxProgress);
  let mode = initialMode ?? (progress === maxProgress ? "ended" : "cruising");
  if (progress === maxProgress && initialMode !== "paused") mode = "ended";
  if (mode === "ended" && progress !== maxProgress) {
    throw new RangeError("ended initialMode requires initialProgress at maxProgress");
  }

  let rewindStart = 0;
  let rewindElapsed = 0;
  let cruiseStartProgress = progress;
  let cruiseElapsed = 0;

  function beginCruiseSegment() {
    cruiseStartProgress = progress;
    cruiseElapsed = 0;
  }

  function tick(deltaMs) {
    requireFiniteNonNegative(deltaMs, "deltaMs");
    if (deltaMs === 0 || mode === "paused" || mode === "ended") return false;

    if (mode === "rewinding") {
      rewindElapsed = Math.min(TUNNEL_REWIND_MS, rewindElapsed + deltaMs);
      const fraction = rewindElapsed / TUNNEL_REWIND_MS;
      progress = rewindStart * (1 - easeInOutCubic(fraction));
      if (rewindElapsed === TUNNEL_REWIND_MS) {
        progress = 0;
        mode = "paused";
      }
      return true;
    }

    const cruiseSpeed = maxProgress / TUNNEL_CRUISE_MS;
    const durationToEnd = (maxProgress - cruiseStartProgress) / cruiseSpeed;
    const nextElapsed = cruiseElapsed + deltaMs;
    if (nextElapsed >= durationToEnd) {
      cruiseElapsed = durationToEnd;
      progress = maxProgress;
      mode = "ended";
      return true;
    }
    cruiseElapsed = nextElapsed;
    progress = cruiseStartProgress + (cruiseSpeed * cruiseElapsed);
    return true;
  }

  function nudge(delta) {
    if (!Number.isFinite(delta)) throw new RangeError("delta must be a finite number");
    if (delta === 0 || mode === "rewinding") return false;
    const next = clamp(progress + delta, maxProgress);
    if (next === progress) {
      if (mode === "cruising") {
        mode = "paused";
        return true;
      }
      return false;
    }
    progress = next;
    mode = progress === maxProgress ? "ended" : "paused";
    return true;
  }

  function resume() {
    if (mode !== "paused" || progress === maxProgress) return false;
    beginCruiseSegment();
    mode = "cruising";
    return true;
  }

  function pause() {
    if (mode !== "cruising") return false;
    mode = "paused";
    return true;
  }

  function startRewind() {
    if (mode !== "ended") return false;
    rewindStart = progress;
    rewindElapsed = 0;
    mode = "rewinding";
    return true;
  }

  function snapshot() {
    return Object.freeze({ progress, mode });
  }

  return Object.freeze({ tick, nudge, resume, pause, startRewind, snapshot });
}
