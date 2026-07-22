export const TUNNEL_MAX_INDEX = 137;

// Exact projection constants from the user-approved v15 preview.
export const APPROVED_TUNNEL_CAMERA_START = -160;
export const APPROVED_TUNNEL_CAMERA_END = 7124;
export const APPROVED_TUNNEL_DEPTH_STEP = 52;

const APPROVED_CARDS_PER_TURN = 8;
const APPROVED_RING_PHASE_DRIFT = 0.22;
const APPROVED_FOCAL_LENGTH = 680;
const APPROVED_NEAR_CLAMP = -430;
const APPROVED_VISIBLE_NEAR = -470;
const APPROVED_VISIBLE_FAR = 4900;
const APPROVED_FADE_IN_DISTANCE = 700;
const APPROVED_FADE_BEHIND_DISTANCE = 250;
const APPROVED_MAX_RADIUS_X = 430;
const APPROVED_MAX_RADIUS_Y = 285;
const APPROVED_VIEWPORT_RADIUS_X = 0.38;
const APPROVED_VIEWPORT_RADIUS_Y = 0.39;

const EMPTY_GROUP = Object.freeze([]);

/**
 * Creates the render order without changing the authored case/image ordering.
 */
export function flattenArchiveOccurrences(data) {
  if (!Array.isArray(data?.cases)) return EMPTY_GROUP;

  const occurrences = [];
  data.cases.forEach((item, caseIndex) => {
    if (!Array.isArray(item?.images)) return;
    item.images.forEach((image, imageIndex) => {
      if (!image || typeof image !== "object") return;
      occurrences.push(Object.freeze({
        order: occurrences.length + 1,
        caseId: item.id,
        caseIndex,
        imageIndex,
        title: item.title,
        role: image.role,
        src: image.src,
        status: item.status === "error" ? "error" : "normal",
        errorGroup: item.status === "error" ? (item.errorGroup ?? null) : null,
        errorReason: item.status === "error" ? (item.errorReason ?? null) : null,
      }));
    });
  });
  return Object.freeze(occurrences);
}

/**
 * Returns a copy so modal/UI changes cannot alter the archive source data.
 */
export function groupCaseImages(data, caseId) {
  if (!Array.isArray(data?.cases)) return EMPTY_GROUP;
  const item = data.cases.find((candidate) => candidate?.id === caseId);
  if (!Array.isArray(item?.images)) return EMPTY_GROUP;
  return Object.freeze(item.images.map((image) => Object.freeze({ ...image })));
}

/**
 * The exact front-facing pixel projection used by approved preview v15.
 * `camera.position` is the preview's longitudinal camera value; width/height
 * are the stage's CSS-pixel dimensions. Rotation is deliberately absent:
 * cards always face the viewer in this model.
 */
export function approvedTunnelPose(index, camera) {
  return Object.freeze(approvedTunnelPoseInto(index, camera, {}));
}

/** Writes the approved projection into a caller-owned object for hot render loops. */
export function approvedTunnelPoseInto(index, camera, target) {
  if (!Number.isInteger(index) || index < 0 || index > TUNNEL_MAX_INDEX) {
    throw new RangeError(`Tunnel pose index must be an integer from 0 to ${TUNNEL_MAX_INDEX}`);
  }
  const width = camera?.width;
  const height = camera?.height;
  const position = camera?.position;
  if (!Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height <= 0
    || !Number.isFinite(position)) {
    throw new RangeError("Approved tunnel camera needs finite positive width/height and a finite position");
  }

  const z = index * APPROVED_TUNNEL_DEPTH_STEP - position;
  const scale = APPROVED_FOCAL_LENGTH
    / (APPROVED_FOCAL_LENGTH + Math.max(z, APPROVED_NEAR_CLAMP));
  const angle = (index * Math.PI * 2 / APPROVED_CARDS_PER_TURN)
    + (Math.floor(index / APPROVED_CARDS_PER_TURN) * APPROVED_RING_PHASE_DRIFT);
  const radiusX = Math.min(width * APPROVED_VIEWPORT_RADIUS_X, APPROVED_MAX_RADIUS_X);
  const radiusY = Math.min(height * APPROVED_VIEWPORT_RADIUS_Y, APPROVED_MAX_RADIUS_Y);
  const fadeIn = Math.min(1, (APPROVED_VISIBLE_FAR - z) / APPROVED_FADE_IN_DISTANCE);
  const fadeBehind = Math.min(1, (z - APPROVED_VISIBLE_NEAR) / APPROVED_FADE_BEHIND_DISTANCE);

  const output = target && typeof target === "object" ? target : {};
  output.x = Math.cos(angle) * radiusX * scale;
  output.y = Math.sin(angle) * radiusY * scale;
  output.scale = scale;
  output.opacity = Math.max(0.1, Math.min(fadeIn, fadeBehind, 0.3 + scale * 0.9));
  output.visible = z >= APPROVED_VISIBLE_NEAR && z <= APPROVED_VISIBLE_FAR;
  output.zIndex = Math.round(10000 - z);
  return output;
}

/** Returns only indexes that can intersect the approved z visibility window. */
export function approvedTunnelVisibleRange(cameraPosition, count) {
  if (!Number.isFinite(cameraPosition) || !Number.isInteger(count) || count < 1 || count > TUNNEL_MAX_INDEX + 1) {
    throw new RangeError("Approved tunnel range needs a finite camera position and supported positive count");
  }
  const start = Math.max(0, Math.ceil((cameraPosition + APPROVED_VISIBLE_NEAR) / APPROVED_TUNNEL_DEPTH_STEP));
  const end = Math.min(count - 1, Math.floor((cameraPosition + APPROVED_VISIBLE_FAR) / APPROVED_TUNNEL_DEPTH_STEP));
  return Object.freeze({ start, end });
}
