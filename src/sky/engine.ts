/* ============================================================================
   The sky.
   ----------------------------------------------------------------------------
   Raw WebGL1, on purpose. The previous background needed WebGL2 plus float
   render targets, which is a real minority of machines once you count
   integrated graphics, remote desktops and blocklisted drivers — and on every
   one of those it drew nothing. Everything here is WebGL1 core: no
   extensions, 8-bit targets, point sprites. If a browser can draw a triangle
   it can draw this.

   Five passes a frame, back to front:

     1. NEBULA   domain-warped fbm into a low-resolution texture, with the
                 Milky Way's bright core and the dark dust rift through it.
                 Gas is soft, so a third of the linear resolution is
                 indistinguishable at a ninth of the fill cost. Re-rendered
                 every other frame at most: it evolves over minutes.
     2. COMPOSE  that texture stretched to the screen with a vignette and one
                 LSB of dither, which is what stops the upscale from banding.
     3. FAR      the star dome, the Milky Way's grain, and every flying star
                 further away than the planets.
     4. PLANETS  a gas giant with two moons, a ringed world with one, an
                 ocean world with weather, and a distant ember — ray-cast as
                 spheres at full resolution, but each only inside its own
                 bounding quad, so a body costs what it covers. Every surface
                 turns, every body drifts, and the moons are on Keplerian
                 orbits, drawn behind or in front of their planet by which
                 half of the orbit they are on.
     5. NEAR     flying stars closer than the planets, drawn last, so they
                 pass IN FRONT of them. That occlusion is most of why the
                 scene reads as a volume rather than a painted backdrop.

   Motion has three levels, decided before the engine starts:

     full    the fly-through, roll, pointer and scroll parallax
     gentle  the OS asked for reduced motion: no travel, no parallax, no roll.
             Stars still twinkle, the gas drifts, planets turn and moons
             orbit — all at half speed. Those are the motions reduced-motion
             guidance treats as safe: slow, lateral, nothing moves toward you
             and nothing tracks your hand.
     still   one frame, redrawn only on resize.
   ========================================================================== */

export type MotionLevel = 'full' | 'gentle' | 'still';
type RGB = [number, number, number];

interface Body {
  kind: number;      // 0 giant, 1 ringed, 2 moon, 3 ocean world, 4 ember
  x: number;         // p-space centre
  y: number;
  r: number;
  z: number;         // draw order, back to front
  depth: number;     // parallax gain
  spin: number;      // surface rotation, rad/s
  atmos: RGB;
  tint: RGB;
}

/** Each event tints one strand of the gas. Space stays blue; the event is a
 *  colour inside it, not a filter over it. */
const ACCENTS: Record<string, { rgb: RGB; amt: number }> = {
  sih:          { rgb: [1.0, 0.60, 0.20], amt: 0.62 },
  neutral:      { rgb: [0.88, 0.30, 0.92], amt: 0.40 },
};

/* ---- shaders ------------------------------------------------------------ */

const QUAD_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const NEBULA_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform float uRoll;
uniform vec2  uOffset;
uniform vec3  uAccent;
uniform float uAccentAmt;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i),                  hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p + 7.1; a *= 0.5; }
  return v;
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float c = cos(uRoll), s = sin(uRoll);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p += uOffset;
  float t = uTime * 0.018;

  // Two levels of domain warp. q bends the field, r bends it again along q —
  // that second bend is what turns blobs into the torn, filamentary gas.
  vec2 q = vec2(fbm(p * 1.4 + vec2(0.0, t)),
                fbm(p * 1.4 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p * 1.9 + 2.6 * q + vec2(1.7, 9.2) + 0.5 * t),
                fbm(p * 1.9 + 2.6 * q + vec2(8.3, 2.8) - 0.4 * t));
  float n = fbm(p * 1.7 + 2.2 * r);

  // The galactic lane: a soft diagonal where the gas is densest, so the
  // frame has a direction instead of uniform fog.
  float lane = p.y + 0.30 * p.x + 0.02;
  float band = exp(-lane * lane * 4.5);
  float dens = smoothstep(0.30, 0.95, n) * (0.28 + 0.95 * band);

  vec3 blue   = vec3(0.09, 0.19, 0.95);
  vec3 violet = vec3(0.48, 0.13, 0.92);
  vec3 cyan   = vec3(0.04, 0.76, 0.98);
  vec3 pink   = vec3(0.92, 0.28, 0.82);

  vec3 col = vec3(0.006, 0.008, 0.030);
  col += blue * dens * 0.85;

  float left  = smoothstep(0.30, -0.80, p.x);
  float right = smoothstep(-0.10, 0.80, p.x);
  col = mix(col, violet * (0.35 + dens), clamp(dens * left * q.x * 1.5, 0.0, 1.0));
  col = mix(col, pink   * (0.30 + dens), clamp(pow(r.x, 3.0) * left * dens * 1.6, 0.0, 1.0));
  col = mix(col, cyan   * (0.35 + dens), clamp(dens * right * r.y * 1.25, 0.0, 1.0));
  col = mix(col, uAccent * (0.30 + dens), clamp(uAccentAmt * q.y * q.y * dens * 1.4, 0.0, 1.0));

  // Filaments: the ridges of a warped field, sharpened.
  float ridge = 1.0 - abs(2.0 * fbm(p * 3.1 + 3.0 * r) - 1.0);
  col += (blue * 0.55 + cyan * 0.25) * pow(ridge, 7.0) * dens * 1.1;

  // THE MILKY WAY. A narrow luminous core along the lane — warm white, the
  // colour of a hundred billion unresolved suns — broken by the dark rift:
  // dust clouds in the galactic plane that block the light behind them.
  // The grain comes from the dome stars biased into the same lane.
  float core = exp(-lane * lane * 34.0);
  float grain = fbm(p * 9.0 + r * 1.5);
  col += vec3(0.78, 0.74, 0.92) * core * (0.22 + 0.30 * grain);
  float riftLine = lane + 0.035 * sin(p.x * 5.0 + q.x * 3.0);
  float rift = exp(-riftLine * riftLine * 700.0) * smoothstep(0.35, 0.75, fbm(p * 4.0 + 2.0 * q));
  col *= 1.0 - 0.72 * rift;

  // Two star-forming knots, where the light pools.
  vec2 k1 = vec2( 0.34 * uAspect,  0.30);
  vec2 k2 = vec2( 0.04 * uAspect, -0.42);
  float d1 = length(p - k1), d2 = length(p - k2);
  col += cyan * (0.55 * exp(-d1 * 7.0) + 0.9 * exp(-d1 * 38.0));
  col += vec3(0.30, 0.45, 1.0) * (0.45 * exp(-d2 * 7.5) + 0.8 * exp(-d2 * 40.0));

  gl_FragColor = vec4(col, 1.0);
}`;

const COMPOSE_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uNebula;
uniform float uSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(uNebula, vUv).rgb;
  // Exposure for the GAS ONLY. Stars and planets are drawn after this pass,
  // so darkening here deepens the space between the clouds without dimming a
  // single star or world. The gamma bends the curve so the faint haze falls
  // away to black while the dense gas keeps its colour — dark space with
  // nebulae in it, rather than a bright fog with stars on top.
  c = pow(c, vec3(1.6)) * 0.44;
  vec2 d = vUv - 0.5;
  c *= 1.0 - dot(d, d) * 1.1;
  c += (h(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

const STAR_VS = `
attribute vec3 aPos;
attribute vec3 aSeed;
uniform float uTravel;
uniform float uTime;
uniform float uRoll;
uniform float uAspect;
uniform float uPx;
uniform float uTwinkle;
uniform float uWarp;
uniform vec2  uParallax;
uniform float uLayer;     // 0 = behind the planets, 1 = in front of them
varying vec3  vColor;
varying float vAlpha;
varying float vHero;
varying float vSize;

const float PLANET_DEPTH = 0.30;

void cull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; }

vec2 roll(vec2 p) {
  p.x *= uAspect;
  float c = cos(uRoll), s = sin(uRoll);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p.x /= uAspect;
  return p;
}

void main() {
  float hero = aSeed.z;
  float tw = 1.0 - uTwinkle * 0.55 * (0.5 + 0.5 * sin(uTime * (1.1 + aSeed.y * 3.3) + aSeed.y * 61.0));

  if (aPos.z < 0.0) {
    // THE DOME. Stars too far away to ever get closer: they do not travel,
    // they barely parallax, they just turn with the camera and twinkle. This
    // is most of what the eye reads as "a sky full of stars", because a
    // volume of flying stars mostly sits outside the view cone.
    if (uLayer > 0.5) { cull(); return; }
    vec2 xy = aPos.xy;
    if (aPos.z < -1.5) {
      // Milky Way grain: y is an offset from the lane, not a position, so
      // the band follows the nebula's lane at any aspect ratio. Same line as
      // the shader's: p.y + 0.30 p.x + 0.02 = 0, in clip space.
      xy.y = -0.30 * uAspect * xy.x - 0.04 + xy.y;
    }
    vec2 p = roll(xy) + uParallax * 0.012;
    gl_Position = vec4(p, 0.0, 1.0);
    bool grainStar = aPos.z < -1.5;
    float size = (grainStar ? mix(2.4, 3.6, aSeed.x) : mix(3.0, 6.0, aSeed.x * aSeed.x * aSeed.x) + hero * 14.0) * uPx;
    gl_PointSize = size;
    vSize = size;
    vAlpha = (grainStar ? mix(0.14, 0.58, aSeed.x) : mix(0.35, 1.0, sqrt(aSeed.x))) * tw;
  } else {
    // THE FIELD. Depth wraps: a star that passes the camera re-enters at the
    // far plane, and the fades at both ends hide the seam.
    float z = fract(aPos.z - uTravel);
    float depth = mix(0.06, 1.0, z);
    bool near = depth < PLANET_DEPTH;
    if (near != (uLayer > 0.5)) { cull(); return; }
    vec2 p = roll(aPos.xy) + uParallax * (0.06 / depth);
    gl_Position = vec4(p / depth, 0.0, 1.0);

    float base = mix(3.0, 5.5, aSeed.x * aSeed.x) + hero * 6.0;
    float size = base * uPx * (0.30 / depth + 0.55) * (1.0 + uWarp * 0.9);
    size = min(size, uPx * (hero > 0.5 ? 28.0 : 12.0));
    gl_PointSize = size;
    vSize = size;

    float nearFade = smoothstep(0.0, 0.12, z);
    float farFade  = 1.0 - smoothstep(0.90, 1.0, z);
    vAlpha = nearFade * farFade * tw * mix(0.50, 1.0, aSeed.x) * (1.0 + uWarp * 0.7);
  }

  float k = aSeed.y;
  vColor = k < 0.58 ? vec3(0.93, 0.95, 1.00)
         : k < 0.80 ? vec3(0.62, 0.74, 1.00)
         : k < 0.92 ? vec3(0.55, 0.95, 1.00)
         :            vec3(0.86, 0.62, 1.00);
  vHero = hero;
}`;

const STAR_FS = `
precision mediump float;
varying vec3  vColor;
varying float vAlpha;
varying float vHero;
varying float vSize;
void main() {
  // Falloff in PIXELS, not in sprite units. Measured against the sprite, a
  // two-pixel star put almost no light on either of its pixels, because the
  // pixel centres sit a quarter of the sprite away from its middle. In pixel
  // units every star gets a bright core about a pixel wide, and near stars
  // grow a soft halo because their sigma grows with them.
  vec2 d = (gl_PointCoord - 0.5) * vSize;
  float r2 = dot(d, d);
  float sig2 = pow(max(0.7, vSize * 0.12), 2.0);
  float a = exp(-r2 / sig2) + 0.22 * exp(-r2 / (sig2 * 4.0));
  if (vHero > 0.5) {
    // The four-point sparkle on the few bright ones.
    vec2 ad = abs(d);
    float len = vSize * 0.22;
    float spikes = exp(-ad.x * ad.x / 0.8) * exp(-ad.y / len)
                 + exp(-ad.y * ad.y / 0.8) * exp(-ad.x / len);
    a = exp(-r2 / (sig2 * 1.4)) + 0.30 * exp(-r2 / (sig2 * 6.0)) + spikes * 0.75;
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

const PLANET_VS = `
attribute vec2 aPos;
uniform vec2  uCenter;
uniform float uHalf;
uniform float uAspect;
varying vec2  vP;
void main() {
  vP = uCenter + aPos * uHalf;
  gl_Position = vec4(vP / vec2(0.5 * uAspect, 0.5), 0.0, 1.0);
}`;

// One program, three bodies. Screen space is "p-space": y runs -0.5..0.5
// over the viewport height and x is scaled by aspect, so a sphere is round.
const PLANET_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2  vP;
uniform vec2  uCenter;
uniform float uRadius;
uniform float uKind;     // 0 giant, 1 ringed, 2 moon, 3 ocean world, 4 ember
uniform float uTime;
uniform float uSpin;     // surface rotation, rad per second
uniform vec3  uTint;     // moons and small bodies
uniform float uPix;      // one pixel, in units of this body's radius
uniform vec3  uLight;
uniform vec3  uAtmos;
uniform vec3  uStorm;
uniform float uOct;      // fbm octaves; the governor lowers it

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uOct) break;
    v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5;
  }
  return v;
}
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

void main() {
  vec2 q = (vP - uCenter) / uRadius;
  float r = length(q);
  vec3 L = normalize(uLight);
  float disc = 1.0 - smoothstep(1.0 - uPix, 1.0 + uPix, r);

  vec3 col = vec3(0.0);
  float lit = 0.0;
  vec3 n = vec3(0.0, 0.0, 1.0);
  if (r < 1.0 + uPix) {
    n = vec3(q, sqrt(max(0.0, 1.0 - r * r)));
    lit = dot(n, L);
  }

  if (uKind < 0.5) {
    // ---- the gas giant: banded, turning, with one storm ------------------
    vec3 t = vec3(rot(n.xy, -0.38), n.z);                 // axial tilt
    float lat = t.y;
    // Longitude scrolls with time rather than wrapping: the visible
    // hemisphere only ever spans pi, so the domain just translates and there
    // is no seam to come round the limb.
    float lon = atan(t.x, t.z) + uTime * uSpin;
    float w  = fbm(vec2(lon * 2.2, lat * 13.0) + vec2(uTime * uSpin * 0.35, 0.0));
    float b1 = 0.5 + 0.5 * sin(lat * 15.0 + w * 3.4);
    float b2 = 0.5 + 0.5 * sin(lat * 43.0 + w * 6.0);
    vec3 indigo   = vec3(0.10, 0.12, 0.42);
    vec3 lavender = vec3(0.52, 0.44, 0.86);
    vec3 cream    = vec3(0.98, 0.80, 0.68);
    col = mix(indigo, lavender, b1);
    col = mix(col, cream, smoothstep(0.62, 1.0, b2) * 0.50);
    vec2 sd = vec2(sin((lon - 0.9) * 0.5) * 2.0, lat + 0.24);
    float storm = exp(-dot(sd * vec2(3.2, 15.0), sd * vec2(3.2, 15.0)));
    col = mix(col, uStorm, storm * 0.85);

    float day = smoothstep(-0.18, 0.95, lit);
    col *= 0.035 + 1.10 * day;
    col *= 0.62 + 0.38 * sqrt(n.z);                         // limb darkening
    float rim = pow(1.0 - n.z, 2.6) * smoothstep(-0.35, 0.55, lit);
    col += uAtmos * rim * 1.05;
  } else if (uKind < 1.5) {
    // ---- the ringed world: pale ice-gold, rings in front and behind ------
    vec3 t = vec3(rot(n.xy, 0.42), n.z);
    float lon = atan(t.x, t.z) + uTime * uSpin;
    // Latitude stripes look identical however fast they turn, so the
    // rotation has to be carried by things that live at a longitude: band
    // turbulence, a pale storm, a dark spot. They ride round with the spin.
    float turb = fbm(vec2(lon * 3.0, t.y * 9.0));
    float band = 0.5 + 0.5 * sin(t.y * 22.0 + turb * 3.2);
    col = mix(vec3(0.95, 0.85, 0.65), vec3(0.70, 0.56, 0.44), band * 0.65);
    vec2 s1 = vec2(sin((lon - 0.6) * 0.5) * 2.0, t.y - 0.30);
    vec2 s2 = vec2(sin((lon + 1.9) * 0.5) * 2.0, t.y + 0.36);
    col = mix(col, vec3(1.0, 0.97, 0.90), exp(-dot(s1 * vec2(4.0, 18.0), s1 * vec2(4.0, 18.0))) * 0.85);
    col = mix(col, vec3(0.50, 0.36, 0.27), exp(-dot(s2 * vec2(5.0, 22.0), s2 * vec2(5.0, 22.0))) * 0.75);
    col *= 0.04 + 1.05 * smoothstep(-0.12, 0.9, lit);
    col += vec3(1.0, 0.86, 0.66) * pow(1.0 - n.z, 3.0) * smoothstep(-0.2, 0.6, lit) * 0.5;
  } else if (uKind < 2.5) {
    // ---- a moon: cratered, hard terminator, tinted per moon ---------------
    float lon = atan(n.x, n.z) + uTime * uSpin;
    vec2 m = vec2(lon * 1.6, n.y * 1.8);
    float c = fbm(m * 3.0 + 3.0);
    float craters = smoothstep(0.55, 0.7, fbm(m * 6.5 + 9.0));
    col = mix(vec3(0.34, 0.36, 0.42), vec3(0.74, 0.74, 0.78), c) * (1.0 - 0.28 * craters) * uTint;
    col *= 0.02 + 1.1 * smoothstep(-0.04, 0.45, lit);
  } else if (uKind < 3.5) {
    // ---- the ocean world: seas, continents, ice caps, weather -------------
    vec3 t = vec3(rot(n.xy, 0.22), n.z);
    float lat = t.y;
    float lon = atan(t.x, t.z) + uTime * uSpin;
    float land = fbm(vec2(lon * 1.3, lat * 2.4) + 5.0);
    float ground = smoothstep(0.53, 0.57, land);
    vec3 sea  = mix(vec3(0.02, 0.14, 0.36), vec3(0.05, 0.46, 0.62), smoothstep(0.36, 0.53, land));
    vec3 soil = mix(vec3(0.18, 0.44, 0.26), vec3(0.80, 0.70, 0.48), smoothstep(0.62, 0.76, land));
    col = mix(sea, soil, ground);
    col = mix(col, vec3(0.93, 0.97, 1.0), smoothstep(0.80, 0.90, abs(lat)));
    // Weather runs faster than the ground beneath it.
    float cl = fbm(vec2(lon * 2.1 + uTime * uSpin * 0.8, lat * 4.2) + 21.0);
    float clouds = smoothstep(0.50, 0.78, cl);
    col = mix(col, vec3(1.0), clouds * 0.85);
    float day = smoothstep(-0.12, 0.9, lit);
    col *= 0.03 + 1.1 * day;
    // The sun, glinting off open water.
    vec3 h = normalize(L + vec3(0.0, 0.0, 1.0));
    col += vec3(0.95, 0.97, 1.0) * pow(max(dot(n, h), 0.0), 48.0) * (1.0 - ground) * (1.0 - clouds) * 0.7 * day;
    col += uAtmos * pow(1.0 - n.z, 2.4) * smoothstep(-0.3, 0.6, lit);
  } else {
    // ---- the ember: a small, far, rust-red rock ---------------------------
    float lon = atan(n.x, n.z) + uTime * uSpin;
    vec2 m = vec2(lon * 1.5, n.y * 1.7);
    float c = fbm(m * 3.2 + 13.0);
    col = mix(vec3(0.42, 0.10, 0.05), vec3(0.98, 0.48, 0.20), c);
    col *= 1.0 - 0.35 * smoothstep(0.55, 0.7, fbm(m * 7.0 + 3.0));
    col *= 0.03 + 1.1 * smoothstep(-0.06, 0.6, lit);
    col += vec3(1.0, 0.52, 0.22) * pow(1.0 - n.z, 3.0) * smoothstep(-0.2, 0.6, lit) * 0.6;
  }

  vec3 outc = col * disc;
  float outa = disc;

  // Atmosphere halo outside the limb, only on the lit side.
  if ((uKind < 0.5 || (uKind > 2.5 && uKind < 3.5)) && r > 1.0) {
    float side = smoothstep(-0.45, 0.85, dot(normalize(q), normalize(L.xy)));
    float glow = exp(-(r - 1.0) * 16.0) * 0.75 * side;
    outc += uAtmos * glow;
  }

  if (uKind > 0.5 && uKind < 1.5) {
    // Rings: flatten into the ring plane, then decide who hides whom. The
    // near half crosses in front of the planet; the far half goes behind it.
    vec2 rq = rot(q, 0.42);
    vec2 rp = vec2(rq.x, rq.y / 0.27);
    float rr = length(rp);
    float ring = smoothstep(1.34, 1.42, rr) * (1.0 - smoothstep(2.22, 2.36, rr));
    ring *= 1.0 - 0.9 * (1.0 - smoothstep(0.0, 0.05, abs(rr - 1.86)));   // the gap
    ring *= 0.55 + 0.45 * sin(rr * 41.0) * sin(rr * 13.0 + 1.0);
    // The rings turn, and not as a disc: inner ringlets orbit faster than
    // outer ones (Kepler, omega ~ r^-1.5), so clumps and spokes shear as they
    // go round. A symmetric ring would hide its own rotation completely.
    float ang = atan(rp.y, rp.x);
    float phase = ang - uTime * 0.55 * pow(rr / 1.4, -1.5);
    float clumps = 0.72 + 0.28 * sin(phase * 7.0 + rr * 9.0) * sin(phase * 3.0 - rr * 4.0);
    float spokes = 1.0 - 0.38 * smoothstep(0.55, 1.0, sin(phase * 5.0)) * smoothstep(1.45, 1.8, rr) * (1.0 - smoothstep(2.0, 2.3, rr));
    ring *= clumps * spokes;
    ring = clamp(ring, 0.0, 1.0) * 0.85;
    vec3 rc = vec3(0.96, 0.88, 0.74) * (0.35 + 0.75 * smoothstep(-0.6, 0.6, dot(normalize(vec3(rq, 0.2)), L)));
    bool front = rq.y < 0.0;
    float over = front ? ring : ring * (1.0 - disc);
    outc = outc * (1.0 - over) + rc * over;
    outa = outa + over * (1.0 - outa);
  }

  if (outa < 0.002 && dot(outc, outc) < 0.00001) discard;
  gl_FragColor = vec4(outc, outa);
}`;

/* ---- plumbing ----------------------------------------------------------- */

function compile(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`shader: ${log}`);
    }
    return s;
  };
  const p = gl.createProgram()!;
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;
const uniforms = (gl: WebGLRenderingContext, p: WebGLProgram, names: string[]): Uniforms =>
  Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));

/** Mulberry32. Seeded, so the sky is the same sky on every visit. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- the engine --------------------------------------------------------- */

export interface SkyOptions {
  level: MotionLevel;
  accent: string;
  onLost: () => void;
}

export class SkyEngine {
  private gl: WebGLRenderingContext;
  private nebulaProg: WebGLProgram;
  private composeProg: WebGLProgram;
  private starProg: WebGLProgram;
  private planetProg: WebGLProgram;
  private pu: Uniforms;
  private nu: Uniforms;
  private cu: Uniforms;
  private su: Uniforms;
  private quad: WebGLBuffer;
  private stars: WebGLBuffer;
  private starMax: number;
  private starDraw: number;
  private fbo: WebGLFramebuffer;
  private tex: WebGLTexture;
  private fboW = 0;
  private fboH = 0;

  private level: MotionLevel;
  private raf = 0;
  private last = 0;
  private frame = 0;
  private time = 0;
  private travel = 0;
  private roll = 0;
  private ptr: [number, number] = [0, 0];
  private par: [number, number] = [0, 0];
  private accent: RGB;
  private accentAmt: number;
  private accentTarget: RGB;
  private accentAmtTarget: number;
  private warpT = -1;
  private warpDur = 1.8;
  private warpGain = 1;
  private nebulaDirty = true;
  private disposed = false;

  // Demote-only quality. Each step is cheaper and none of them is visible as
  // a change in what the sky is, only in how finely it is drawn.
  private nebulaScale = 0.34;
  private planetOct = 4;
  private nebulaEvery = 2;
  private dprCap = 1.5;
  private samples: number[] = [];
  private step = 0;

  constructor(private canvas: HTMLCanvasElement, private opts: SkyOptions) {
    const attrs: WebGLContextAttributes = {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    };
    const gl = (canvas.getContext('webgl', attrs) ||
      canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
    if (!gl) throw new Error('no WebGL');
    this.gl = gl;
    this.level = opts.level;

    this.nebulaProg  = compile(gl, QUAD_VS, NEBULA_FS);
    this.composeProg = compile(gl, QUAD_VS, COMPOSE_FS);
    this.starProg    = compile(gl, STAR_VS, STAR_FS);
    this.planetProg  = compile(gl, PLANET_VS, PLANET_FS);
    this.pu = uniforms(gl, this.planetProg, ['uCenter', 'uHalf', 'uAspect', 'uRadius', 'uKind', 'uTime', 'uPix', 'uLight', 'uAtmos', 'uStorm', 'uOct', 'uSpin', 'uTint']);
    this.nu = uniforms(gl, this.nebulaProg, ['uTime', 'uAspect', 'uRoll', 'uOffset', 'uAccent', 'uAccentAmt']);
    this.cu = uniforms(gl, this.composeProg, ['uNebula', 'uSeed']);
    this.su = uniforms(gl, this.starProg, ['uTravel', 'uTime', 'uRoll', 'uAspect', 'uPx', 'uTwinkle', 'uWarp', 'uParallax', 'uLayer']);

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    // Star count follows screen area, so a phone and a 4K monitor have the
    // same density rather than the same number.
    //
    // Interleaved dome / Milky Way / field, so that when the governor trims
    // the draw count it thins every layer evenly instead of deleting one.
    const area = window.innerWidth * window.innerHeight;
    this.starMax = Math.round(Math.min(8000, Math.max(2000, area / 190)));
    this.starDraw = this.starMax;
    const r = rng(0x5eed);
    const data = new Float32Array(this.starMax * 6);
    // Gaussian, for the Milky Way's cross-section.
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-6, r()))) * Math.cos(2 * Math.PI * r());
    for (let i = 0; i < this.starMax; i++) {
      const slot = i % 10;
      const dome  = slot < 3;             // 30% dome
      const grain = slot >= 3 && slot < 6; // 30% Milky Way grain
      const o = i * 6;
      if (grain) {
        data[o + 0] = (r() * 2 - 1) * 1.05;
        data[o + 1] = gauss() * 0.075;     // offset from the lane, not a y
        data[o + 2] = -2;
      } else {
        data[o + 0] = (r() * 2 - 1) * (dome ? 1.02 : 1.15);
        data[o + 1] = (r() * 2 - 1) * (dome ? 1.02 : 1.15);
        data[o + 2] = dome ? -1 : r();
      }
      data[o + 3] = r();
      data[o + 4] = r();
      data[o + 5] = !grain && r() < (dome ? 0.008 : 0.010) ? 1 : 0;
    }
    this.stars = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stars);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    this.tex = gl.createTexture()!;
    this.fbo = gl.createFramebuffer()!;

    const a = ACCENTS[opts.accent] ?? ACCENTS.neutral;
    this.accent = [...a.rgb];
    this.accentTarget = [...a.rgb];
    this.accentAmt = a.amt;
    this.accentAmtTarget = a.amt;

    canvas.addEventListener('webglcontextlost', this.onLost, false);
    window.addEventListener('resize', this.onResize, { passive: true });
    if (this.level === 'full') {
      window.addEventListener('pointermove', this.onPointer, { passive: true });
    }
    this.resize();
  }

  /* ---- public ----------------------------------------------------------- */

  start() {
    if (this.level === 'still') { this.render(0); return; }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  setAccent(key: string) {
    const a = ACCENTS[key] ?? ACCENTS.neutral;
    this.accentTarget = [...a.rgb];
    this.accentAmtTarget = a.amt;
    if (this.level === 'still') {
      this.accent = [...a.rgb];
      this.accentAmt = a.amt;
      this.nebulaDirty = true;
      this.render(0);
    }
  }

  /** A surge through the field. Full motion only — it is the one thing here
   *  that rushes toward the viewer, so it is exactly what reduced motion is
   *  for. */
  warp(gain = 1, seconds = 1.8) {
    if (this.level !== 'full') return;
    this.warpT = 0;
    this.warpGain = gain;
    this.warpDur = seconds;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointer);
    const gl = this.gl;
    if (!gl.isContextLost()) {
      gl.deleteBuffer(this.quad);
      gl.deleteBuffer(this.stars);
      gl.deleteTexture(this.tex);
      gl.deleteFramebuffer(this.fbo);
      gl.deleteProgram(this.nebulaProg);
      gl.deleteProgram(this.composeProg);
      gl.deleteProgram(this.starProg);
      gl.deleteProgram(this.planetProg);
    }
  }

  /* ---- events ----------------------------------------------------------- */

  private onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.raf);
    if (!this.disposed) this.opts.onLost();
  };

  private onResize = () => {
    this.resize();
    if (this.level === 'still') this.render(0);
  };

  private onPointer = (e: PointerEvent) => {
    this.ptr = [
      (e.clientX / window.innerWidth) * 2 - 1,
      -((e.clientY / window.innerHeight) * 2 - 1),
    ];
  };

  /* ---- sizing ----------------------------------------------------------- */

  private resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const fw = Math.max(64, Math.floor(this.canvas.clientWidth * this.nebulaScale));
    const fh = Math.max(64, Math.floor(this.canvas.clientHeight * this.nebulaScale));
    if (fw !== this.fboW || fh !== this.fboH) {
      this.fboW = fw;
      this.fboH = fh;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.nebulaDirty = true;
  }

  /* ---- the loop --------------------------------------------------------- */

  private tick = (now: number) => {
    if (this.disposed) return;
    // Clamped, so returning to a background tab resumes rather than jumps.
    const dtMs = now - this.last;
    const dt = Math.min(0.05, dtMs / 1000);
    this.last = now;
    this.govern(dtMs);
    this.render(dt);
    this.raf = requestAnimationFrame(this.tick);
  };

  private render(dt: number) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const full = this.level === 'full';

    this.time += dt * (full ? 1 : 0.5);

    let warp = 0;
    if (this.warpT >= 0) {
      this.warpT += dt;
      const x = this.warpT / this.warpDur;
      if (x >= 1) this.warpT = -1;
      else warp = Math.pow(Math.sin(Math.PI * x), 2) * this.warpGain;
    }

    if (full) {
      this.travel += dt * 0.016 * (1 + warp * 18);
      this.roll += dt * 0.0035;
      const scroll = window.scrollY / Math.max(1, window.innerHeight);
      const tx = this.ptr[0] * 0.5;
      const ty = this.ptr[1] * 0.5 + scroll * 0.6;
      const k = Math.min(1, dt * 2.2);
      this.par[0] += (tx - this.par[0]) * k;
      this.par[1] += (ty - this.par[1]) * k;
    }

    const ka = dt > 0 ? Math.min(1, dt * 1.4) : 1;
    for (let i = 0; i < 3; i++) this.accent[i] += (this.accentTarget[i] - this.accent[i]) * ka;
    this.accentAmt += (this.accentAmtTarget - this.accentAmt) * ka;

    const W = this.canvas.width, H = this.canvas.height;
    const aspect = W / H;

    // 1. nebula, at a fraction of the resolution and a fraction of the rate
    if (this.nebulaDirty || this.frame % this.nebulaEvery === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.fboW, this.fboH);
      gl.disable(gl.BLEND);
      gl.useProgram(this.nebulaProg);
      gl.uniform1f(this.nu.uTime, this.time);
      gl.uniform1f(this.nu.uAspect, aspect);
      gl.uniform1f(this.nu.uRoll, this.roll);
      gl.uniform2f(this.nu.uOffset, this.par[0] * 0.02, this.par[1] * 0.02);
      gl.uniform3f(this.nu.uAccent, this.accent[0], this.accent[1], this.accent[2]);
      gl.uniform1f(this.nu.uAccentAmt, this.accentAmt);
      this.drawQuad(this.nebulaProg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.nebulaDirty = false;
    }
    this.frame++;

    // 2. compose
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.composeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.cu.uNebula, 0);
    gl.uniform1f(this.cu.uSeed, (this.frame % 64) * 1.37);
    this.drawQuad(this.composeProg);

    // 3. far stars, 4. planets, 5. near stars
    this.drawStars(0, aspect, warp);
    this.drawPlanets(aspect, H);
    this.drawStars(1, aspect, warp);
  }

  private drawStars(layer: 0 | 1, aspect: number, warp: number) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.starProg);
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    gl.uniform1f(this.su.uTravel, this.travel);
    gl.uniform1f(this.su.uTime, this.time);
    gl.uniform1f(this.su.uRoll, this.roll);
    gl.uniform1f(this.su.uAspect, aspect);
    gl.uniform1f(this.su.uPx, dpr);
    gl.uniform1f(this.su.uTwinkle, this.level === 'still' ? 0 : this.level === 'gentle' ? 0.5 : 1);
    gl.uniform1f(this.su.uWarp, warp);
    gl.uniform2f(this.su.uParallax, this.par[0], this.par[1]);
    gl.uniform1f(this.su.uLayer, layer);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.stars);
    const aPos = gl.getAttribLocation(this.starProg, 'aPos');
    const aSeed = gl.getAttribLocation(this.starProg, 'aSeed');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(aSeed);
    gl.vertexAttribPointer(aSeed, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.POINTS, 0, this.starDraw);
    gl.disableVertexAttribArray(aSeed);
    gl.disableVertexAttribArray(aPos);
  }

  /**
   * The system, at time t. Positions are per aspect ratio so nothing sits
   * behind the reading column; every body drifts on its own slow path and
   * turns on its own axis, and the moons are on real orbits.
   *
   * THE MOONS ARE KEPLERIAN. The giant's centre is below the viewport, so a
   * circular orbit would keep its moons off-screen or hidden behind the
   * planet most of the time (simulated: ~25% visible). With the giant at one
   * focus of an eccentric ellipse and the apoapsis pointed up into the frame,
   * each moon slows down exactly where it can be seen and whips round the
   * hidden side — ~55-60% visible, about half of that in front of the giant.
   * Which is also simply how orbits work.
   */
  private bodies(aspect: number, t: number, giantAtmos: RGB): Body[] {
    const hw = aspect / 2;
    const TAU = Math.PI * 2;
    const wide = aspect >= 1;
    const out: Body[] = [];
    const bob = (ax: number, ay: number, px: number, py: number, ph: number): [number, number] =>
      [ax * Math.sin((t * TAU) / px + ph), ay * Math.cos((t * TAU) / py + ph)];

    const push = (b: Body) => out.push(b);

    // A moon on an orbit with its parent at one focus. `k` squashes the orbit
    // plane for the viewing angle; the far half (sin E > 0) sits behind.
    const moon = (parent: Body, o: { a: number; e: number; k: number; tilt: number; period: number; phase: number; r: number; tint: RGB; spin: number }) => {
      const M = ((t / o.period) * TAU + o.phase) % TAU;
      let E = M;
      for (let i = 0; i < 6; i++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
      const lx = o.a * (Math.cos(E) - o.e);
      const ly = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E) * o.k;
      const c = Math.cos(o.tilt), s = Math.sin(o.tilt);
      push({
        kind: 2, r: o.r, spin: o.spin, tint: o.tint, atmos: [0, 0, 0], depth: parent.depth,
        x: parent.x + lx * c - ly * s,
        y: parent.y + lx * s + ly * c,
        z: parent.z + (ly > 0 ? -0.1 : 0.1),
      });
    };

    const ICE: RGB = [0.86, 0.94, 1.08];
    const STONE: RGB = [1, 1, 1];

    if (wide) {
      const [ex, ey] = bob(0.006, 0.005, 71, 83, 0.4);
      push({ kind: 4, x: -hw + 0.075 + ex, y: 0.40 + ey, r: 0.017, z: 0, depth: 0.008, spin: 0.06, atmos: [0, 0, 0], tint: STONE });

      // The ocean world lives in the left margin, and the margin shrinks with
      // the aspect ratio: at 4:3 it is a third narrower than at 16:10, so the
      // planet shrinks and tucks in rather than sliding behind a card.
      const fit = Math.min(1, Math.max(0.6, (aspect - 1) / 0.6));
      const [ox, oy] = bob(0.012 * fit, 0.010, 47, 61, 1.3);
      push({ kind: 3, x: -hw + 0.05 + 0.08 * fit + ox, y: -0.30 + oy, r: 0.056 * fit, z: 1, depth: 0.022, spin: 0.08, atmos: [0.35, 0.80, 1.0], tint: STONE });

      // Saturn stays where it is: no drift, no parallax. It turns in place —
      // surface and rings — and its moon goes round it.
      const ringed: Body = { kind: 1, x: hw - 0.12, y: 0.35, r: 0.056, z: 2, depth: 0, spin: 0.22, atmos: [0, 0, 0], tint: STONE };
      push(ringed);
      moon(ringed, { a: ringed.r * 3.0, e: 0.12, k: 0.30, tilt: -0.30, period: 23, phase: 0.8, r: ringed.r * 0.21, tint: ICE, spin: 0.2 });

      const giant: Body = { kind: 0, x: hw - 0.02, y: -0.66, r: 0.46, z: 3, depth: 0.030, spin: 0.045, atmos: giantAtmos, tint: STONE };
      push(giant);
      moon(giant, { a: 0.55, e: 0.50, k: 0.35, tilt: -0.75, period: 70, phase: 2.6, r: 0.026, tint: STONE, spin: 0.05 });
      moon(giant, { a: 0.40, e: 0.60, k: 0.40, tilt: -1.10, period: 44, phase: 0.3, r: 0.015, tint: ICE, spin: 0.08 });
    } else {
      // On a phone the cards fill the width and their planets sit on the
      // right, so the ocean world peeks in from the LEFT edge, half out of
      // frame, where nothing else lives.
      const [ox, oy] = bob(0.004, 0.010, 47, 61, 1.3);
      push({ kind: 3, x: -hw + 0.004 + ox, y: -0.10 + oy, r: 0.040, z: 1, depth: 0.022, spin: 0.08, atmos: [0.35, 0.80, 1.0], tint: STONE });

      const ringed: Body = { kind: 1, x: hw - 0.075, y: 0.37, r: 0.036, z: 2, depth: 0, spin: 0.22, atmos: [0, 0, 0], tint: STONE };
      push(ringed);
      moon(ringed, { a: ringed.r * 3.0, e: 0.12, k: 0.30, tilt: -0.30, period: 23, phase: 0.8, r: ringed.r * 0.21, tint: ICE, spin: 0.2 });

      const giant: Body = { kind: 0, x: -hw + 0.04, y: -0.64, r: 0.34, z: 3, depth: 0.030, spin: 0.045, atmos: giantAtmos, tint: STONE };
      push(giant);
      moon(giant, { a: 0.40, e: 0.60, k: 0.40, tilt: -2.0, period: 70, phase: 2.6, r: 0.020, tint: STONE, spin: 0.05 });
      moon(giant, { a: 0.30, e: 0.60, k: 0.40, tilt: -2.2, period: 44, phase: 0.3, r: 0.012, tint: ICE, spin: 0.08 });
    }
    return out.sort((p, q) => p.z - q.z);
  }

  private drawPlanets(aspect: number, H: number) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied
    gl.useProgram(this.planetProg);
    gl.uniform1f(this.pu.uAspect, aspect);
    // Kept small: the noise hashes lose precision at large coordinates, and a
    // wrap every ~2.7 hours is invisible.
    const t = this.time % 10000;
    gl.uniform1f(this.pu.uTime, t);
    gl.uniform1f(this.pu.uOct, this.planetOct);
    gl.uniform3f(this.pu.uLight, -0.55, 0.45, 0.70);
    // The giant's atmosphere takes a little of the event's colour, its storm
    // more.
    const a = this.accent, k = 0.35 * this.accentAmt;
    const giantAtmos: RGB = [0.36 + (a[0] - 0.36) * k, 0.74 + (a[1] - 0.74) * k, 1.0 + (a[2] - 1.0) * k];
    gl.uniform3f(this.pu.uStorm, 0.55 + a[0] * 0.45, 0.30 + a[1] * 0.40, 0.30 + a[2] * 0.30);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(this.planetProg, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const HALF: Record<number, number> = { 0: 1.25, 1: 2.45, 2: 1.05, 3: 1.35, 4: 1.1 };
    for (const b of this.bodies(aspect, t, giantAtmos)) {
      // Mid-distance: they parallax more than the gas, less than near stars.
      const cx = b.x + this.par[0] * b.depth;
      const cy = b.y + this.par[1] * b.depth;
      const half = b.r * HALF[b.kind];
      if (Math.abs(cx) - half > aspect / 2 || Math.abs(cy) - half > 0.5) continue;   // off-screen
      gl.uniform2f(this.pu.uCenter, cx, cy);
      gl.uniform1f(this.pu.uHalf, half);
      gl.uniform1f(this.pu.uRadius, b.r);
      gl.uniform1f(this.pu.uKind, b.kind);
      gl.uniform1f(this.pu.uSpin, b.spin);
      gl.uniform3f(this.pu.uTint, b.tint[0], b.tint[1], b.tint[2]);
      gl.uniform3f(this.pu.uAtmos, b.atmos[0], b.atmos[1], b.atmos[2]);
      gl.uniform1f(this.pu.uPix, 1.2 / (H * b.r));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disableVertexAttribArray(loc);
  }

  private drawQuad(prog: WebGLProgram) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
  }

  /**
   * Watches real frame intervals and steps quality down, never up — quality
   * that oscillates reads as stutter. Median over ~1.5s at 60Hz; a device
   * holding under ~40fps loses one step at a time.
   */
  private govern(ms: number) {
    if (ms <= 0 || ms > 250) return; // tab switches and debugger pauses
    this.samples.push(ms);
    if (this.samples.length < 90) return;
    const s = [...this.samples].sort((a, b) => a - b);
    const med = s[s.length >> 1];
    this.samples = [];
    if (med <= 24) return;

    // Ordered by cost saved per unit of visible change: the first steps are
    // work nobody can see go (gas refresh rate, surface octaves, a thinner
    // but still dense field); resolution goes last.
    this.step++;
    if (this.step === 1) this.nebulaEvery = 3;
    else if (this.step === 2) this.starDraw = Math.round(this.starMax * 0.55);
    else if (this.step === 3) this.planetOct = 2;
    else if (this.step === 4) { this.nebulaScale = 0.24; this.resize(); }
    else if (this.step === 5) { this.dprCap = 1; this.resize(); }
    else if (this.step === 6) { this.nebulaEvery = 5; this.starDraw = Math.round(this.starMax * 0.35); }
  }
}
