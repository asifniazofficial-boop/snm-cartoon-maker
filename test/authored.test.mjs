import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMock } from "./mock-anthropic.mjs";

// Covers the authored path — the one that needs credentials in real use — by
// pointing the SDK at a local mock of the Messages API. Run with `npm test`.

const { server, port } = await startMock();
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;

const { hasCredentials, developStory, castCharacters, storyboard } = await import("../engine/claude.js");
const { runWizard } = await import("../engine/wizard.js");

let failures = 0;
function ok(condition, label, extra = "") {
  console.log(`${condition ? "  ok  " : "FAIL  "}${label}${extra ? ` — ${extra}` : ""}`);
  if (!condition) failures++;
}

console.log("\nwriting stages");
ok(hasCredentials(), "credentials are detected");

const story = await developStory({ idea: "a lighthouse and a whale", script: "", minutes: 1, language: "English", tone: "warm" });
ok(story.title === "The Lamp and the Whale", "stage 1 parses a bare JSON reply", story.title);
ok(story.scenes.length === 4, "stage 1 returns every scene", String(story.scenes.length));
ok(story.characters.length === 2, "stage 1 returns the cast");
ok(story.scenes.every((s) => typeof s.narration === "string" && s.narration.length > 10), "every scene has narration");

const sheets = await castCharacters(story, "Storybook");
ok(Object.keys(sheets).length === 2, "stage 2 parses a ```json fenced reply");
ok(sheets.mira?.hairStyle === "bun" && sheets.tomas?.build === "child", "stage 2 sheet fields survive the round trip");
ok(Object.values(sheets).every((s) => /^#[0-9a-f]{6}$/i.test(s.shirt)), "stage 2 colors are usable hex");

const shots = await storyboard(story, sheets, "Storybook");
ok(shots.length === 4, "stage 3 parses a reply with a prose preamble");
ok(shots[3].characters.length === 2, "stage 3 composes a multi-character shot");
ok(shots.every((s) => s.characters.every((c) => sheets[c.id])), "stage 3 only places characters that exist");
const byIndex = new Map(shots.map((s) => [Number(s.index), s]));
ok(story.scenes.every((_, i) => byIndex.has(i)), "shot indices line up with scenes");

console.log("\nfull film, authored end to end");
const workdir = await mkdtemp(path.join(tmpdir(), "snm-test-"));
const notices = [];
try {
  const film = await runWizard(
    { idea: "a lighthouse keeper and a lost whale", minutes: 1, style: "storybook", language: "English", voice: "dramatic", captions: true, workdir },
    (e) => e.type === "notice" && notices.push(e.message)
  );
  ok(film.authored === true, "ran authored, with no silent fallback");
  ok(notices.length === 0, "no fallback notices", notices.join("; "));
  ok(film.title === "The Lamp and the Whale", "the authored title reaches the result");
  ok(film.sceneCount === 4 && film.characters === 2, "scene and character counts carry through");
  ok(film.duration > 8, "the film has a real duration", `${film.duration.toFixed(1)}s`);
} finally {
  await rm(workdir, { recursive: true, force: true });
  server.close();
}

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
