/**
 * Orbit-camera maths for the 3D body viewer (components/scan/body-viewer.tsx).
 *
 * The viewer is a spherical orbit camera: the camera sits at `target + dir(azimuth, polar) * radius`
 * and looks at `target`. Zoom is a change of radius, which means it converges on whatever the target
 * is — and with a target pinned to the model's centre, every pinch zooms at the centre no matter
 * where the fingers are. Zooming toward the pinch instead means MOVING THE TARGET, which is what
 * `focalZoomTarget` computes.
 *
 * Every export is marked 'worklet' so the pinch handler can call it on the UI thread, and the file
 * has zero imports so it also compiles standalone under scripts/test-orbit-camera.mjs
 * (npm run test:orbit) — the sign of a term in here is not something code review catches, but the
 * round-trip property test does.
 */

export type Vec3 = readonly [number, number, number];

/**
 * The camera's right/up axes for a given orbit orientation.
 *
 * Derived rather than read back off the three.js camera because the pinch handler runs on the UI
 * thread, where the scene graph is not reachable. It reproduces what `camera.lookAt` does with the
 * default world up (0,1,0): z = normalize(eye - target) = dir, x = normalize(cross(worldUp, z)),
 * y = cross(z, x). Both simplify to closed forms — the cross with (0,1,0) drops the polar term out
 * of `right` entirely, which is why panning sideways feels level at any pitch.
 */
export function cameraBasis(azimuth: number, polar: number): { dir: Vec3; right: Vec3; up: Vec3 } {
  'worklet';
  const sp = Math.sin(polar);
  const cp = Math.cos(polar);
  const sa = Math.sin(azimuth);
  const ca = Math.cos(azimuth);
  return {
    dir: [sp * sa, cp, sp * ca],
    right: [ca, 0, -sa],
    up: [-cp * sa, sp, -cp * ca],
  };
}

/**
 * Where the orbit target has to move so that the world point under the user's fingers stays under
 * their fingers while the radius changes.
 *
 * `nx`/`ny` are the focal point in NDC (-1..1, y up). The derivation, on the plane through the
 * target perpendicular to the view direction — the plane the model roughly sits on:
 *
 *   a screen offset (nx, ny) is a world offset  O(r) = right * nx * halfW(r) + up * ny * halfH(r)
 *   with halfH(r) = r * tan(fov/2) and halfW(r) = halfH(r) * aspect, both LINEAR in r.
 *   The point under the fingers is        P = T + O(r)
 *   Keeping P under the fingers after zoom needs  P = T' + O(r')
 *   so                                    T' = T + O(r) - O(r') = T + O(r) * (1 - r'/r)
 *
 * Zooming in (r' < r) gives a positive factor, so the target slides toward the focal point; zooming
 * out gives a negative one and it slides away, which is what keeps the gesture reversible. A pinch
 * centred on the screen (nx = ny = 0) leaves the target exactly where it was, so this degrades
 * cleanly into the old centre-zoom behaviour.
 *
 * Exact only for points on that plane; anything nearer or further drifts slightly. That is the
 * standard trade (the alternative is raycasting the model on every pinch frame from the UI thread)
 * and it is imperceptible over the radius range this viewer allows.
 */
export function focalZoomTarget(
  target: Vec3,
  startRadius: number,
  nextRadius: number,
  azimuth: number,
  polar: number,
  nx: number,
  ny: number,
  fovRad: number,
  aspect: number,
): Vec3 {
  'worklet';
  if (startRadius <= 0) return target;
  const { right, up } = cameraBasis(azimuth, polar);
  const halfH = startRadius * Math.tan(fovRad / 2);
  const halfW = halfH * aspect;
  const k = 1 - nextRadius / startRadius;
  const ox = (right[0] * nx * halfW + up[0] * ny * halfH) * k;
  const oy = (right[1] * nx * halfW + up[1] * ny * halfH) * k;
  const oz = (right[2] * nx * halfW + up[2] * ny * halfH) * k;
  return [target[0] + ox, target[1] + oy, target[2] + oz];
}

/**
 * Keep the target inside the model's bounds (inflated by `slack`) so a run of off-centre zooms
 * cannot walk the camera off into empty space with no way back. Clamped per axis rather than by
 * distance, so sliding along one axis doesn't cost travel on another.
 */
export function clampTarget(
  t: Vec3,
  min: Vec3,
  max: Vec3,
  slack = 0,
): Vec3 {
  'worklet';
  const cl = (v: number, lo: number, hi: number) => Math.min(hi + slack, Math.max(lo - slack, v));
  return [cl(t[0], min[0], max[0]), cl(t[1], min[1], max[1]), cl(t[2], min[2], max[2])];
}

/** Pixel coordinates within a view → NDC (-1..1, y up), the space `focalZoomTarget` expects. */
export function toNdc(x: number, y: number, width: number, height: number): { nx: number; ny: number } {
  'worklet';
  if (width <= 0 || height <= 0) return { nx: 0, ny: 0 };
  return { nx: (x / width) * 2 - 1, ny: -((y / height) * 2 - 1) };
}
