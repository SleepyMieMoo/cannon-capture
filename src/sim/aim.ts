/** Smallest signed difference from `from` to `to`, in radians (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

/** Rotate `current` toward `desired` by at most `maxStep` radians, the short way round. */
export function turnToward(current: number, desired: number, maxStep: number): number {
  const d = angleDelta(current, desired)
  if (Math.abs(d) <= maxStep) return desired
  return current + Math.sign(d) * maxStep
}

/** Keep an aim point inside a rectangle, inset by `margin`. */
export function clampPoint(
  x: number,
  y: number,
  box: { x: number; y: number; w: number; h: number },
  margin = 0,
): { x: number; y: number } {
  return {
    x: Math.min(box.x + box.w - margin, Math.max(box.x + margin, x)),
    y: Math.min(box.y + box.h - margin, Math.max(box.y + margin, y)),
  }
}
