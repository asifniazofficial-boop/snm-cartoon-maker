# SNM Cartoon Maker

Type what your video should be about. Get back a finished cartoon — screenplay, characters,
animated scenes, narration, an original score and captions — as a downloadable MP4.

Runs as a **web app** and a **Mac/Windows desktop app** from one codebase, and reuses the
`ffmpeg` binaries already bundled with the Video Downloader in `../bin`.

---

## How it works

One prompt goes in and a film comes out, through seven stages. Each stage freezes its output
before the next one starts — that ordering is what keeps a character looking the same in
every scene.

```
your prompt
   │
1  Script          Claude writes the screenplay and splits it into scenes
2  Character bible Claude turns each character into a fixed model sheet (colors,
                   build, hair, accessory). Frozen from here on.
3  Storyboard      Claude picks the camera, the set dressing and where everyone stands
4  Scene artwork   every frame is drawn from the sheets + the shot
5  Narration       each scene's lines are spoken
6  Score           an original piece is written to the exact length of the cut
7  Animation & mix camera moves, transitions, ducked music, burned captions
   │
finished MP4
```

**Why characters stay consistent.** Most AI video tools re-imagine a character every time
they draw it, so faces drift between shots. Here the character sheet from stage 2 is a set
of concrete drawing values, and stage 4 renders from those values directly. The same sheet
cannot produce two different-looking people — consistency is a property of the renderer, not
a sampling trick.

### Project layout

```
server.js              HTTP API, job queue, live progress over server-sent events
engine/wizard.js       the orchestrator — runs the seven stages in order
engine/claude.js       stages 1–3 (script, character bible, storyboard)
engine/scene.js        stage 4 — draws a frame from a scene description
engine/raster.js       the drawing primitives and PNG encoder (no native deps)
engine/images.js       picks between an external image service and the built-in renderer
engine/voice.js        stage 5 — narration
engine/music.js        stage 6 — the score, synthesized sample by sample
engine/render.js       stage 7 — ffmpeg: Ken Burns, transitions, ducking, captions
engine/styles.js       the visual style presets
public/index.html      the UI (installable PWA: manifest, service worker, icons)
electron/main.cjs      desktop shell
scripts/gen-icons.mjs  regenerates the app icons using the engine's own rasterizer
test/                  authored-path tests against a mock Messages API
```

## Run it

```bash
npm install
npm run web
```

Open http://localhost:3100.

Desktop app:

```bash
npm start
```

Installers: `npm run dist:mac` or `npm run dist:win` — output lands in `dist/`
(`SNM Cartoon Maker-1.0.0.dmg`, `SNM Cartoon Maker Setup 1.0.0.exe`). The Windows
installer cross-builds from macOS without wine. macOS builds are **unsigned**:
first launch is right-click the app → **Open**, then confirm — or
`xattr -dr com.apple.quarantine "/Applications/SNM Cartoon Maker.app"`.

Mobile: the web app is an installable PWA. Start `npm run web`, make it reachable on
your network, open the URL on your phone and use **Add to Home Screen**. (The engine
keeps running on your computer; the phone is a remote control for it.)

## Tests

```bash
npm test
```

Covers the authored path — the one that normally needs credentials — by pointing the SDK at a
local mock of the Messages API that speaks the real streaming wire format. That exercises the
actual SDK, actual streaming, and the JSON parsing against all three reply shapes a real model
produces (bare JSON, fenced, and prefixed with prose), then renders a complete film end to end.
The only thing it cannot check is whether the live model writes well.

## Configuration

Everything runs with no configuration at all. Each key below upgrades one stage.

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on **authored mode** — Claude writes the screenplay, designs the cast and boards the shots. Without it the app runs in draft mode: your text is split into scenes as written and everything else still works. |
| `CARTOON_MODEL` | Model for the writing stages. Defaults to `claude-opus-5`. |
| `IMAGE_URL`, `IMAGE_KEY` | Send frames to an external image generator instead of the built-in renderer. Receives `{prompt, width, height}` and should return image bytes. The character sheets are appended to every prompt so an external generator gets the same consistency anchors. Falls back to the built-in renderer if the service errors. |
| `TTS_URL`, `TTS_KEY`, `TTS_VOICE` | Use an external voice service. Receives `{text, voice, language}` and should return audio bytes. Otherwise macOS `say` / Windows SAPI is used, then silence as a last resort. |
| `PORT` | HTTP port. Defaults to 3100. |

## What you can change per film

Visual style (12 presets), length up to 5 minutes, narrator voice, language, tone, and
whether captions are burned in. Switching style regenerates every scene in the new look
while keeping the story and the cast identical.

## Notes

- Nothing is uploaded anywhere. Frames, audio and the finished film are written to a temp
  directory on the machine running the engine and deleted when the job is collected.
- The score is generated from scratch every time, so it is royalty-free by construction.
- Rendering is roughly real-time: a one-minute film takes about a minute on an M-series Mac.
