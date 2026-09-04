/**
 * Generates the PWA raster icons (public/icon-{180,192,512}.png) from the
 * same art as public/icon.svg — WITHOUT any dependency (no canvas, no
 * rasterizer library).
 *
 * Why not reuse the SVG directly? Chromium's installability criteria want
 * 192px and 512px PNG icons, and iOS needs a PNG apple-touch-icon; node has
 * no SVG rasterizer. Instead this script draws the SVG's shapes itself:
 * every stroke path is flattened into polylines (lines / cubic Béziers /
 * elliptical arcs) and each pixel's alpha is derived from its distance to
 * the stroke centreline — so the output matches the favicon design exactly.
 *
 * Usage: `npm run gen:icons` (or `node scripts/gen-icons.mjs`).
 * Re-run after editing the art constants below; commit the PNGs.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* --- Art constants (mirrors public/icon.svg) --- */

const BG = { r: 0x0f, g: 0x6b, b: 0x58 }; // #0f6b58 — brand primary
const WHITE = { r: 0xff, g: 0xff, b: 0xff };
const STROKE = 1.8; // stroke width on the 24×24 grid
const VIEW = 24;

/** Background: <rect width=24 height=24 rx=5/> (fill). */
const BG_RX = 5;

/** White strokes, width STROKE, round caps/joins, from the <g> in icon.svg. */
const PATHS = [
  "M10 3h4",
  "m21 9-2 2-1.5-3.7A2 2 0 0 0 15.646 6H8.354a2 2 0 0 0-1.854 1.3L5 11 3 9",
  "M7 15h.01",
  "M17 15h.01",
  "M5 19H3a1 1 0 0 1-1-1v-4l2-4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2l2 4v4a1 1 0 0 1-1 1h-2",
  "M6 19h12",
];

/** <circle> dots from icon.svg (stroked, so a tiny circle ≈ a dot). */
const CIRCLES = [
  { cx: 7.5, cy: 15.5, r: 0.5 },
  { cx: 16.5, cy: 15.5, r: 0.5 },
];

const SIZES = [
  { file: "icon-180.png", px: 180 },
  { file: "icon-192.png", px: 192 },
  { file: "icon-512.png", px: 512 },
];

/* --- SVG path → polylines --- */

const re = /([MmLlHhVvCcAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/g;

/** Parses one SVG path `d` into polylines of points on the 24×24 grid. */
function flattenPath(d) {
  const polylines = [];
  let current = [0, 0];
  let subpathStart = [0, 0];

  // Tokens are already separated by the regex; letters are commands and
  // numbers are their arguments. A command with leftover numbers repeats.
  const tokens = [...d.matchAll(re)];
  let i = 0;

  while (i < tokens.length) {
    const raw = tokens[i][0];
    if (!/[A-Za-z]/.test(raw)) throw new Error(`expected a command at token ${i}`);
    const cmd = raw;
    i += 1;

    const argCount = (c) => {
      switch (c.toUpperCase()) {
        case "M":
        case "L":
          return 2;
        case "H":
        case "V":
          return 1;
        case "C":
          return 6;
        case "A":
          return 7;
        default:
          return 0;
      }
    };

    // Read `n` numeric arguments; null when a command letter interrupts.
    const readArgs = (n) => {
      const args = [];
      for (let k = 0; k < n; k += 1) {
        const t = tokens[i];
        if (!t || /[A-Za-z]/.test(t[0])) return null;
        args.push(Number(t[0]));
        i += 1;
      }
      return args;
    };

    // Run the command, then keep consuming extra number groups; extra
    // pairs after M/m are implicit L/l (same case).
    exec(cmd, readArgs(argCount(cmd)) ?? []);
    let repeat = cmd === "M" ? "L" : cmd === "m" ? "l" : cmd;
    for (;;) {
      const next = tokens[i];
      if (!next || /[A-Za-z]/.test(next[0])) break;
      const args = readArgs(argCount(repeat));
      if (!args) break;
      exec(repeat, args);
    }

    function exec(c, args) {
      const relative = c === c.toLowerCase();
      const C = (x, y) => (relative ? [current[0] + x, current[1] + y] : [x, y]);
      switch (c.toUpperCase()) {
        case "M": {
          const p = C(args[0], args[1]);
          current = p;
          subpathStart = p;
          polylines.push([p]);
          break;
        }
        case "L": {
          const p = C(args[0], args[1]);
          current = p;
          polylines[polylines.length - 1].push(p);
          break;
        }
        case "H": {
          current = [relative ? current[0] + args[0] : args[0], current[1]];
          polylines[polylines.length - 1].push(current);
          break;
        }
        case "V": {
          current = [current[0], relative ? current[1] + args[0] : args[0]];
          polylines[polylines.length - 1].push(current);
          break;
        }
        case "C": {
          const c1 = C(args[0], args[1]);
          const c2 = C(args[2], args[3]);
          const end = C(args[4], args[5]);
          sampleCubic(current, c1, c2, end).forEach((p) => {
            polylines[polylines.length - 1].push(p);
          });
          current = end;
          break;
        }
        case "A": {
          const end = C(args[5], args[6]);
          arcToCenter(current, end, args[0], args[1], args[2], args[3], args[4]).forEach(
            (p) => polylines[polylines.length - 1].push(p),
          );
          current = end;
          break;
        }
        default:
          throw new Error(`unsupported path command: ${c.toUpperCase()}`);
      }
    }
  }
  return polylines;
}

/** Samples a cubic Bézier (de Casteljau, adaptive-ish fixed 12 steps). */
function sampleCubic(p0, p1, p2, p3) {
  const pts = [];
  const n = 12;
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

/** SVG elliptical arc endpoint → centre parametrisation (spec F.6.5). */
function arcToCenter(p0, p1, rx, ry, phiDeg, largeArc, sweep) {
  const [x1, y1] = p0;
  const [x2, y2] = p1;
  if (x1 === x2 && y1 === y2) return [];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rxx = Math.abs(rx);
  let ryy = Math.abs(ry);
  const lambda = (x1p * x1p) / (rxx * rxx) + (y1p * y1p) / (ryy * ryy);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rxx *= s;
    ryy *= s;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = Math.max(
    0,
    rxx * rxx * ryy * ryy - rxx * rxx * y1p * y1p - ryy * ryy * x1p * x1p,
  );
  const denominator = rxx * rxx * y1p * y1p + ryy * ryy * x1p * x1p;
  const coef = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cxp = coef * ((rxx * y1p) / ryy);
  const cyp = coef * (-(ryy * x1p) / rxx);
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    const a = Math.acos(Math.max(-1, Math.min(1, dot)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rxx, (y1p - cyp) / ryy);
  let dTheta = angle(
    (x1p - cxp) / rxx,
    (y1p - cyp) / ryy,
    (-x1p - cxp) / rxx,
    (-y1p - cyp) / ryy,
  );
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(dTheta) / (Math.PI / 24)));
  const pts = [];
  for (let i = 1; i <= steps; i += 1) {
    const a = theta1 + dTheta * (i / steps);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    pts.push([cx + rxx * ca * cos - ryy * sa * sin, cy + rxx * ca * sin + ryy * sa * cos]);
  }
  return pts;
}

/** Circle → polyline (many small points, stroked = ring or dot). */
function flattenCircle(cx, cy, r) {
  const pts = [];
  const steps = Math.max(16, Math.ceil((2 * Math.PI * r) / 0.4));
  for (let i = 1; i <= steps; i += 1) {
    const a = (2 * Math.PI * i) / steps;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return [pts];
}

/* --- Distance / coverage rendering --- */

const halfWidth = STROKE / 2;

/** Distance from a point to a polyline segment set (min over segments). */
function distToPolyline(px, py, polyline) {
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const [ax, ay] = polyline[i];
    const [bx, by] = polyline[i + 1];
    const abx = bx - ax;
    const aby = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1)));
    const dx = px - (ax + t * abx);
    const dy = py - (ay + t * aby);
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

/** Signed distance to a rounded rectangle (negative inside). */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const mix = (a, b, t) => a + (b - a) * t;

/** Rasterizes the icon art at `px` pixels. Returns raw RGBA bytes. */
function rasterize(px) {
  const scale = px / VIEW;
  const halfW = halfWidth * scale;
  // Device-pixel AA radius (±1 px edge).
  const aaL = Math.max(0.75, scale * 0.04);

  const bgRad = BG_RX * scale;
  const bgHalf = (VIEW / 2) * scale;
  const center = px / 2;

  // Flatten art on the 24-grid, then scale to pixel space.
  const strokes = [
    ...PATHS.map((d, index) => {
      try {
        return flattenPath(d);
      } catch (error) {
        throw new Error(`failed to parse path #${index}: ${d}`, { cause: error });
      }
    }).flat(),
    ...CIRCLES.flatMap(flattenCircle),
  ].map(
    (poly) => poly.map(([x, y]) => [x * scale, y * scale]),
  );
  const boxes = strokes.map((poly) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return [minX - halfW - 1, minY - halfW - 1, maxX + halfW + 1, maxY + halfW + 1];
  });

  const data = Buffer.alloc(px * px * 4);
  for (let py = 0; py < px; py += 1) {
    for (let px2 = 0; px2 < px; px2 += 1) {
      const i = (py * px + px2) * 4;
      const x = px2 + 0.5;
      const y = py + 0.5;

      // Background rounded rect.
      const bgD = sdRoundRect(x, y, center, center, bgHalf, bgHalf, bgRad);
      if (bgD > aaL) continue; // fully outside → transparent
      const bgCov = Math.max(0, Math.min(1, 0.5 - bgD / (2 * aaL)));
      if (bgCov <= 0) continue;

      // White strokes (each polyline within its bbox).
      let whiteCov = 0;
      for (let s = 0; s < strokes.length; s += 1) {
        const [minX, minY, maxX, maxY] = boxes[s];
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const d = distToPolyline(x, y, strokes[s]);
        whiteCov = Math.max(whiteCov, Math.max(0, Math.min(1, 0.5 + (halfW - d) / (2 * aaL))));
        if (whiteCov >= 1) break;
      }

      const a = mix(BG.r, WHITE.r, whiteCov);
      const b = mix(BG.g, WHITE.g, whiteCov);
      const c = mix(BG.b, WHITE.b, whiteCov);
      data[i] = Math.round(a);
      data[i + 1] = Math.round(b);
      data[i + 2] = Math.round(c);
      data[i + 3] = Math.round(255 * bgCov);
    }
  }
  return data;
}

/* --- Minimal PNG writer (no dependencies: zlib + manual chunks) --- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(px, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = px * 4;
  const raw = Buffer.alloc((stride + 1) * px);
  for (let y = 0; y < px; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --- Main --- */

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(outDir, { recursive: true });
for (const { file, px } of SIZES) {
  const png = encodePng(px, rasterize(px));
  writeFileSync(join(outDir, file), png);
  console.log(`wrote public/${file} (${png.length} bytes)`);
}
