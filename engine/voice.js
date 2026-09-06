import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, probeDuration } from "./ffmpeg.js";

// Narration. Order of preference: a configured HTTP voice provider, then the
// operating system's own speech engine, then a silent track of the right length
// so the render still cuts together.

export const VOICE_STYLES = {
  warm: { rate: 168, mac: "Samantha", pitch: 1.0 },
  energetic: { rate: 200, mac: "Samantha", pitch: 1.06 },
  dramatic: { rate: 148, mac: "Daniel", pitch: 0.95 },
  clear: { rate: 180, mac: "Alex", pitch: 1.0 },
  friendly: { rate: 175, mac: "Karen", pitch: 1.02 },
};

function run(cmd, args, { timeoutMs = 120_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `${cmd} exited with ${code}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

// Words-per-second estimate used to size silent fallback narration.
function estimateSeconds(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.6, words / 2.6);
}

async function silentTrack(outWav, seconds) {
  await ffmpeg([
    "-f", "lavfi",
    "-i", `anullsrc=channel_layout=mono:sample_rate=44100`,
    "-t", String(seconds.toFixed(2)),
    "-c:a", "pcm_s16le",
    outWav,
  ]);
}

// POST { text, voice, language } to TTS_URL and expect raw audio back.
async function httpVoice(text, style, language, outWav, workdir, index) {
  const url = process.env.TTS_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.TTS_KEY ? { Authorization: `Bearer ${process.env.TTS_KEY}` } : {}),
    },
    body: JSON.stringify({ text, voice: process.env.TTS_VOICE || style, language }),
  });
  if (!res.ok) throw new Error(`voice provider returned ${res.status}`);
  const raw = path.join(workdir, `voice-${index}.raw`);
  await writeFile(raw, Buffer.from(await res.arrayBuffer()));
  await ffmpeg(["-i", raw, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", outWav]);
}

async function macVoice(text, style, outWav, workdir, index) {
  const cfg = VOICE_STYLES[style] || VOICE_STYLES.warm;
  const txt = path.join(workdir, `line-${index}.txt`);
  const aiff = path.join(workdir, `line-${index}.aiff`);
  // Read the line from a file so no part of it can be taken as a command flag.
  await writeFile(txt, text, "utf8");
  const voice = process.env.TTS_VOICE || cfg.mac;
  await run("say", ["-v", voice, "-r", String(cfg.rate), "-f", txt, "-o", aiff]);
  await ffmpeg(["-i", aiff, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", outWav]);
}

async function winVoice(text, style, outWav, workdir, index) {
  const cfg = VOICE_STYLES[style] || VOICE_STYLES.warm;
  const wav = path.join(workdir, `line-${index}.sapi.wav`);
  const rate = Math.max(-10, Math.min(10, Math.round((cfg.rate - 175) / 12)));
  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    `$s.Rate = ${rate};`,
    `$s.SetOutputToWaveFile([Console]::In.ReadLine());`,
    "$t = [Console]::In.ReadToEnd();",
    "$s.Speak($t); $s.Dispose();",
  ].join(" ");
  await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: `${wav}\n${text}`,
  });
  await ffmpeg(["-i", wav, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", outWav]);
}

// Synthesize one narration line. Always resolves to a readable wav.
export async function speak(text, { style = "warm", language = "English", workdir, index = 0 }) {
  const outWav = path.join(workdir, `narration-${index}.wav`);
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    await silentTrack(outWav, 1.2);
    return { file: outWav, duration: 1.2, engine: "silence" };
  }

  const attempts = [];
  if (process.env.TTS_URL) attempts.push(["provider", () => httpVoice(clean, style, language, outWav, workdir, index)]);
  if (process.platform === "darwin") attempts.push(["say", () => macVoice(clean, style, outWav, workdir, index)]);
  if (process.platform === "win32") attempts.push(["sapi", () => winVoice(clean, style, outWav, workdir, index)]);

  for (const [engine, fn] of attempts) {
    try {
      await fn();
      const duration = await probeDuration(outWav);
      if (duration > 0.15) return { file: outWav, duration, engine };
    } catch {
      // fall through to the next engine
    }
  }

  const seconds = estimateSeconds(clean);
  await silentTrack(outWav, seconds);
  return { file: outWav, duration: seconds, engine: "silence" };
}
