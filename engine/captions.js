// Caption rendering: plain SRT lines, or ASS karaoke lines where each word highlights
// as it's spoken. Both read the same cue list — { start, duration, text } per scene —
// and both split long lines the same way, so switching style never changes line breaks.

const MAX_LINE_CHARS = 42;

// Break a cue's text into sub-chunks no sub-line exceeds MAX_LINE_CHARS, same rule the
// original SRT writer used, so a chunk here is a chunk there.
function chunkWords(text) {
  const words = text.split(" ");
  const chunks = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (cur.join(" ").length >= MAX_LINE_CHARS) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}

// One caption cue per narration line, split so a long line does not fill the frame.
export function buildSRT(cues) {
  const out = [];
  let n = 1;
  for (const { start, duration, text } of cues) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const chunks = chunkWords(clean);
    const per = duration / chunks.length;
    chunks.forEach((chunk, i) => {
      out.push(
        `${n++}\n${srtTime(start + i * per)} --> ${srtTime(start + (i + 1) * per)}\n${chunk.join(" ")}\n`
      );
    });
  }
  return out.join("\n");
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// ASS text can't carry a literal brace — it would be read as an override tag.
function escapeAss(text) {
  return text.replace(/[{}]/g, "");
}

const ASS_HEADER = (width, height) => `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,44,&H0000FFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

// Karaoke captions: each word fills from white to gold as its slice of the cue's
// duration elapses. Word slices are weighted by character count — the same estimate
// the silent-fallback narration timer uses — since none of the TTS backends hand back
// real per-word timestamps to time the fill against.
export function buildASS(cues, { width = 1280, height = 720 } = {}) {
  const lines = [ASS_HEADER(width, height)];
  for (const { start, duration, text } of cues) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const chunks = chunkWords(clean);
    const per = duration / chunks.length;
    chunks.forEach((words, i) => {
      const chunkStart = start + i * per;
      const weights = words.map((w) => w.length + 1);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const body = words
        .map((w, j) => {
          const cs = Math.max(1, Math.round((weights[j] / totalWeight) * per * 100));
          return `{\\kf${cs}}${escapeAss(w)} `;
        })
        .join("");
      lines.push(
        `Dialogue: 0,${assTime(chunkStart)},${assTime(chunkStart + per)},Default,,0,0,0,,${body.trim()}`
      );
    });
  }
  return lines.join("\n");
}
