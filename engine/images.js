import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderScene } from "./scene.js";
import { ffmpeg } from "./ffmpeg.js";

// Frames are rendered larger than the output so the camera has room to push in.
const FRAME_W = 1600;
const FRAME_H = 900;

// Ask a configured image service for the frame. The service receives the shot's
// prompt with the style fragment and the frozen character sheets appended, so an
// external generator gets the same consistency anchors the built-in renderer uses.
async function providerFrame({ prompt, style, sheets, cast, out, workdir, index }) {
  const described = cast
    .map((c) => {
      const s = sheets[c.id];
      if (!s) return null;
      return `${s.name}: ${s.build} build, ${s.hairStyle} ${s.hair} hair, ${s.shirt} top, ${s.pants} trousers, ${s.skin} skin${s.accessory && s.accessory !== "none" ? `, wearing ${s.accessory}` : ""}`;
    })
    .filter(Boolean);

  const full = [prompt, `Style: ${style.prompt}.`, described.length ? `Characters — ${described.join("; ")}.` : ""]
    .filter(Boolean)
    .join(" ");

  const res = await fetch(process.env.IMAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.IMAGE_KEY ? { Authorization: `Bearer ${process.env.IMAGE_KEY}` } : {}),
    },
    body: JSON.stringify({ prompt: full, width: FRAME_W, height: FRAME_H }),
  });
  if (!res.ok) throw new Error(`image provider returned ${res.status}`);

  const raw = path.join(workdir, `provider-${index}.img`);
  await writeFile(raw, Buffer.from(await res.arrayBuffer()));
  // Normalize whatever came back to an exact-size PNG.
  await ffmpeg([
    "-i", raw,
    "-vf", `scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=increase,crop=${FRAME_W}:${FRAME_H}`,
    "-frames:v", "1",
    out,
  ]);
}

export async function makeFrame({ scene, shot, sheets, style, index, workdir }) {
  const out = path.join(workdir, `frame-${index}.png`);
  const composed = {
    setting: scene.setting,
    time: scene.time,
    props: shot?.props || [],
    camera: shot?.camera || "medium",
    characters: shot?.characters || [],
    palette: scene.palette,
  };

  if (process.env.IMAGE_URL) {
    try {
      await providerFrame({
        prompt: shot?.imagePrompt || scene.action || "",
        style,
        sheets,
        cast: composed.characters,
        out,
        workdir,
        index,
      });
      return { png: out, source: "provider" };
    } catch {
      // fall through to the built-in renderer rather than failing the whole film
    }
  }

  const png = renderScene(composed, sheets, style, {
    width: FRAME_W,
    height: FRAME_H,
    seed: index * 2654435761 + 17,
  });
  await writeFile(out, png);
  return { png: out, source: "builtin" };
}
