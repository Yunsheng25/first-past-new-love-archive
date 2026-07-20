export const TUNNEL_CRUISE_MS = 90000;
export const TUNNEL_REWIND_MS = 3200;

const MODES = new Set(["cruising", "paused", "ended"]);
// Absorbs insignificant binary rounding in nominal decimal frame partitions.
const TIME_TOLERANCE_MS = 1e-6;

function requireFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number greater than or equal to zero`);
  }
}

function requireMaxProgress(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("maxProgress must be a non-negative safe integer occurrence span");
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
  requireMaxProgress(maxProgress);
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
  let rewindElapsedCompensation = 0;
  let cruiseStartProgress = progress;
  let cruiseElapsed = 0;
  let cruiseElapsedCompensation = 0;

  function beginCruiseSegment() {
    cruiseStartProgress = progress;
    cruiseElapsed = 0;
    cruiseElapsedCompensation = 0;
  }

  function addCruiseElapsed(deltaMs) {
    const adjustedDelta = deltaMs - cruiseElapsedCompensation;
    const sum = cruiseElapsed + adjustedDelta;
    cruiseElapsedCompensation = (sum - cruiseElapsed) - adjustedDelta;
    cruiseElapsed = sum;
    return sum;
  }

  function addRewindElapsed(deltaMs) {
    const adjustedDelta = deltaMs - rewindElapsedCompensation;
    const sum = rewindElapsed + adjustedDelta;
    rewindElapsedCompensation = (sum - rewindElapsed) - adjustedDelta;
    rewindElapsed = sum;
    return sum;
  }

  function tick(deltaMs) {
    requireFiniteNonNegative(deltaMs, "deltaMs");
    if (deltaMs === 0 || mode === "paused" || mode === "ended") return false;

    if (mode === "rewinding") {
      const nextElapsed = addRewindElapsed(deltaMs);
      if (nextElapsed >= TUNNEL_REWIND_MS - TIME_TOLERANCE_MS) {
        rewindElapsed = TUNNEL_REWIND_MS;
        rewindElapsedCompensation = 0;
      }
      const fraction = rewindElapsed / TUNNEL_REWIND_MS;
      progress = rewindStart * (1 - easeInOutCubic(fraction));
      if (rewindElapsed === TUNNEL_REWIND_MS) {
        progress = 0;
        beginCruiseSegment();
        mode = "paused";
      }
      return true;
    }

    const cruiseSpeed = maxProgress / TUNNEL_CRUISE_MS;
    const durationToEnd = (maxProgress - cruiseStartProgress) / cruiseSpeed;
    const nextElapsed = addCruiseElapsed(deltaMs);
    if (nextElapsed >= durationToEnd - TIME_TOLERANCE_MS) {
      cruiseElapsed = durationToEnd;
      cruiseElapsedCompensation = 0;
      progress = maxProgress;
      mode = "ended";
      return true;
    }
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
    if (mode === "paused") beginCruiseSegment();
    return true;
  }

  function resume() {
    if (mode !== "paused" || progress === maxProgress) return false;
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
    rewindElapsedCompensation = 0;
    mode = "rewinding";
    return true;
  }

  function snapshot() {
    return Object.freeze({ progress, mode });
  }

  return Object.freeze({ tick, nudge, resume, pause, startRewind, snapshot });
}
