export const TUNNEL_STEP = 0.52;
export const TUNNEL_RADIUS_X = 4.25;
export const TUNNEL_RADIUS_Y = 2.82;
export const TUNNEL_MAX_INDEX = 137;

const EMPTY_GROUP = Object.freeze([]);
const CARDS_PER_TURN = 8;
const RING_PHASE_DRIFT = 0.095;

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
 * Places cards on a dense, steadily receding elliptical spiral. rotationZ turns
 * a Three.js plane's local x-axis along the ellipse tangent at each card.
 */
export function tunnelPose(index) {
  if (!Number.isInteger(index) || index < 0 || index > TUNNEL_MAX_INDEX) {
    throw new RangeError(`Tunnel pose index must be an integer from 0 to ${TUNNEL_MAX_INDEX}`);
  }
  const angle = (index * Math.PI * 2 / CARDS_PER_TURN) + (Math.floor(index / CARDS_PER_TURN) * RING_PHASE_DRIFT);
  return {
    x: Math.cos(angle) * TUNNEL_RADIUS_X,
    y: Math.sin(angle) * TUNNEL_RADIUS_Y,
    z: index === 0 ? 0 : -index * TUNNEL_STEP,
    rotationZ: Math.atan2(
      TUNNEL_RADIUS_Y * Math.cos(angle),
      -TUNNEL_RADIUS_X * Math.sin(angle),
    ),
  };
}
