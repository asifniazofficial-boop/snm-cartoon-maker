import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import path from "node:path";

// The three writing stages of the wizard engine. Each one is a focused call:
// story -> cast sheets -> storyboard. Splitting them keeps the character sheet
// frozen before any shot is composed, which is what stops characters drifting.

const MODEL = process.env.CARTOON_MODEL || "claude-opus-5";

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

// Credentials can come from an env var or from an `ant auth login` profile on
// disk, which the SDK picks up on its own.
export function hasCredentials() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  const home = process.env.HOME || process.env.USERPROFILE;
  return Boolean(home && existsSync(path.join(home, ".config", "anthropic")));
}

// Claude answers in JSON. Strip any prose or code fence before parsing, and give
// the model one chance to repair its own output before giving up.
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("no JSON in response");
  const opener = body[start];
  const closer = opener === "{" ? "}" : "]";
  const end = body.lastIndexOf(closer);
  if (end <= start) throw new Error("truncated JSON in response");
  return JSON.parse(body.slice(start, end + 1));
}

async function ask(system, user, { maxTokens = 16000 } = {}) {
  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error("The model declined this request. Try rephrasing the story idea.");
  }
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function askJSON(system, user, opts) {
  const raw = await ask(system, user, opts);
  try {
    return extractJSON(raw);
  } catch {
    const repaired = await ask(
      system,
      `${user}\n\nYour previous reply was not valid JSON. Reply again with the JSON object only — no prose, no code fence.`,
      opts
    );
    return extractJSON(repaired);
  }
}

const SETTINGS = [
  "meadow", "forest", "city", "room", "classroom", "beach",
  "mountain", "desert", "space", "underwater",
];
const PROPS = [
  "sun", "clouds", "trees", "flowers", "rocks", "moon",
  "window", "door", "desk", "board", "rug",
];
const POSES = ["stand", "walk", "wave", "point", "sit", "jump", "cheer"];

// Stage 1 — screenplay and scene breakdown.
export async function developStory({ idea, script, minutes, language, tone }) {
  const sceneCount = Math.max(3, Math.min(24, Math.round(minutes * 5)));
  const wordsPerScene = Math.round((minutes * 150) / sceneCount);

  const system = [
    "You are the story department of a cartoon studio.",
    "You turn a brief into a scene-by-scene screenplay for a short animated film.",
    "Write narration that is spoken aloud: plain sentences, no stage directions inside the narration,",
    "no character-name prefixes, no markdown, no emoji.",
    "Reply with a single JSON object and nothing else.",
  ].join(" ");

  const user = [
    script
      ? `Use this script as the basis for the film. Keep its content and meaning:\n\n${script}`
      : `Film brief: ${idea}`,
    "",
    `Write ${sceneCount} scenes totalling about ${minutes} minute(s) of narration.`,
    `Each scene's narration should be roughly ${wordsPerScene} words.`,
    `Narration language: ${language}. Tone: ${tone}.`,
    "Use between 1 and 4 recurring characters across the whole film.",
    "",
    "Reply with JSON of this exact shape:",
    JSON.stringify(
      {
        title: "short film title",
        logline: "one sentence",
        characters: [{ id: "lowercase-slug", name: "Name", role: "their role in the story", look: "one sentence describing how they look" }],
        scenes: [
          {
            setting: `one of ${SETTINGS.join("|")}`,
            time: "day|sunset|night|indoor",
            action: "what happens on screen, one sentence",
            narration: "the words spoken aloud over this scene",
            characters: ["character ids present in this scene"],
            mood: "cheerful|calm|tense|sad|triumphant|mysterious",
          },
        ],
      },
      null,
      2
    ),
  ].join("\n");

  const out = await askJSON(system, user);
  if (!out?.scenes?.length) throw new Error("The story stage returned no scenes.");
  return out;
}

// Stage 2 — the character bible. These sheets are frozen and reused by every scene.
export async function castCharacters(story, styleName) {
  const system = [
    "You are the character designer of a cartoon studio.",
    "You turn character descriptions into a fixed model sheet of concrete drawing attributes.",
    "The sheet is used verbatim in every scene, so choose values that stay readable at small size",
    "and make each character clearly distinguishable from the others.",
    "Reply with a single JSON object and nothing else.",
  ].join(" ");

  const user = [
    `Visual style of the film: ${styleName}.`,
    `Film: ${story.title} — ${story.logline}`,
    "Characters:",
    ...story.characters.map((c) => `- ${c.id} (${c.name}): ${c.role}. ${c.look || ""}`),
    "",
    "Reply with JSON mapping each character id to its sheet:",
    JSON.stringify(
      {
        "character-id": {
          name: "Name",
          skin: "#hex",
          hair: "#hex",
          hairStyle: "short|long|bun|spiky|curly|bald",
          shirt: "#hex",
          pants: "#hex",
          shoes: "#hex",
          build: "child|adult|round|tall",
          accessory: "none|glasses|hat|bow",
          accessoryColor: "#hex",
        },
      },
      null,
      2
    ),
  ].join("\n");

  return askJSON(system, user, { maxTokens: 8000 });
}

// Stage 3 — shot composition for every scene.
export async function storyboard(story, sheets, styleName) {
  const system = [
    "You are the storyboard artist of a cartoon studio.",
    "For each scene you choose the camera, the set dressing, and where each character stands.",
    "x is the horizontal position from 0 (far left) to 1 (far right); scale is 0.3 (distant) to 1 (close).",
    "Keep characters from overlapping: give them x values at least 0.18 apart.",
    "Reply with a single JSON object and nothing else.",
  ].join(" ");

  const user = [
    `Visual style: ${styleName}.`,
    `Film: ${story.title}`,
    `Cast: ${Object.keys(sheets).join(", ")}`,
    "",
    "Scenes:",
    ...story.scenes.map(
      (s, i) =>
        `${i}. [${s.setting}/${s.time}] ${s.action} (present: ${(s.characters || []).join(", ") || "none"})`
    ),
    "",
    `Allowed props: ${PROPS.join(", ")}. Allowed poses: ${POSES.join(", ")}.`,
    "Reply with JSON:",
    JSON.stringify(
      {
        shots: [
          {
            index: 0,
            camera: "wide|medium|close",
            props: ["prop names"],
            characters: [
              { id: "character-id", x: 0.4, scale: 0.6, facing: "left|right", pose: "stand", expression: "happy|sad|surprised|neutral" },
            ],
            imagePrompt: "one sentence describing the frame, for an image generator",
          },
        ],
      },
      null,
      2
    ),
  ].join("\n");

  const out = await askJSON(system, user);
  return out?.shots || [];
}

// --- offline fallbacks -----------------------------------------------------
// Without credentials the app still runs end to end so the render pipeline can
// be exercised; the writing is mechanical rather than authored.

const FALLBACK_SETTINGS = ["meadow", "forest", "city", "beach", "mountain", "room"];

export function offlineStory({ idea, script, minutes }) {
  const text = (script || idea || "A short animated story.").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 1);
  const target = Math.max(3, Math.min(12, Math.round(minutes * 5)));
  const scenes = [];
  const perScene = Math.max(1, Math.ceil(sentences.length / target));
  for (let i = 0; i < sentences.length; i += perScene) {
    const narration = sentences.slice(i, i + perScene).join(" ");
    scenes.push({
      setting: FALLBACK_SETTINGS[scenes.length % FALLBACK_SETTINGS.length],
      time: "day",
      action: narration.slice(0, 90),
      narration,
      characters: ["narrator-hero"],
      mood: "cheerful",
    });
  }
  if (!scenes.length) {
    scenes.push({ setting: "meadow", time: "day", action: text, narration: text, characters: ["narrator-hero"], mood: "cheerful" });
  }
  return {
    title: text.split(/[.!?]/)[0].slice(0, 60) || "Untitled",
    logline: text.slice(0, 140),
    characters: [{ id: "narrator-hero", name: "Hero", role: "the storyteller", look: "a friendly guide" }],
    scenes,
  };
}

export function offlineSheets(story) {
  const palette = [
    { skin: "#f0c49b", hair: "#3b2a1f", shirt: "#4f8fe0", pants: "#33405c", shoes: "#2a2a30", build: "adult", hairStyle: "short" },
    { skin: "#8d5a3b", hair: "#1f1712", shirt: "#e06a4f", pants: "#3a3f4a", shoes: "#22252b", build: "child", hairStyle: "curly" },
    { skin: "#fbd7b5", hair: "#c8863c", shirt: "#68b06a", pants: "#4a4f5e", shoes: "#2e3138", build: "tall", hairStyle: "long" },
    { skin: "#e8b892", hair: "#6b3f2a", shirt: "#c77ad0", pants: "#39405a", shoes: "#26292f", build: "round", hairStyle: "bun" },
  ];
  const sheets = {};
  story.characters.forEach((c, i) => {
    sheets[c.id] = { name: c.name, accessory: "none", accessoryColor: "#c0392b", ...palette[i % palette.length] };
  });
  return sheets;
}

export function offlineShots(story) {
  return story.scenes.map((s, index) => ({
    index,
    camera: index % 3 === 0 ? "wide" : "medium",
    props: ["sun", "clouds", "trees"],
    characters: (s.characters || []).map((id, i, arr) => ({
      id,
      x: arr.length === 1 ? 0.5 : 0.3 + (i * 0.4) / Math.max(1, arr.length - 1),
      scale: 0.6,
      facing: i % 2 ? "left" : "right",
      pose: index % 2 ? "stand" : "wave",
      expression: "happy",
    })),
    imagePrompt: s.action,
  }));
}
