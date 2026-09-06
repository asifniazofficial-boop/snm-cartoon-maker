import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Canvas } from "../engine/raster.js";

// Draws the app icon with the same rasterizer that draws the films, so the icon
// is literally a frame from the engine: gradient sky, a cartoon face, a smile.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function drawIcon(size) {
  const cv = new Canvas(size, size, 2);
  const u = size / 100; // draw in a 0..100 coordinate space

  // brand gradient (the UI accent colors) with a soft radial glow
  cv.gradient(0, 0, size, size, "#ff9f43", "#ff5f8d");
  for (let i = 5; i > 0; i--) cv.circle(50 * u, 40 * u, 38 * u * (1 + i * 0.12), "#ffffff", 0.03);

  // face
  const fy = 46 * u;
  const fr = 26 * u;
  cv.circle(50 * u, fy, fr + 1.6 * u, "#7a2e1f", 0.35); // soft outline
  cv.circle(50 * u, fy, fr, "#ffd9a8");

  // hair cap
  cv.ellipse(50 * u, fy - fr * 0.62, fr * 1.03, fr * 0.62, "#5a3a26");

  // eyes
  for (const s of [-1, 1]) {
    const ex = 50 * u + s * fr * 0.38;
    const ey = fy + fr * 0.02;
    cv.ellipse(ex, ey, fr * 0.2, fr * 0.24, "#ffffff");
    cv.circle(ex + fr * 0.04, ey + fr * 0.04, fr * 0.1, "#20242e");
    cv.circle(ex + fr * 0.08, ey - fr * 0.02, fr * 0.035, "#ffffff");
  }

  // smile
  for (let i = -6; i <= 6; i++) {
    const t = i / 6;
    cv.circle(50 * u + t * fr * 0.42, fy + fr * 0.42 + (1 - t * t) * fr * 0.16, fr * 0.05, "#7d3b3b");
  }
  cv.circle(50 * u - fr * 0.62, fy + fr * 0.3, fr * 0.14, "#ff9f9f", 0.65);
  cv.circle(50 * u + fr * 0.62, fy + fr * 0.3, fr * 0.14, "#ff9f9f", 0.65);

  // clapperboard bar along the bottom
  const by = 82 * u;
  cv.roundRect(16 * u, by, 68 * u, 9 * u, 3 * u, "#20242e");
  for (let i = 0; i < 5; i++) {
    cv.polygon(
      [
        [(20 + i * 13) * u, by],
        [(26 + i * 13) * u, by],
        [(23 + i * 13) * u, by + 9 * u],
        [(17 + i * 13) * u, by + 9 * u],
      ],
      "#ffffff",
      0.9
    );
  }

  return cv.toPNG();
}

await mkdir(path.join(ROOT, "build"), { recursive: true });
await mkdir(path.join(ROOT, "public", "icons"), { recursive: true });

await writeFile(path.join(ROOT, "build", "icon.png"), drawIcon(1024));
await writeFile(path.join(ROOT, "public", "icons", "icon-192.png"), drawIcon(192));
await writeFile(path.join(ROOT, "public", "icons", "icon-512.png"), drawIcon(512));
await writeFile(path.join(ROOT, "public", "icons", "icon-maskable-512.png"), drawIcon(512));
console.log("icons written: build/icon.png, public/icons/{192,512,maskable-512}");
