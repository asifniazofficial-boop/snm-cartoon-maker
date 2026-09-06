import { Canvas, parseColor, mix, shade, rng } from "./raster.js";

// Draws a storyboard frame from a plain JSON description. The same character
// sheet always produces the same figure, so a character cannot drift between
// scenes — consistency is a property of the renderer, not of a sampling trick.

// Proportions as a fraction of total character height. head + torso + legs plus
// the neck should land near 0.92 so the figure fills its box without clipping.
const BUILDS = {
  child: { head: 0.29, torso: 0.26, legs: 0.29, width: 0.30, eye: 1.3 },
  adult: { head: 0.22, torso: 0.31, legs: 0.38, width: 0.28, eye: 1 },
  round: { head: 0.24, torso: 0.30, legs: 0.31, width: 0.40, eye: 1.1 },
  tall: { head: 0.185, torso: 0.31, legs: 0.44, width: 0.24, eye: 0.95 },
};

const TIME_SKY = {
  day: null, // use the style's own sky
  sunset: ["#f97e4a", "#ffd9a0"],
  night: ["#0d1330", "#2a3a6b"],
  indoor: null,
};

function skyColors(style, time) {
  return TIME_SKY[time] || style.sky;
}

// Apply the style's saturation to a color so every element of a scene shifts
// together when the user switches style.
function tone(style, color) {
  const c = parseColor(color);
  const lum = (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114);
  const k = style.saturate;
  return [
    Math.max(0, Math.min(255, lum + (c[0] - lum) * k)),
    Math.max(0, Math.min(255, lum + (c[1] - lum) * k)),
    Math.max(0, Math.min(255, lum + (c[2] - lum) * k)),
  ];
}

// --- backgrounds -----------------------------------------------------------

function drawSky(cv, style, time, horizon) {
  const [a, b] = skyColors(style, time);
  cv.gradient(0, 0, cv.width, horizon, tone(style, a), tone(style, b));
}

function drawStars(cv, style, horizon, rand) {
  for (let i = 0; i < 90; i++) {
    const x = rand() * cv.width;
    const y = rand() * horizon * 0.9;
    const r = 0.6 + rand() * 1.8;
    cv.circle(x, y, r, "#ffffff", 0.4 + rand() * 0.6);
  }
}

function drawSun(cv, style, x, y, r, color) {
  for (let i = 6; i > 0; i--) cv.circle(x, y, r * (1 + i * 0.22), color, 0.05);
  cv.circle(x, y, r, tone(style, color));
}

function drawClouds(cv, style, horizon, rand) {
  const white = tone(style, "#ffffff");
  for (let i = 0; i < 4; i++) {
    const x = rand() * cv.width;
    const y = horizon * (0.12 + rand() * 0.4);
    const s = 26 + rand() * 34;
    cv.ellipse(x, y, s * 1.5, s * 0.62, white, 0.92);
    cv.ellipse(x - s * 0.8, y + s * 0.16, s * 0.85, s * 0.5, white, 0.92);
    cv.ellipse(x + s * 0.85, y + s * 0.2, s * 0.75, s * 0.44, white, 0.92);
  }
}

function drawHills(cv, style, horizon, ground, rand) {
  for (let layer = 0; layer < 3; layer++) {
    const col = shade(tone(style, ground), 0.28 - layer * 0.16);
    const base = horizon - layer * 6;
    const pts = [[-40, base + 40]];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const x = (-40 + ((cv.width + 80) * i) / steps);
      const bump = Math.sin(i * 1.7 + layer * 2.3 + rand() * 0.4) * (34 - layer * 8);
      pts.push([x, base - 26 + layer * 14 + bump]);
    }
    pts.push([cv.width + 40, base + 40]);
    cv.polygon(pts, col);
  }
}

function drawTree(cv, style, x, baseY, h, leaf, trunk) {
  cv.line(x, baseY, x, baseY - h * 0.55, h * 0.1, tone(style, trunk));
  const r = h * 0.3;
  cv.circle(x, baseY - h * 0.72, r, tone(style, leaf));
  cv.circle(x - r * 0.72, baseY - h * 0.55, r * 0.72, tone(style, leaf));
  cv.circle(x + r * 0.72, baseY - h * 0.55, r * 0.72, tone(style, leaf));
  cv.circle(x, baseY - h * 0.9, r * 0.66, shade(tone(style, leaf), 0.12));
}

function drawBuildings(cv, style, horizon, rand, lit) {
  const palette = ["#5a6b8c", "#48597a", "#6a7ba0", "#3f4f6d"];
  let x = -20;
  while (x < cv.width + 20) {
    const w = 46 + rand() * 78;
    const h = 70 + rand() * 210;
    const col = tone(style, palette[Math.floor(rand() * palette.length)]);
    cv.fillRect(x, horizon - h, w, h + 6, col);
    const winCol = lit ? "#ffd978" : "#cfe4f5";
    for (let wy = horizon - h + 14; wy < horizon - 16; wy += 24) {
      for (let wx = x + 9; wx < x + w - 12; wx += 20) {
        if (rand() > 0.32) cv.fillRect(wx, wy, 9, 12, tone(style, winCol), lit ? 0.95 : 0.55);
      }
    }
    x += w + 5 + rand() * 12;
  }
}

function drawMountains(cv, style, horizon, rand) {
  for (let layer = 0; layer < 2; layer++) {
    const col = shade(tone(style, "#6d7f96"), layer === 0 ? -0.15 : 0.12);
    let x = -60;
    while (x < cv.width + 60) {
      const w = 180 + rand() * 220;
      const h = 130 + rand() * 170 - layer * 40;
      const peak = [x + w / 2, horizon - h];
      cv.polygon([[x, horizon + 8], peak, [x + w, horizon + 8]], col);
      cv.polygon(
        [
          [peak[0] - w * 0.14, horizon - h * 0.72],
          peak,
          [peak[0] + w * 0.14, horizon - h * 0.72],
        ],
        tone(style, "#f2f6fb")
      );
      x += w * 0.62;
    }
  }
}

function drawRoom(cv, style, horizon, props, rand) {
  const wall = tone(style, "#e6dcc8");
  cv.gradient(0, 0, cv.width, horizon, shade(wall, 0.1), shade(wall, -0.08));
  cv.fillRect(0, horizon, cv.width, cv.height - horizon, tone(style, "#a9773f"));
  for (let x = -horizon; x < cv.width + 200; x += 74) {
    cv.line(x, horizon, x + 130, cv.height, 2.5, shade(tone(style, "#a9773f"), -0.2), 0.5);
  }
  cv.fillRect(0, horizon - 10, cv.width, 10, shade(wall, -0.25));

  if (props.includes("window")) {
    const wx = cv.width * 0.14;
    const wy = horizon * 0.24;
    cv.fillRect(wx - 8, wy - 8, 186, 146, shade(tone(style, "#7a5a33"), 0));
    cv.gradient(wx, wy, 170, 130, tone(style, "#8fd0f5"), tone(style, "#d9f0ff"));
    cv.line(wx + 85, wy, wx + 85, wy + 130, 6, shade(tone(style, "#7a5a33"), 0));
    cv.line(wx, wy + 65, wx + 170, wy + 65, 6, shade(tone(style, "#7a5a33"), 0));
  }
  if (props.includes("door")) {
    const dx = cv.width * 0.76;
    cv.fillRect(dx, horizon - 220, 120, 220, tone(style, "#8a5c33"));
    cv.circle(dx + 100, horizon - 108, 6, tone(style, "#ffd76a"));
  }
  if (props.includes("board")) {
    cv.fillRect(cv.width * 0.3, horizon * 0.2, cv.width * 0.4, horizon * 0.5, tone(style, "#2f4f3f"));
    cv.fillRect(cv.width * 0.3 - 8, horizon * 0.2 - 8, cv.width * 0.4 + 16, 10, tone(style, "#8a5c33"));
  }
  if (props.includes("desk")) {
    cv.fillRect(cv.width * 0.34, horizon - 60, 300, 18, tone(style, "#b07a45"));
    cv.fillRect(cv.width * 0.36, horizon - 44, 14, 46, tone(style, "#8a5c33"));
    cv.fillRect(cv.width * 0.34 + 272, horizon - 44, 14, 46, tone(style, "#8a5c33"));
  }
  if (props.includes("rug")) {
    cv.ellipse(cv.width * 0.5, cv.height - 60, 320, 66, tone(style, "#c05a5a"), 0.85);
  }
}

function drawWater(cv, style, horizon, rand, color = "#2f8fc9") {
  cv.gradient(0, horizon, cv.width, cv.height - horizon, tone(style, color), shade(tone(style, color), -0.3));
  for (let i = 0; i < 26; i++) {
    const y = horizon + rand() * (cv.height - horizon) * 0.8;
    const x = rand() * cv.width;
    const w = 24 + rand() * 70;
    cv.line(x, y, x + w, y, 2.4, "#ffffff", 0.16 + rand() * 0.2);
  }
}

// Renders the whole backdrop for a scene description.
function drawBackground(cv, style, scene, rand) {
  const setting = scene.setting || "meadow";
  const time = scene.time || "day";
  const props = scene.props || [];
  const horizon = Math.round(cv.height * (setting === "space" ? 1 : 0.68));
  const ground = scene.palette?.ground || style.ground;

  if (setting === "room" || setting === "classroom" || setting === "indoor") {
    drawRoom(cv, style, horizon, props.concat(setting === "classroom" ? ["board", "desk"] : []), rand);
    return horizon;
  }

  if (setting === "space") {
    cv.gradient(0, 0, cv.width, cv.height, "#05061a", "#1b1040");
    drawStars(cv, style, cv.height, rand);
    cv.circle(cv.width * 0.76, cv.height * 0.26, 78, tone(style, "#c96a4a"));
    cv.circle(cv.width * 0.76 - 22, cv.height * 0.26 - 20, 66, shade(tone(style, "#c96a4a"), 0.16));
    return cv.height * 0.86;
  }

  if (setting === "underwater") {
    cv.gradient(0, 0, cv.width, cv.height, tone(style, "#1f6fa8"), tone(style, "#062f4d"));
    for (let i = 0; i < 40; i++) {
      cv.circle(rand() * cv.width, rand() * cv.height, 2 + rand() * 7, "#ffffff", 0.12 + rand() * 0.15);
    }
    cv.fillRect(0, cv.height * 0.86, cv.width, cv.height * 0.14, tone(style, "#d8c48a"));
    for (let i = 0; i < 9; i++) {
      const x = rand() * cv.width;
      const h = 70 + rand() * 150;
      cv.line(x, cv.height * 0.88, x + (rand() - 0.5) * 50, cv.height * 0.88 - h, 10, tone(style, "#2f8f5a"), 0.9);
    }
    return cv.height * 0.86;
  }

  drawSky(cv, style, time, horizon);

  if (time === "night") {
    drawStars(cv, style, horizon, rand);
    if (props.includes("moon") || true) drawSun(cv, style, cv.width * 0.8, horizon * 0.24, 34, "#f4f1d8");
  } else if (props.includes("sun") || time === "sunset") {
    drawSun(cv, style, cv.width * 0.78, horizon * 0.26, 40, time === "sunset" ? "#ffb057" : "#ffe27a");
  }
  if (props.includes("clouds") && time !== "night") drawClouds(cv, style, horizon, rand);

  if (setting === "city") {
    drawBuildings(cv, style, horizon, rand, time === "night");
    cv.fillRect(0, horizon, cv.width, cv.height - horizon, tone(style, "#4b4b52"));
    for (let x = 20; x < cv.width; x += 90) {
      cv.fillRect(x, horizon + (cv.height - horizon) * 0.55, 52, 7, tone(style, "#f0f0f0"), 0.8);
    }
    return horizon;
  }

  if (setting === "mountain") drawMountains(cv, style, horizon, rand);
  if (setting === "beach") {
    drawWater(cv, style, horizon, rand);
    cv.polygon(
      [
        [0, cv.height],
        [0, horizon + (cv.height - horizon) * 0.42],
        [cv.width, horizon + (cv.height - horizon) * 0.62],
        [cv.width, cv.height],
      ],
      tone(style, "#efd9a4")
    );
    return horizon + (cv.height - horizon) * 0.55;
  }
  if (setting === "desert") {
    cv.fillRect(0, horizon, cv.width, cv.height - horizon, tone(style, "#e2b878"));
    for (let i = 0; i < 3; i++) {
      const y = horizon + 24 + i * 44;
      cv.ellipse(cv.width * (0.2 + i * 0.3), y, 260, 40, shade(tone(style, "#e2b878"), -0.08 * (i + 1)));
    }
    return horizon;
  }

  // meadow / forest / generic outdoors
  if (setting !== "forest") drawHills(cv, style, horizon, ground, rand);
  cv.fillRect(0, horizon, cv.width, cv.height - horizon, tone(style, ground));
  cv.gradient(0, horizon, cv.width, (cv.height - horizon) * 0.5, shade(tone(style, ground), 0.12), tone(style, ground));

  if (setting === "forest" || props.includes("trees")) {
    const count = setting === "forest" ? 9 : 3;
    for (let i = 0; i < count; i++) {
      const x = ((i + 0.5) / count) * cv.width + (rand() - 0.5) * 70;
      const h = 150 + rand() * 130;
      drawTree(cv, style, x, horizon + 12 + rand() * 18, h, "#3f8f43", "#6b4a2b");
    }
  }
  if (props.includes("flowers")) {
    for (let i = 0; i < 26; i++) {
      const x = rand() * cv.width;
      const y = horizon + 14 + rand() * (cv.height - horizon - 20);
      const col = ["#ff6f7d", "#ffd85e", "#ffffff", "#c47bff"][Math.floor(rand() * 4)];
      cv.circle(x, y, 4.5, tone(style, col));
      cv.circle(x, y, 1.8, tone(style, "#ffcf3f"));
    }
  }
  if (props.includes("rocks")) {
    for (let i = 0; i < 6; i++) {
      const x = rand() * cv.width;
      const y = horizon + 20 + rand() * (cv.height - horizon - 30);
      cv.ellipse(x, y, 16 + rand() * 22, 10 + rand() * 12, tone(style, "#8d8d95"));
    }
  }
  return horizon;
}

// --- characters ------------------------------------------------------------

// Hair is drawn in two passes — the mass behind the head, then the cap over the
// crown — so it frames the face instead of covering it.
function drawHairBack(cv, sheet, hx, hy, hr, style) {
  const hair = tone(style, sheet.hair);
  switch (sheet.hairStyle) {
    case "long":
      // Two side masses plus a crown mass, so the hair never closes under the
      // chin — a single ellipse behind the head reads as a beard.
      cv.ellipse(hx, hy - hr * 0.2, hr * 1.14, hr * 1.05, hair);
      cv.ellipse(hx - hr * 0.78, hy + hr * 0.5, hr * 0.5, hr * 1.3, hair);
      cv.ellipse(hx + hr * 0.78, hy + hr * 0.5, hr * 0.5, hr * 1.3, hair);
      break;
    case "bun":
      cv.circle(hx, hy - hr * 1.18, hr * 0.42, hair);
      break;
    case "spiky":
      for (let i = -4; i <= 4; i++) {
        const a = (i / 4) * 1.15 - Math.PI / 2;
        cv.polygon(
          [
            [hx + Math.cos(a - 0.2) * hr * 0.95, hy + Math.sin(a - 0.2) * hr * 0.95],
            [hx + Math.cos(a) * hr * 1.55, hy + Math.sin(a) * hr * 1.55],
            [hx + Math.cos(a + 0.2) * hr * 0.95, hy + Math.sin(a + 0.2) * hr * 0.95],
          ],
          hair
        );
      }
      break;
    case "curly":
      for (let i = -3; i <= 3; i++) {
        cv.circle(hx + i * hr * 0.36, hy - hr * 0.62 + Math.abs(i) * hr * 0.14, hr * 0.4, hair);
      }
      break;
    default:
      break;
  }
}

function drawHairFront(cv, sheet, hx, hy, hr, style) {
  if (sheet.hairStyle === "bald") return;
  const hair = tone(style, sheet.hair);
  // Crown cap: covers the top of the skull and stops just above the eye line.
  cv.ellipse(hx, hy - hr * 0.62, hr * 1.03, hr * 0.62, hair);
  if (sheet.hairStyle === "long") {
    cv.ellipse(hx - hr * 0.86, hy + hr * 0.1, hr * 0.28, hr * 0.8, hair);
    cv.ellipse(hx + hr * 0.86, hy + hr * 0.1, hr * 0.28, hr * 0.8, hair);
  }
  if (sheet.hairStyle === "curly") {
    for (let i = -2; i <= 2; i++) cv.circle(hx + i * hr * 0.42, hy - hr * 0.86, hr * 0.3, hair);
  }
}

// Draws one character from its sheet at a pose. `baseY` is the ground line.
function drawCharacter(cv, style, sheet, pose, cx, baseY, height) {
  const b = BUILDS[sheet.build] || BUILDS.adult;
  const ink = style.outline ? shade(tone(style, sheet.shirt), -0.75) : null;
  const lw = style.outline ? Math.max(1.5, height * 0.012 * (style.outline / 3)) : 0;
  const facing = pose.facing === "left" ? -1 : 1;

  const headR = height * b.head * 0.5;
  const legLen = height * b.legs;
  const torsoH = height * b.torso;
  const bodyW = height * b.width * 0.5;
  const neckH = height * 0.03;
  const hipY = baseY - legLen;
  const shoulderY = hipY - torsoH;
  // The head rests above the shoulders on a neck rather than sinking into the torso.
  const headY = shoulderY - neckH - headR;

  const walk = pose.pose === "walk" || pose.pose === "run";
  const sitting = pose.pose === "sit";
  // Stride scales with the figure's own width, so a slim build does not end up
  // doing the splits while a wide one barely moves.
  const swing = walk ? bodyW * 0.6 : 0;

  // contact shadow
  cv.ellipse(cx, baseY + height * 0.012, bodyW * 1.25, height * 0.028, "#000000", 0.22);

  const skin = tone(style, sheet.skin);
  const shirt = tone(style, sheet.shirt);
  const pants = tone(style, sheet.pants);
  const shoes = tone(style, sheet.shoes);

  // legs
  const legW = bodyW * 0.42;
  if (sitting) {
    cv.line(cx - bodyW * 0.4, hipY, cx + facing * bodyW * 0.9, hipY + legLen * 0.36, legW, pants);
    cv.line(cx + facing * bodyW * 0.9, hipY + legLen * 0.36, cx + facing * bodyW * 0.9, baseY, legW, pants);
    cv.ellipse(cx + facing * bodyW * 1.05, baseY, legW * 0.8, legW * 0.44, shoes);
  } else {
    const l1 = cx - bodyW * 0.42 + (walk ? -swing : 0);
    const l2 = cx + bodyW * 0.42 + (walk ? swing : 0);
    if (lw) {
      cv.line(cx - bodyW * 0.42, hipY, l1, baseY, legW + lw * 2, ink);
      cv.line(cx + bodyW * 0.42, hipY, l2, baseY, legW + lw * 2, ink);
    }
    cv.line(cx - bodyW * 0.42, hipY, l1, baseY, legW, pants);
    cv.line(cx + bodyW * 0.42, hipY, l2, baseY, legW, pants);
    cv.ellipse(l1, baseY, legW * 0.78, legW * 0.42, shoes);
    cv.ellipse(l2, baseY, legW * 0.78, legW * 0.42, shoes);
  }

  // neck, drawn before the torso so the collar overlaps it
  cv.fillRect(cx - bodyW * 0.3, shoulderY - neckH - headR * 0.3, bodyW * 0.6, neckH + headR * 0.4, shade(skin, -0.1));

  // torso
  if (lw) cv.roundRect(cx - bodyW - lw, shoulderY - lw, (bodyW + lw) * 2, torsoH + lw * 2, bodyW * 0.55, ink);
  cv.roundRect(cx - bodyW, shoulderY, bodyW * 2, torsoH + height * 0.01, bodyW * 0.5, shirt);

  // arms
  const armW = bodyW * 0.34;
  const armLen = torsoH * 0.94;
  const armPose = pose.pose;
  let a1 = [cx - bodyW * 0.9, shoulderY + armLen];
  let a2 = [cx + bodyW * 0.9, shoulderY + armLen];
  if (armPose === "wave") a2 = [cx + bodyW * 1.5, shoulderY - armLen * 0.55];
  if (armPose === "point") a2 = [cx + facing * bodyW * 2.0, shoulderY + armLen * 0.1];
  if (armPose === "jump" || armPose === "cheer") {
    a1 = [cx - bodyW * 1.4, shoulderY - armLen * 0.6];
    a2 = [cx + bodyW * 1.4, shoulderY - armLen * 0.6];
  }
  if (walk) {
    // Arms counter-swing, but stay outside the torso so they never cross it.
    a1 = [cx - bodyW * 1.05, shoulderY + armLen - swing * 0.5];
    a2 = [cx + bodyW * 1.05, shoulderY + armLen + swing * 0.5];
  }
  const sx = cx - bodyW * 0.82;
  const ex = cx + bodyW * 0.82;
  if (lw) {
    cv.line(sx, shoulderY + torsoH * 0.16, a1[0], a1[1], armW + lw * 2, ink);
    cv.line(ex, shoulderY + torsoH * 0.16, a2[0], a2[1], armW + lw * 2, ink);
  }
  cv.line(sx, shoulderY + torsoH * 0.16, a1[0], a1[1], armW, shirt);
  cv.line(ex, shoulderY + torsoH * 0.16, a2[0], a2[1], armW, shirt);
  cv.circle(a1[0], a1[1], armW * 0.62, skin);
  cv.circle(a2[0], a2[1], armW * 0.62, skin);

  // head — hair mass behind, face over it, crown on top
  drawHairBack(cv, sheet, cx, headY, headR, style);
  if (lw) cv.circle(cx, headY, headR + lw, ink);
  cv.circle(cx, headY, headR, skin);
  drawHairFront(cv, sheet, cx, headY, headR, style);

  // face
  const eyeY = headY + headR * 0.1;
  const eyeDx = headR * 0.34;
  const eyeR = headR * 0.18 * (b.eye || 1);
  const eyeX = (s) => cx + s * eyeDx + facing * headR * 0.05;
  const specs = sheet.accessory === "glasses";

  // The lens disc is laid down first and the eye redrawn inside it, so the frame
  // reads as a ring instead of a filled circle over the eye.
  if (specs) for (const s of [-1, 1]) cv.circle(eyeX(s), eyeY, eyeR * 1.95, "#2b2f3a");
  for (const s of [-1, 1]) {
    const w = specs ? eyeR * 1.5 : eyeR;
    cv.ellipse(eyeX(s), eyeY, w, specs ? w : eyeR * 1.12, "#ffffff");
    cv.circle(eyeX(s) + facing * eyeR * 0.2, eyeY + eyeR * 0.12, eyeR * 0.52, "#20242e");
    cv.circle(eyeX(s) + facing * eyeR * 0.2 + eyeR * 0.2, eyeY - eyeR * 0.16, eyeR * 0.17, "#ffffff");
  }
  if (specs) {
    cv.line(eyeX(-1) + eyeR * 1.75, eyeY, eyeX(1) - eyeR * 1.75, eyeY, headR * 0.07, "#2b2f3a");
    cv.line(eyeX(-1) - eyeR * 1.75, eyeY, cx - headR, eyeY - headR * 0.08, headR * 0.07, "#2b2f3a");
    cv.line(eyeX(1) + eyeR * 1.75, eyeY, cx + headR, eyeY - headR * 0.08, headR * 0.07, "#2b2f3a");
  }

  // eyebrows carry most of the expression
  const browY = eyeY - eyeR * (pose.expression === "surprised" ? 2.6 : 2.0) - (specs ? eyeR * 0.5 : 0);
  const browCol = shade(tone(style, sheet.hair), -0.05);
  for (const s of [-1, 1]) {
    const tilt = pose.expression === "sad" ? s * eyeR * 0.4 : pose.expression === "angry" ? -s * eyeR * 0.4 : 0;
    cv.line(eyeX(s) - eyeR * 0.72, browY + tilt, eyeX(s) + eyeR * 0.72, browY - tilt * 0.4, headR * 0.08, browCol);
  }
  const smile = pose.expression === "sad" ? -1 : 1;
  const my = headY + headR * 0.46;
  if (pose.expression === "surprised") {
    cv.ellipse(cx + facing * headR * 0.06, my, headR * 0.16, headR * 0.22, "#7d3b3b");
  } else {
    for (let i = -4; i <= 4; i++) {
      const t = i / 4;
      cv.circle(
        cx + facing * headR * 0.06 + t * headR * 0.32,
        my + smile * (1 - t * t) * headR * 0.14,
        headR * 0.055,
        "#7d3b3b"
      );
    }
  }
  cv.circle(cx - headR * 0.62, eyeY + headR * 0.28, headR * 0.16, "#ff9f9f", 0.5);
  cv.circle(cx + headR * 0.62, eyeY + headR * 0.28, headR * 0.16, "#ff9f9f", 0.5);

  // accessory
  if (sheet.accessory === "hat") {
    const hc = tone(style, sheet.accessoryColor || "#c0392b");
    cv.ellipse(cx, headY - headR * 0.72, headR * 1.5, headR * 0.24, hc);
    cv.roundRect(cx - headR * 0.78, headY - headR * 1.5, headR * 1.56, headR * 0.86, headR * 0.2, hc);
  } else if (sheet.accessory === "bow") {
    const hc = tone(style, sheet.accessoryColor || "#ff5f8d");
    cv.circle(cx - headR * 0.85, headY - headR * 0.6, headR * 0.26, hc);
    cv.circle(cx - headR * 1.25, headY - headR * 0.6, headR * 0.2, hc);
  }
}

// --- public API ------------------------------------------------------------

export function renderScene(scene, sheets, style, { width = 1280, height = 720, seed = 1 } = {}) {
  const cv = new Canvas(width, height, 2);
  const rand = rng(seed);
  const horizon = drawBackground(cv, style, scene, rand);

  const cast = scene.characters || [];
  // Draw back-to-front so a smaller (further) character never overlaps a nearer one.
  const ordered = [...cast].sort((a, b) => (a.scale || 0.5) - (b.scale || 0.5));
  for (const c of ordered) {
    const sheet = sheets[c.id] || Object.values(sheets)[0];
    if (!sheet) continue;
    const scale = Math.max(0.12, Math.min(1.35, c.scale ?? 0.55));
    const charH = height * 0.6 * scale * (scene.camera === "close" ? 1.7 : scene.camera === "wide" ? 0.75 : 1);
    const baseY = Math.min(height - 6, horizon + (height - horizon) * (0.35 + 0.4 * scale));
    drawCharacter(cv, style, sheet, c, (c.x ?? 0.5) * width, baseY, charH);
  }

  if (style.grain) cv.grain(style.grain, seed * 2654435761);
  if (style.vignette) cv.vignette(style.vignette);
  return cv.toPNG();
}

// A poster frame used for the title card.
export function renderTitleCard(style, seed = 7) {
  const cv = new Canvas(1280, 720, 2);
  const rand = rng(seed);
  const [a, b] = style.sky;
  cv.gradient(0, 0, 1280, 720, shade(tone(style, a), -0.15), tone(style, b));
  for (let i = 0; i < 5; i++) {
    cv.circle(rand() * 1280, rand() * 720, 60 + rand() * 190, "#ffffff", 0.05);
  }
  if (style.grain) cv.grain(style.grain, seed);
  cv.vignette(0.45);
  return cv.toPNG();
}
