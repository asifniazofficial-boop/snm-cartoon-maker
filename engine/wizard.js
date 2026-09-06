import path from "node:path";
import { getStyle } from "./styles.js";
import { makeFrame } from "./images.js";
import { speak } from "./voice.js";
import { composeMusic, dominantMood } from "./music.js";
import { renderFilm, TRANSITION } from "./render.js";
import {
  hasCredentials,
  developStory,
  castCharacters,
  storyboard,
  offlineStory,
  offlineSheets,
  offlineShots,
} from "./claude.js";

// The Wizard Engine: one prompt in, one finished film out. Each stage hands its
// frozen output to the next — story, then cast sheets, then shots, then pixels,
// then sound — which is what keeps a character identical from scene to scene.

const STAGES = [
  { id: "script", label: "Writing the script", to: 12 },
  { id: "cast", label: "Designing the characters", to: 20 },
  { id: "storyboard", label: "Composing the storyboard", to: 30 },
  { id: "frames", label: "Drawing the scenes", to: 56 },
  { id: "voice", label: "Recording narration", to: 74 },
  { id: "music", label: "Composing the score", to: 80 },
  { id: "render", label: "Animating and mixing", to: 99 },
];

function stageStart(id) {
  const i = STAGES.findIndex((s) => s.id === id);
  return i <= 0 ? 0 : STAGES[i - 1].to;
}

export async function runWizard(options, emit = () => {}) {
  const {
    idea = "",
    script = "",
    minutes = 1,
    style: styleId,
    language = "English",
    tone = "friendly and clear",
    voice = "warm",
    captions = true,
    workdir,
  } = options;

  const style = getStyle(styleId);
  const lengthMinutes = Math.max(0.3, Math.min(5, Number(minutes) || 1));
  const online = hasCredentials();

  const progress = (stage, detail, frac = 0) => {
    const s = STAGES.find((x) => x.id === stage);
    const from = stageStart(stage);
    const percent = Math.round(from + (s.to - from) * Math.max(0, Math.min(1, frac)));
    emit({ type: "progress", stage, label: s.label, detail, percent });
  };

  // 1 — screenplay and scene breakdown
  progress("script", online ? "Developing the story" : "Splitting your text into scenes");
  let story;
  let authored = online;
  if (online) {
    try {
      story = await developStory({ idea, script, minutes: lengthMinutes, language, tone });
    } catch (e) {
      // A writing failure drops the film to draft mode rather than losing it.
      authored = false;
      emit({ type: "notice", message: `Script stage fell back to draft mode: ${e.message}` });
    }
  }
  if (!story) {
    if (!idea && !script) throw new Error("Nothing to make a film from.");
    story = offlineStory({ idea, script, minutes: lengthMinutes });
  }
  progress("script", `${story.scenes.length} scenes`, 1);
  emit({ type: "story", title: story.title, logline: story.logline, scenes: story.scenes.length });

  // 2 — the character bible, frozen from here on
  progress("cast", "Locking character sheets");
  let sheets;
  try {
    sheets = authored ? await castCharacters(story, style.name) : offlineSheets(story);
  } catch {
    sheets = offlineSheets(story);
  }
  // Any character the writer invented but the designer missed still needs a sheet.
  const fallbackSheets = offlineSheets(story);
  for (const c of story.characters || []) {
    if (!sheets[c.id]) sheets[c.id] = fallbackSheets[c.id];
  }
  progress("cast", `${Object.keys(sheets).length} characters`, 1);
  emit({ type: "cast", characters: Object.entries(sheets).map(([id, s]) => ({ id, ...s })) });

  // 3 — shot composition
  progress("storyboard", "Placing the camera");
  let shots;
  try {
    shots = authored ? await storyboard(story, sheets, style.name) : offlineShots(story);
  } catch {
    shots = offlineShots(story);
  }
  const byIndex = new Map(shots.map((s) => [Number(s.index), s]));
  const offline = offlineShots(story);
  const composedShots = story.scenes.map((_, i) => byIndex.get(i) || offline[i]);
  progress("storyboard", `${composedShots.length} shots`, 1);

  // 4 — draw every frame
  const frames = [];
  for (let i = 0; i < story.scenes.length; i++) {
    progress("frames", `Scene ${i + 1} of ${story.scenes.length}`, i / story.scenes.length);
    const { png, source } = await makeFrame({
      scene: story.scenes[i],
      shot: composedShots[i],
      sheets,
      style,
      index: i,
      workdir,
    });
    frames.push({ png, source, caption: story.scenes[i].narration });
  }
  progress("frames", "Frames ready", 1);

  // 5 — narration
  const narrations = [];
  for (let i = 0; i < story.scenes.length; i++) {
    progress("voice", `Line ${i + 1} of ${story.scenes.length}`, i / story.scenes.length);
    narrations.push(
      await speak(story.scenes[i].narration, { style: voice, language, workdir, index: i })
    );
  }
  progress("voice", "Narration recorded", 1);

  // Scene length follows its narration, plus room for the transition overlap.
  frames.forEach((f, i) => {
    f.duration = Math.max(2.6, narrations[i].duration + 0.9) + TRANSITION;
  });

  // 6 — score, written to the exact length of the cut
  progress("music", "Writing an original score");
  const totalSeconds =
    frames.reduce((a, f) => a + f.duration, 0) - TRANSITION * (frames.length - 1);
  const musicFile = path.join(workdir, "score.wav");
  await composeMusic({
    mood: dominantMood(story.scenes),
    seconds: totalSeconds + 2,
    out: musicFile,
  });
  progress("music", "Score ready", 1);

  // 7 — animate, mix and mux
  const out = path.join(workdir, "film.mp4");
  const result = await renderFilm({
    workdir,
    frames,
    narrations,
    musicFile,
    captions,
    out,
    onProgress: (done, total) => progress("render", `Rendering scene ${done} of ${total}`, done / (total + 2)),
  });

  emit({ type: "progress", stage: "render", label: "Finished", detail: "", percent: 100 });

  return {
    file: result.file,
    duration: result.duration,
    title: story.title,
    logline: story.logline,
    style: style.name,
    sceneCount: story.scenes.length,
    characters: Object.keys(sheets).length,
    frameSource: frames[0]?.source || "builtin",
    authored,
  };
}
