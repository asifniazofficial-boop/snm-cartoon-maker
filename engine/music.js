import { writeFile } from "node:fs/promises";
import { rng } from "./raster.js";

// Original background score, synthesized sample by sample. Nothing is sampled or
// copied from a library, so every track is royalty-free by construction.

const SR = 44100;

// Scale degrees as semitone offsets, and a chord progression per mood.
const MOODS = {
  cheerful: { root: 60, bpm: 112, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], bright: 1 },
  calm: { root: 57, bpm: 74, chords: [[0, 4, 7, 11], [9, 12, 16], [5, 9, 12], [7, 11, 14]], bright: 0.6 },
  triumphant: { root: 62, bpm: 100, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], bright: 1.15 },
  tense: { root: 57, bpm: 104, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], bright: 0.8 },
  sad: { root: 55, bpm: 68, chords: [[0, 3, 7], [10, 14, 17], [8, 12, 15], [10, 14, 17]], bright: 0.45 },
  mysterious: { root: 56, bpm: 84, chords: [[0, 3, 7], [2, 5, 8], [8, 12, 15], [7, 10, 14]], bright: 0.5 },
};

function moodConfig(mood) {
  return MOODS[mood] || MOODS.cheerful;
}

const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Soft sawtooth-ish tone: a few harmonics rolled off, warmer than a raw saw.
function tone(phase, bright) {
  return (
    Math.sin(phase) +
    0.42 * bright * Math.sin(phase * 2) +
    0.2 * bright * Math.sin(phase * 3) +
    0.08 * bright * Math.sin(phase * 4)
  );
}

function envelope(t, dur, attack, release) {
  if (t < 0 || t > dur) return 0;
  if (t < attack) return t / attack;
  if (t > dur - release) return Math.max(0, (dur - t) / release);
  return 1;
}

export async function composeMusic({ mood = "cheerful", seconds = 30, out, seed = 5 }) {
  const cfg = moodConfig(mood);
  const rand = rng(seed);
  const total = Math.max(2, Math.ceil(seconds));
  const n = total * SR;
  const buf = new Float32Array(n);

  const beat = 60 / cfg.bpm;
  const barLen = beat * 4;
  const chordLen = barLen; // one chord per bar

  const addNote = (startSec, durSec, midi, gain, attack, release, bright) => {
    const start = Math.floor(startSec * SR);
    const end = Math.min(n, Math.floor((startSec + durSec) * SR));
    const w = (2 * Math.PI * freq(midi)) / SR;
    for (let i = start; i < end; i++) {
      if (i < 0) continue;
      const t = (i - start) / SR;
      const env = envelope(t, durSec, attack, release);
      if (env <= 0) continue;
      buf[i] += tone(w * (i - start), bright) * env * gain;
    }
  };

  let time = 0;
  let bar = 0;
  while (time < total + chordLen) {
    const chord = cfg.chords[bar % cfg.chords.length];
    const root = cfg.root + chord[0];

    // sustained pad
    for (const iv of chord) {
      addNote(time, chordLen * 0.98, cfg.root + iv, 0.055, chordLen * 0.28, chordLen * 0.35, cfg.bright * 0.5);
    }
    // bass on the downbeat and the third beat
    addNote(time, beat * 1.6, root - 12, 0.13, 0.01, beat * 0.5, 0.35);
    addNote(time + beat * 2, beat * 1.4, root - 12, 0.1, 0.01, beat * 0.5, 0.35);

    // arpeggio across the bar
    const steps = 8;
    for (let s = 0; s < steps; s++) {
      if (rand() < 0.12) continue; // leave a little space so it breathes
      const iv = chord[s % chord.length] + (s >= chord.length * 2 ? 12 : 0);
      addNote(time + (s * barLen) / steps, beat * 0.62, cfg.root + iv + 12, 0.045, 0.004, beat * 0.5, cfg.bright);
    }

    time += chordLen;
    bar++;
  }

  // One-pole lowpass to take the edge off, then normalize and fade.
  let prev = 0;
  const a = 0.22;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    prev += a * (buf[i] - prev);
    buf[i] = prev;
    const abs = Math.abs(prev);
    if (abs > peak) peak = abs;
  }

  const target = 0.5 / (peak || 1);
  const fade = Math.min(2.5 * SR, n / 4);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let v = buf[i] * target;
    if (i < fade) v *= i / fade;
    if (i > n - fade) v *= (n - i) / fade;
    const s = Math.max(-1, Math.min(1, v));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  await writeFile(out, Buffer.concat([header, pcm]));
  return { file: out, duration: total, mood };
}

// Pick a score mood from the moods the story stage assigned to its scenes.
export function dominantMood(scenes) {
  const counts = {};
  for (const s of scenes) {
    const m = MOODS[s.mood] ? s.mood : "cheerful";
    counts[m] = (counts[m] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "cheerful";
}
