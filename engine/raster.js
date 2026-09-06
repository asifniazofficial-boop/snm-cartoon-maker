import zlib from "node:zlib";

// A tiny software rasterizer that writes PNGs with no native dependencies.
// Everything is drawn at `ss`x resolution and box-downsampled on export, which
// gives antialiasing for free instead of per-primitive coverage maths.

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function parseColor(c) {
  if (Array.isArray(c)) return c;
  const h = String(c).replace("#", "").trim();
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Mix two colors; t=0 -> a, t=1 -> b.
export function mix(a, b, t) {
  const [ar, ag, ab] = parseColor(a);
  const [br, bg, bb] = parseColor(b);
  return [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t];
}

// Lighten (t>0) or darken (t<0) a color.
export function shade(c, t) {
  return t >= 0 ? mix(c, [255, 255, 255], t) : mix(c, [0, 0, 0], -t);
}

export class Canvas {
  constructor(width, height, ss = 2) {
    this.width = width;
    this.height = height;
    this.ss = ss;
    this.w = width * ss;
    this.h = height * ss;
    this.data = Buffer.alloc(this.w * this.h * 3);
  }

  blend(x, y, color, alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    const d = this.data;
    if (alpha >= 1) {
      d[i] = color[0];
      d[i + 1] = color[1];
      d[i + 2] = color[2];
      return;
    }
    d[i] += (color[0] - d[i]) * alpha;
    d[i + 1] += (color[1] - d[i + 1]) * alpha;
    d[i + 2] += (color[2] - d[i + 2]) * alpha;
  }

  fillRect(x, y, w, h, color, alpha = 1) {
    const c = parseColor(color);
    const s = this.ss;
    const x0 = Math.max(0, Math.round(x * s));
    const y0 = Math.max(0, Math.round(y * s));
    const x1 = Math.min(this.w, Math.round((x + w) * s));
    const y1 = Math.min(this.h, Math.round((y + h) * s));
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this.blend(px, py, c, alpha);
  }

  // Vertical gradient — the workhorse for skies, water and walls.
  gradient(x, y, w, h, from, to) {
    const a = parseColor(from);
    const b = parseColor(to);
    const s = this.ss;
    const y0 = Math.max(0, Math.round(y * s));
    const y1 = Math.min(this.h, Math.round((y + h) * s));
    const x0 = Math.max(0, Math.round(x * s));
    const x1 = Math.min(this.w, Math.round((x + w) * s));
    const span = Math.max(1, y1 - y0);
    for (let py = y0; py < y1; py++) {
      const t = (py - y0) / span;
      const col = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      for (let px = x0; px < x1; px++) this.blend(px, py, col, 1);
    }
  }

  ellipse(cx, cy, rx, ry, color, alpha = 1) {
    const c = parseColor(color);
    const s = this.ss;
    const CX = cx * s;
    const CY = cy * s;
    const RX = Math.max(0.5, rx * s);
    const RY = Math.max(0.5, ry * s);
    const x0 = Math.max(0, Math.floor(CX - RX));
    const x1 = Math.min(this.w, Math.ceil(CX + RX) + 1);
    const y0 = Math.max(0, Math.floor(CY - RY));
    const y1 = Math.min(this.h, Math.ceil(CY + RY) + 1);
    for (let py = y0; py < y1; py++) {
      const dy = (py + 0.5 - CY) / RY;
      for (let px = x0; px < x1; px++) {
        const dx = (px + 0.5 - CX) / RX;
        if (dx * dx + dy * dy <= 1) this.blend(px, py, c, alpha);
      }
    }
  }

  circle(cx, cy, r, color, alpha = 1) {
    this.ellipse(cx, cy, r, r, color, alpha);
  }

  // Even-odd scanline fill. `pts` is a flat [[x,y], ...] array in output units.
  polygon(pts, color, alpha = 1) {
    if (pts.length < 3) return;
    const c = parseColor(color);
    const s = this.ss;
    const P = pts.map(([x, y]) => [x * s, y * s]);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of P) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h, Math.ceil(maxY) + 1);
    const xs = [];
    for (let py = y0; py < y1; py++) {
      const sy = py + 0.5;
      xs.length = 0;
      for (let i = 0, n = P.length; i < n; i++) {
        const [ax, ay] = P[i];
        const [bx, by] = P[(i + 1) % n];
        if (ay === by) continue;
        if (sy >= Math.min(ay, by) && sy < Math.max(ay, by)) {
          xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const px0 = Math.max(0, Math.round(xs[k]));
        const px1 = Math.min(this.w, Math.round(xs[k + 1]));
        for (let px = px0; px < px1; px++) this.blend(px, py, c, alpha);
      }
    }
  }

  roundRect(x, y, w, h, r, color, alpha = 1) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    this.fillRect(x + rad, y, w - 2 * rad, h, color, alpha);
    this.fillRect(x, y + rad, rad, h - 2 * rad, color, alpha);
    this.fillRect(x + w - rad, y + rad, rad, h - 2 * rad, color, alpha);
    this.circle(x + rad, y + rad, rad, color, alpha);
    this.circle(x + w - rad, y + rad, rad, color, alpha);
    this.circle(x + rad, y + h - rad, rad, color, alpha);
    this.circle(x + w - rad, y + h - rad, rad, color, alpha);
  }

  // Thick line drawn as a quad plus round caps.
  line(x1, y1, x2, y2, width, color, alpha = 1) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    this.polygon(
      [
        [x1 + nx, y1 + ny],
        [x2 + nx, y2 + ny],
        [x2 - nx, y2 - ny],
        [x1 - nx, y1 - ny],
      ],
      color,
      alpha
    );
    this.circle(x1, y1, width / 2, color, alpha);
    this.circle(x2, y2, width / 2, color, alpha);
  }

  // Darkens the frame edges — cheap way to make a flat scene read as cinematic.
  vignette(strength = 0.35) {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const maxD = Math.hypot(cx, cy);
    for (let py = 0; py < this.h; py++) {
      for (let px = 0; px < this.w; px++) {
        const d = Math.hypot(px - cx, py - cy) / maxD;
        const a = Math.max(0, (d - 0.55) / 0.45) ** 2 * strength;
        if (a > 0.002) this.blend(px, py, [0, 0, 0], a);
      }
    }
  }

  // Deterministic per-pixel noise (seeded), used by the paper/sketch styles.
  grain(amount = 8, seed = 1) {
    let s = seed >>> 0 || 1;
    const d = this.data;
    for (let i = 0; i < d.length; i += 3) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      const n = ((s & 255) / 255 - 0.5) * amount;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
  }

  // Box-downsample the supersampled buffer and encode as a truecolor PNG.
  toPNG() {
    const { width, height, ss, w, data } = this;
    const stride = width * 3 + 1;
    const raw = Buffer.alloc(stride * height);
    const n = ss * ss;
    for (let y = 0; y < height; y++) {
      const rowStart = y * stride;
      raw[rowStart] = 0; // filter: none
      for (let x = 0; x < width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < ss; sy++) {
          let i = ((y * ss + sy) * w + x * ss) * 3;
          for (let sx = 0; sx < ss; sx++) {
            r += data[i++];
            g += data[i++];
            b += data[i++];
          }
        }
        const o = rowStart + 1 + x * 3;
        raw[o] = r / n;
        raw[o + 1] = g / n;
        raw[o + 2] = b / n;
      }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolor
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

// Small deterministic PRNG so a given seed always redraws the identical frame.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
