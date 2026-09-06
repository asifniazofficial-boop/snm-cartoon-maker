// Visual style presets. Each one is both a rendering treatment for the built-in
// renderer and a prompt fragment for external image providers, so switching style
// changes every scene without touching the story or the characters.

export const STYLES = {
  "classic-cartoon": {
    name: "Classic Cartoon",
    prompt: "classic hand-drawn cartoon, bold black outlines, flat saturated colors, 1990s Saturday-morning animation",
    outline: 3,
    saturate: 1.15,
    grain: 0,
    vignette: 0.2,
    sky: ["#7ec8ff", "#cdeeff"],
    ground: "#6fc46f",
  },
  modern: {
    name: "Modern Animation",
    prompt: "modern flat vector animation, clean lines, soft contemporary palette, subtle gradients",
    outline: 0,
    saturate: 1,
    grain: 0,
    vignette: 0.15,
    sky: ["#5aa9e6", "#bfe3f5"],
    ground: "#7bc47f",
  },
  "3d": {
    name: "3D Render",
    prompt: "stylized 3D animated film still, soft global illumination, rounded shapes, depth of field",
    outline: 0,
    saturate: 1.05,
    grain: 3,
    vignette: 0.4,
    sky: ["#3d7fbf", "#a9d6ef"],
    ground: "#5fae64",
  },
  comic: {
    name: "Comic Book",
    prompt: "comic book panel, heavy ink outlines, halftone shading, dynamic high-contrast colors",
    outline: 5,
    saturate: 1.3,
    grain: 10,
    vignette: 0.3,
    sky: ["#ffd45e", "#ffeaa8"],
    ground: "#e08a3c",
  },
  anime: {
    name: "Anime",
    prompt: "anime key visual, cel shading, expressive large eyes, luminous skies, crisp linework",
    outline: 2,
    saturate: 1.2,
    grain: 0,
    vignette: 0.25,
    sky: ["#4f8fe0", "#ffd9e8"],
    ground: "#66b96a",
  },
  storybook: {
    name: "Storybook",
    prompt: "children's picture-book illustration, warm gouache textures, gentle rounded shapes",
    outline: 1,
    saturate: 0.95,
    grain: 12,
    vignette: 0.3,
    sky: ["#f6c99f", "#fdeccd"],
    ground: "#8fbf6a",
  },
  watercolor: {
    name: "Watercolor",
    prompt: "loose watercolor painting, soft washes, visible paper texture, muted natural palette",
    outline: 0,
    saturate: 0.85,
    grain: 18,
    vignette: 0.35,
    sky: ["#a8c8dd", "#eef4f7"],
    ground: "#9ab87a",
  },
  sketch: {
    name: "Pencil Sketch",
    prompt: "hand-drawn pencil sketch, graphite hatching, monochrome with a single accent color",
    outline: 2,
    saturate: 0.25,
    grain: 22,
    vignette: 0.4,
    sky: ["#d8d8d8", "#f2f2f2"],
    ground: "#b8b8b8",
  },
  "paper-craft": {
    name: "Paper Craft",
    prompt: "layered cut-paper collage, visible paper edges and drop shadows, craft textures",
    outline: 0,
    saturate: 1.05,
    grain: 14,
    vignette: 0.28,
    sky: ["#8fd3f4", "#dff4fd"],
    ground: "#83c66b",
  },
  "low-poly": {
    name: "Low Poly",
    prompt: "low-poly geometric illustration, faceted triangular shading, crisp flat facets",
    outline: 0,
    saturate: 1.1,
    grain: 0,
    vignette: 0.3,
    sky: ["#4a6fa5", "#9fc0e0"],
    ground: "#5d9e5d",
  },
  retro: {
    name: "Retro Print",
    prompt: "mid-century retro print, limited spot-color palette, offset misregistration, textured paper",
    outline: 2,
    saturate: 0.9,
    grain: 20,
    vignette: 0.35,
    sky: ["#e8d5a9", "#f5ead1"],
    ground: "#c08b5c",
  },
  neon: {
    name: "Neon Night",
    prompt: "neon-lit night scene, glowing magenta and cyan rim light, deep shadows, synthwave mood",
    outline: 0,
    saturate: 1.35,
    grain: 6,
    vignette: 0.55,
    sky: ["#1b1040", "#7a2b8a"],
    ground: "#241a4a",
  },
};

export const DEFAULT_STYLE = "classic-cartoon";

export function getStyle(id) {
  return STYLES[id] || STYLES[DEFAULT_STYLE];
}

export function styleList() {
  return Object.entries(STYLES).map(([id, s]) => ({ id, name: s.name }));
}
