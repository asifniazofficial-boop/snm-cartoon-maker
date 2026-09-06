import http from "node:http";

// A stand-in for POST /v1/messages that speaks the real streaming wire format.
// Pointing ANTHROPIC_BASE_URL at it exercises the actual SDK, actual streaming
// and our actual parsing — everything except whether the live model writes well.

const STORY = {
  title: "The Lamp and the Whale",
  logline: "A lighthouse keeper and a lost whale learn to guide each other home.",
  characters: [
    { id: "mira", name: "Mira", role: "the lighthouse keeper", look: "weathered coat, grey braid" },
    { id: "tomas", name: "Tomas", role: "the village boy who helps her", look: "small, red scarf" },
  ],
  scenes: [
    { setting: "beach", time: "sunset", action: "Mira climbs to the lamp room", narration: "Every evening Mira climbed the long stair to light the lamp.", characters: ["mira"], mood: "calm" },
    { setting: "beach", time: "night", action: "The whale surfaces", narration: "Far out past the rocks, something enormous answered the light.", characters: ["mira"], mood: "mysterious" },
    { setting: "city", time: "night", action: "Tomas runs for help", narration: "When the lamp went dark, Tomas ran the whole way to the village.", characters: ["tomas"], mood: "tense" },
    { setting: "beach", time: "sunset", action: "They relight the lamp together", narration: "By morning the light was burning again, and the sea was singing.", characters: ["mira", "tomas"], mood: "triumphant" },
  ],
};

const SHEETS = {
  mira: { name: "Mira", skin: "#e8b892", hair: "#b9b3ab", hairStyle: "bun", shirt: "#3f6f8f", pants: "#2f3a48", shoes: "#22252b", build: "tall", accessory: "none", accessoryColor: "#c0392b" },
  tomas: { name: "Tomas", skin: "#c98b5e", hair: "#2a1d16", hairStyle: "spiky", shirt: "#c0392b", pants: "#39405a", shoes: "#26292f", build: "child", accessory: "hat", accessoryColor: "#c0392b" },
};

const SHOTS = {
  shots: [
    { index: 0, camera: "wide", props: ["sun", "clouds"], characters: [{ id: "mira", x: 0.42, scale: 0.6, facing: "right", pose: "walk", expression: "neutral" }], imagePrompt: "keeper climbing at sunset" },
    { index: 1, camera: "medium", props: ["moon"], characters: [{ id: "mira", x: 0.3, scale: 0.7, facing: "right", pose: "point", expression: "surprised" }], imagePrompt: "keeper points at the sea" },
    { index: 2, camera: "medium", props: [], characters: [{ id: "tomas", x: 0.55, scale: 0.75, facing: "left", pose: "walk", expression: "sad" }], imagePrompt: "boy running through the town" },
    { index: 3, camera: "close", props: ["sun", "clouds"], characters: [{ id: "mira", x: 0.35, scale: 0.6, facing: "right", pose: "cheer", expression: "happy" }, { id: "tomas", x: 0.65, scale: 0.55, facing: "left", pose: "wave", expression: "happy" }], imagePrompt: "both at the lamp at dawn" },
  ],
};

// Each stage gets a differently-shaped reply, because a real model does not
// reliably return bare JSON — the parser has to survive all three.
function bodyFor(system) {
  if (system.includes("story department")) return JSON.stringify(STORY, null, 2);
  if (system.includes("character designer")) {
    return "Here are the model sheets:\n\n```json\n" + JSON.stringify(SHEETS, null, 2) + "\n```";
  }
  if (system.includes("storyboard artist")) {
    return "Sure — here is the board.\n" + JSON.stringify(SHOTS, null, 2);
  }
  return "{}";
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const parsed = JSON.parse(raw || "{}");
        const system = typeof parsed.system === "string" ? parsed.system : JSON.stringify(parsed.system || "");
        const text = bodyFor(system);
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        sse(res, "message_start", {
          type: "message_start",
          message: { id: "msg_mock", type: "message", role: "assistant", model: parsed.model || "claude-opus-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } },
        });
        sse(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        for (let i = 0; i < text.length; i += 180) {
          sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 180) } });
        }
        sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
        sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 500 } });
        sse(res, "message_stop", { type: "message_stop" });
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}
