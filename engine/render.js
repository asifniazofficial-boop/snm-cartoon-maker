import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg } from "./ffmpeg.js";

// Turns still storyboard frames plus audio into a finished film: camera motion on
// every frame, a transition between every scene, narration mixed over a score that
// ducks underneath it, and optional burned-in captions.

const FPS = 25;
const OUT_W = 1280;
const OUT_H = 720;
export const TRANSITION = 0.6;

const TRANSITIONS = ["fade", "wipeleft", "slideup", "circleopen", "dissolve", "smoothright"];

// Four camera moves, cycled so consecutive scenes never move the same way.
function kenBurns(variant, frames) {
  const total = Math.max(2, frames);
  const zIn = `min(1.0+0.00075*on,1.16)`;
  const zOut = `max(1.16-0.00075*on,1.0)`;
  switch (variant % 4) {
    case 0:
      return { z: zIn, x: `iw/2-(iw/zoom/2)`, y: `ih/2-(ih/zoom/2)` };
    case 1:
      return { z: zOut, x: `iw/2-(iw/zoom/2)`, y: `ih/2-(ih/zoom/2)` };
    case 2:
      return { z: `1.12`, x: `(iw-iw/zoom)*(on/${total})`, y: `(ih-ih/zoom)/2` };
    default:
      return { z: `1.12`, x: `(iw-iw/zoom)*(1-on/${total})`, y: `(ih-ih/zoom)/2` };
  }
}

async function buildClip(png, seconds, variant, out) {
  const frames = Math.max(2, Math.round(seconds * FPS));
  const { z, x, y } = kenBurns(variant, frames);
  const vf = [
    `zoompan=z='${z}':d=1:x='${x}':y='${y}':s=${OUT_W}x${OUT_H}:fps=${FPS}`,
    "format=yuv420p",
  ].join(",");
  await ffmpeg([
    "-loop", "1",
    "-framerate", String(FPS),
    "-t", seconds.toFixed(3),
    "-i", png,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    out,
  ]);
}

// Chain the clips together with a different transition at each cut.
async function joinClips(clips, durations, out) {
  if (clips.length === 1) {
    await ffmpeg(["-i", clips[0], "-c", "copy", out]);
    return durations[0];
  }
  const inputs = clips.flatMap((c) => ["-i", c]);
  const parts = [];
  let label = "0:v";
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += durations[i - 1] - TRANSITION;
    const next = i === clips.length - 1 ? "vout" : `v${i}`;
    parts.push(
      `[${label}][${i}:v]xfade=transition=${TRANSITIONS[(i - 1) % TRANSITIONS.length]}:duration=${TRANSITION}:offset=${offset.toFixed(3)}[${next}]`
    );
    label = next;
  }
  await ffmpeg([
    ...inputs,
    "-filter_complex", parts.join(";"),
    "-map", "[vout]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    out,
  ]);
  return durations.reduce((a, b) => a + b, 0) - TRANSITION * (clips.length - 1);
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}

// One caption cue per narration line, split so a long line does not fill the frame.
function buildSRT(cues) {
  const out = [];
  let n = 1;
  for (const { start, duration, text } of cues) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const words = clean.split(" ");
    const chunks = [];
    let cur = [];
    for (const w of words) {
      cur.push(w);
      if (cur.join(" ").length >= 42) {
        chunks.push(cur.join(" "));
        cur = [];
      }
    }
    if (cur.length) chunks.push(cur.join(" "));
    const per = duration / chunks.length;
    chunks.forEach((chunk, i) => {
      out.push(
        `${n++}\n${srtTime(start + i * per)} --> ${srtTime(start + (i + 1) * per)}\n${chunk}\n`
      );
    });
  }
  return out.join("\n");
}

export async function renderFilm({
  workdir,
  frames,
  narrations,
  musicFile,
  captions = true,
  out,
  onProgress = () => {},
}) {
  const clips = [];
  const durations = [];

  for (let i = 0; i < frames.length; i++) {
    const clip = path.join(workdir, `clip-${i}.mp4`);
    await buildClip(frames[i].png, frames[i].duration, i, clip);
    clips.push(clip);
    durations.push(frames[i].duration);
    onProgress(i + 1, frames.length);
  }

  const silent = path.join(workdir, "silent.mp4");
  const total = await joinClips(clips, durations, silent);

  // Scene start times on the final timeline, after transition overlaps.
  const starts = [];
  let t = 0;
  for (let i = 0; i < durations.length; i++) {
    starts.push(t);
    t += durations[i] - TRANSITION;
  }

  const cues = narrations.map((nar, i) => ({
    start: starts[i] + 0.15,
    duration: Math.max(0.8, nar.duration),
    text: frames[i]?.caption || "",
  }));
  if (captions) {
    await writeFile(path.join(workdir, "captions.srt"), buildSRT(cues), "utf8");
  }

  // narration inputs, then the score
  const inputs = ["-i", silent];
  narrations.forEach((n) => inputs.push("-i", n.file));
  inputs.push("-i", musicFile);
  const musicIdx = narrations.length + 1;

  const filters = [];
  const narLabels = [];
  narrations.forEach((n, i) => {
    const delay = Math.max(0, Math.round((starts[i] + 0.15) * 1000));
    filters.push(`[${i + 1}:a]adelay=${delay}:all=1,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono[n${i}]`);
    narLabels.push(`[n${i}]`);
  });
  filters.push(
    `${narLabels.join("")}amix=inputs=${narrations.length}:normalize=0:dropout_transition=0[narmix]`
  );
  filters.push(`[narmix]apad,atrim=0:${total.toFixed(3)},asplit=2[nar][key]`);
  filters.push(
    `[${musicIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono,volume=0.34,apad,atrim=0:${total.toFixed(3)}[bed]`
  );
  // The score is compressed by the narration, so music drops under every line.
  filters.push(
    `[bed][key]sidechaincompress=threshold=0.02:ratio=12:attack=25:release=450:makeup=1[duck]`
  );
  filters.push(`[nar][duck]amix=inputs=2:normalize=0[aout]`);

  const videoFilter = captions
    ? [
        "-filter:v",
        "subtitles=captions.srt:force_style='FontName=Arial,Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,MarginV=42'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      ]
    : ["-c:v", "copy"];

  await ffmpeg(
    [
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "0:v",
      "-map", "[aout]",
      ...videoFilter,
      "-c:a", "aac",
      "-b:a", "192k",
      "-ac", "2",
      "-t", total.toFixed(3),
      "-movflags", "+faststart",
      out,
    ],
    { cwd: workdir }
  );

  return { file: out, duration: total };
}
