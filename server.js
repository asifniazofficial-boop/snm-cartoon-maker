import express from "express";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWizard } from "./engine/wizard.js";
import { styleList } from "./engine/styles.js";
import { VOICE_STYLES } from "./engine/voice.js";
import { hasCredentials } from "./engine/claude.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Jobs live in memory for the life of the process; their working directories are
// removed when the job is collected so temp space never leaks.
const jobs = new Map();
const JOB_TTL_MS = 45 * 60_000;

function collect(id) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  if (job.workdir) rm(job.workdir, { recursive: true, force: true }).catch(() => {});
}

function push(job, event) {
  job.events.push(event);
  for (const res of job.listeners) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

app.get("/api/config", (req, res) => {
  res.json({
    styles: styleList(),
    voices: Object.keys(VOICE_STYLES),
    authored: hasCredentials(),
    imageProvider: Boolean(process.env.IMAGE_URL),
    voiceProvider: Boolean(process.env.TTS_URL),
    maxMinutes: 5,
  });
});

app.post("/api/create", async (req, res) => {
  const idea = String(req.body?.idea || "").trim();
  const script = String(req.body?.script || "").trim();
  if (!idea && !script) {
    return res.status(400).json({ error: "Describe your video, or paste a script." });
  }

  const id = randomUUID();
  const workdir = await mkdtemp(path.join(tmpdir(), "snm-cartoon-"));
  const job = {
    id,
    workdir,
    events: [],
    listeners: new Set(),
    done: false,
    error: null,
    result: null,
    timer: setTimeout(() => collect(id), JOB_TTL_MS),
  };
  jobs.set(id, job);
  res.json({ id });

  const options = {
    idea,
    script,
    minutes: Number(req.body?.minutes) || 1,
    style: String(req.body?.style || ""),
    language: String(req.body?.language || "English"),
    tone: String(req.body?.tone || "friendly and clear"),
    voice: String(req.body?.voice || "warm"),
    captions: req.body?.captions !== false,
    workdir,
  };

  runWizard(options, (event) => push(job, event))
    .then((result) => {
      job.result = result;
      job.done = true;
      push(job, { type: "done", ...result, file: undefined });
    })
    .catch((e) => {
      job.error = e.message || "Generation failed.";
      job.done = true;
      push(job, { type: "error", error: job.error });
    });
});

// Server-sent events: replay what already happened, then stream the rest.
app.get("/api/events/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const event of job.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (job.done) return res.end();

  job.listeners.add(res);
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    job.listeners.delete(res);
  });
});

// A storyboard frame, so the UI can show the film taking shape while it renders.
app.get("/api/frame/:id/:n", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  const n = Number(req.params.n);
  const file = path.join(job.workdir, `frame-${Number.isFinite(n) ? n : 0}.png`);
  if (!existsSync(file)) return res.status(404).end();
  res.setHeader("Content-Type", "image/png");
  createReadStream(file).pipe(res);
});

app.get("/api/video/:id", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.result?.file) return res.status(404).send("Not ready.");

  const file = job.result.file;
  const info = await stat(file).catch(() => null);
  if (!info) return res.status(404).send("Not ready.");

  const name = `${job.result.title || "cartoon"}.mp4`.replace(/[/\\?%*:|"<>]/g, "-");
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", info.size);
  if (req.query.download) {
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  createReadStream(file).pipe(res);
});

export function start(port = process.env.PORT || 3100) {
  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      console.log(`\n  🎬  SNM Cartoon Maker running at  http://localhost:${actual}\n`);
      resolve({ server, port: actual });
    });
  });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) start();
