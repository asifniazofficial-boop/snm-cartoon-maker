import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === "win32";

// Resolve external binaries. When packaged (Electron) they live in <resources>/bin;
// in dev we reuse the binaries the Video Downloader already ships in ../bin.
function resolveBin(name) {
  const exe = isWin ? `${name}.exe` : name;
  const platformDir = isWin ? "win" : "mac";
  const candidates = [
    process.env.RESOURCES_BIN && path.join(process.env.RESOURCES_BIN, exe),
    path.join(__dirname, "..", "bin", exe),
    path.join(__dirname, "..", "..", "bin", platformDir, exe),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return name; // rely on PATH
}

export const FFMPEG = resolveBin("ffmpeg");
export const FFPROBE = resolveBin("ffprobe");

// Run ffmpeg with the given args. ffmpeg writes progress to stderr, so we keep the
// tail of it for error reporting but discard the rest to avoid unbounded buffering.
export function ffmpeg(args, { timeoutMs = 10 * 60_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
      ...(cwd ? { cwd } : {}),
    });
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, timeoutMs);

    child.stderr.on("data", (d) => {
      err = (err + d).slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

// Duration of a media file in seconds.
export function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () => {
      const n = parseFloat(out.trim());
      if (Number.isFinite(n)) resolve(n);
      else reject(new Error("could not read duration"));
    });
  });
}
