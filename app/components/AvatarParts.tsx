// Avatar builder — modular system using assets from public/pixels/
// All parts are 32x32 with consistent positioning so they layer correctly

import {
  // Full character templates
  DS_HERO_V1, DS_CROFLY_V1, DS_ZEBOS_V1, DS_GURU_V1, DS_IRON_V1,
  DS_MALE_HIPSTER_V1, DS_MW_V1,
  // Hair
  DS_HAIR_BALD, DS_HAIR_HERO, DS_HAIR_CURLY, DS_HAIR_MALE_SHORT,
  DS_HAIR_PONYTAIL, DS_HAIR_TOPKNOT,
  // Eyes
  DS_EYES_DOT_NARROW, DS_EYES_DOT_NARROW_UP,
  DS_EYES_DOT_WIDE, DS_EYES_DOT_WIDE_UP,
  DS_EYES_TALL_NARROW, DS_EYES_TALL_NARROW_UP,
  DS_EYES_TALL_WIDE, DS_EYES_TALL_WIDE_UP,
  DS_EYES_WHITE_NARROW, DS_EYES_WHITE_NARROW_UP,
  DS_EYES_WHITE_WIDE, DS_EYES_WHITE_WIDE_UP,
  // Mouths
  DS_MOUTH_NARROW, DS_MOUTH_NARROW_DOWN,
  DS_MOUTH_WIDE, DS_MOUTH_WIDE_DOWN,
  DS_SMILE_NARROW_OPEN, DS_SMILE_NARROW_FILLED,
  DS_SMILE_WIDE_OPEN, DS_SMILE_WIDE_FILL,
  // Face features
  DS_FACE_BEARD,
  type Pixel,
} from "./PixelAssets";

type PixelMap = Map<string, string>;
const BLK = "#000000";

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════

export function darken(hex: string, amount = 40): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function lighten(hex: string, amount = 30): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function pixelsToMap(pixels: Pixel[]): PixelMap {
  const m: PixelMap = new Map();
  pixels.forEach(([x, y, c]) => m.set(`${x},${y}`, c));
  return m;
}

function applyOverlay(base: PixelMap, overlay: Pixel[], colorMap?: Record<string, string>) {
  overlay.forEach(([x, y, c]) => {
    const final = colorMap && colorMap[c] ? colorMap[c] : c;
    base.set(`${x},${y}`, final);
  });
}

// Recolor a layer's pixels by mapping source colors to target colors
function recolor(pixels: Pixel[], colorMap: Record<string, string>): Pixel[] {
  return pixels.map(([x, y, c]) => [x, y, colorMap[c] || c] as Pixel);
}

// ══════════════════════════════════════════════════════
// COLOR PALETTES
// ══════════════════════════════════════════════════════

export const SKIN_TONES = [
  { name: "Porcelain", color: "#FFE6C7" },
  { name: "Light", color: "#FFCD94" },
  { name: "Fair", color: "#F1C27D" },
  { name: "Medium", color: "#E0AC69" },
  { name: "Tan", color: "#C68642" },
  { name: "Olive", color: "#A57548" },
  { name: "Brown", color: "#8D5524" },
  { name: "Dark Brown", color: "#6F4E37" },
  { name: "Dark", color: "#4E342E" },
  { name: "Deep", color: "#3E2723" },
];

export const HAIR_COLORS = [
  { name: "Black", color: "#1A1A2E" },
  { name: "Dark Brown", color: "#3D2314" },
  { name: "Brown", color: "#8B4513" },
  { name: "Auburn", color: "#A0522D" },
  { name: "Dirty Blonde", color: "#B8860B" },
  { name: "Blonde", color: "#C4A35A" },
  { name: "Light Blonde", color: "#E8D5B7" },
  { name: "Ginger", color: "#D94000" },
  { name: "Red", color: "#C1272D" },
  { name: "Grey", color: "#94A3B8" },
  { name: "White", color: "#E8E8E8" },
  { name: "Blue", color: "#2C6ECB" },
  { name: "Purple", color: "#8B5CF6" },
  { name: "Pink", color: "#FF6B9D" },
  { name: "Green", color: "#29845A" },
];

export const OUTFIT_COLORS = [
  { name: "Red", color: "#D50000" },
  { name: "Dark Red", color: "#850000" },
  { name: "Orange", color: "#E8963A" },
  { name: "Yellow", color: "#FFC42A" },
  { name: "Lime", color: "#A4DD00" },
  { name: "Green", color: "#29845A" },
  { name: "Teal", color: "#14B8A6" },
  { name: "Cyan", color: "#06B6D4" },
  { name: "Blue", color: "#2979FF" },
  { name: "Dark Blue", color: "#1E3A5F" },
  { name: "Navy", color: "#0F1E3C" },
  { name: "Purple", color: "#8B5CF6" },
  { name: "Magenta", color: "#EC4899" },
  { name: "Pink", color: "#FF6B9D" },
  { name: "Brown", color: "#8B4513" },
  { name: "Beige", color: "#D4B896" },
  { name: "White", color: "#F0F0F0" },
  { name: "Grey", color: "#94A3B8" },
  { name: "Dark Grey", color: "#4A5568" },
  { name: "Black", color: "#1A1A2E" },
];

// ══════════════════════════════════════════════════════
// BASE TEMPLATES — full v1 character starting points
// Each defines its own color palette that can be recolored
// ══════════════════════════════════════════════════════

export interface BaseTemplate {
  name: string;
  pixels: Pixel[];
  // Original colors mapped to semantic roles for recoloring
  skinColor: string;
  hairColor?: string;     // for templates where hair is colored (not part of outline)
  topColor: string;       // main shirt
  capeColor?: string;     // if has cape
  accentColor: string;    // belt/details
  hasCape: boolean;
  hasIntegratedHair: boolean; // true if hair is part of the black outline (Hero, Iron, MW)
}

export const BASE_TEMPLATES: BaseTemplate[] = [
  {
    name: "Hero",
    pixels: DS_HERO_V1,
    skinColor: "#FFCD94",
    topColor: "#2979FF",
    capeColor: "#D50000",
    accentColor: "#FFC42A",
    hasCape: true,
    hasIntegratedHair: true, // Hero's hair is part of the black outline
  },
  {
    name: "Crofly",
    pixels: DS_CROFLY_V1,
    skinColor: "#FFCD94",
    hairColor: "#8D5524",
    topColor: "#FFC42A",
    capeColor: "#448AFF",
    accentColor: "#D50000",
    hasCape: true,
    hasIntegratedHair: false,
  },
  {
    name: "Zebos",
    pixels: DS_ZEBOS_V1,
    skinColor: "#FFE0BD",
    hairColor: "#4C2D17",
    topColor: "#FFFFFF",
    accentColor: "#607D8B",
    hasCape: false,
    hasIntegratedHair: false,
  },
  {
    name: "Guru",
    pixels: DS_GURU_V1,
    skinColor: "#FFC587",
    hairColor: "#795548",
    topColor: "#850000",
    accentColor: "#546E7A",
    hasCape: false,
    hasIntegratedHair: false,
  },
  {
    name: "Iron",
    pixels: DS_IRON_V1,
    skinColor: "#FFC42A", // gold mask
    topColor: "#850000",
    accentColor: "#FFC42A",
    hasCape: false,
    hasIntegratedHair: true,
  },
  {
    name: "Hipster",
    pixels: DS_MALE_HIPSTER_V1,
    skinColor: "#FFCD94",
    hairColor: "#8D5524",
    topColor: "#03A9F4",
    accentColor: "#263238",
    hasCape: false,
    hasIntegratedHair: false,
  },
  {
    name: "MW",
    pixels: DS_MW_V1,
    skinColor: "#613D24",
    topColor: "#212121",
    accentColor: "#9E9E9E",
    hasCape: false,
    hasIntegratedHair: true,
  },
];

// ══════════════════════════════════════════════════════
// HAIR STYLES — overlay parts (rows 3-15)
// Each replaces the head's hair region
// ══════════════════════════════════════════════════════

export const HAIR_STYLES: Array<{ name: string; icon: string; pixels: Pixel[] | null }> = [
  { name: "Default", icon: "👤", pixels: null }, // keep base template's hair
  { name: "Bald", icon: "🥵", pixels: DS_HAIR_BALD },
  { name: "Hero", icon: "🔥", pixels: DS_HAIR_HERO },
  { name: "Curly", icon: "🌀", pixels: DS_HAIR_CURLY },
  { name: "Short", icon: "👨", pixels: DS_HAIR_MALE_SHORT },
  { name: "Ponytail", icon: "👧", pixels: DS_HAIR_PONYTAIL },
  { name: "Topknot", icon: "👴", pixels: DS_HAIR_TOPKNOT },
];

// ══════════════════════════════════════════════════════
// EYE STYLES — overlay parts (rows 12-14)
// ══════════════════════════════════════════════════════

export const EYE_STYLES: Array<{ name: string; icon: string; pixels: Pixel[] | null }> = [
  { name: "Default", icon: "👀", pixels: null }, // keep base
  { name: "Dot", icon: "•", pixels: DS_EYES_DOT_NARROW },
  { name: "Dot Up", icon: "•", pixels: DS_EYES_DOT_NARROW_UP },
  { name: "Dot Wide", icon: "••", pixels: DS_EYES_DOT_WIDE },
  { name: "Dot Wide Up", icon: "••", pixels: DS_EYES_DOT_WIDE_UP },
  { name: "Tall", icon: "▮", pixels: DS_EYES_TALL_NARROW },
  { name: "Tall Up", icon: "▮", pixels: DS_EYES_TALL_NARROW_UP },
  { name: "Tall Wide", icon: "▮▮", pixels: DS_EYES_TALL_WIDE },
  { name: "Tall Wide Up", icon: "▮▮", pixels: DS_EYES_TALL_WIDE_UP },
  { name: "White", icon: "👁", pixels: DS_EYES_WHITE_NARROW },
  { name: "White Up", icon: "👁", pixels: DS_EYES_WHITE_NARROW_UP },
  { name: "White Wide", icon: "👁👁", pixels: DS_EYES_WHITE_WIDE },
  { name: "White Wide Up", icon: "👁👁", pixels: DS_EYES_WHITE_WIDE_UP },
];

// ══════════════════════════════════════════════════════
// MOUTH STYLES — overlay parts (rows 17-18)
// ══════════════════════════════════════════════════════

export const MOUTH_STYLES: Array<{ name: string; icon: string; pixels: Pixel[] | null }> = [
  { name: "Default", icon: "😐", pixels: null }, // keep base
  { name: "Narrow", icon: "—", pixels: DS_MOUTH_NARROW },
  { name: "Narrow Down", icon: "—", pixels: DS_MOUTH_NARROW_DOWN },
  { name: "Wide", icon: "——", pixels: DS_MOUTH_WIDE },
  { name: "Wide Down", icon: "——", pixels: DS_MOUTH_WIDE_DOWN },
  { name: "Smile Open", icon: "😊", pixels: DS_SMILE_NARROW_OPEN },
  { name: "Smile Filled", icon: "😊", pixels: DS_SMILE_NARROW_FILLED },
  { name: "Big Smile", icon: "😃", pixels: DS_SMILE_WIDE_OPEN },
  { name: "Big Smile Filled", icon: "😃", pixels: DS_SMILE_WIDE_FILL },
];

// ══════════════════════════════════════════════════════
// FACE EXTRAS
// ══════════════════════════════════════════════════════

export const ACCESSORIES = [
  { name: "None", icon: "❌" },
  { name: "Crown", icon: "👑" },
  { name: "Halo", icon: "😇" },
  { name: "Beard", icon: "🧔" },
];

// ══════════════════════════════════════════════════════
// REGION DETECTION — rows for clearing when overlaying
// ══════════════════════════════════════════════════════

// Rows occupied by hair/head outline that get cleared when applying new hair
const HAIR_ROWS = [3, 4, 5, 6, 7, 8, 9, 10];
// Rows occupied by eye region
const EYE_ROWS = [12, 13, 14];
// Rows occupied by mouth region
const MOUTH_ROWS = [17, 18];

// ══════════════════════════════════════════════════════
// BUILDER STATE & COMPOSITE
// ══════════════════════════════════════════════════════

export interface BuilderState {
  templateIdx: number;
  skinIdx: number;
  hairColorIdx: number;
  topIdx: number;
  accentIdx: number;
  hasCape: boolean;
  capeColorIdx: number;
  hairStyleIdx: number;
  eyeIdx: number;
  mouthIdx: number;
  accessoryIdx: number;
}

export const DEFAULT_BUILDER_STATE: BuilderState = {
  templateIdx: 1, // Crofly
  skinIdx: 1,
  hairColorIdx: 2,
  topIdx: 3,
  accentIdx: 0,
  hasCape: true,
  capeColorIdx: 8,
  hairStyleIdx: 0,
  eyeIdx: 0,
  mouthIdx: 0,
  accessoryIdx: 0,
};

export function compositeCharacter(state: BuilderState): PixelMap {
  const template = BASE_TEMPLATES[state.templateIdx] || BASE_TEMPLATES[0];
  const skin = SKIN_TONES[state.skinIdx]?.color || "#FFCD94";
  const hair = HAIR_COLORS[state.hairColorIdx]?.color || "#8B4513";
  const top = OUTFIT_COLORS[state.topIdx]?.color || "#FFC42A";
  const accent = OUTFIT_COLORS[state.accentIdx]?.color || "#D50000";
  const cape = OUTFIT_COLORS[state.capeColorIdx]?.color || "#D50000";

  // 1. Build base color map for recoloring the template
  const colorMap: Record<string, string> = {
    [template.skinColor]: skin,
    [template.topColor]: top,
    [template.accentColor]: accent,
  };
  if (template.hairColor && !template.hasIntegratedHair) {
    colorMap[template.hairColor] = hair;
  }
  if (template.capeColor) {
    colorMap[template.capeColor] = state.hasCape ? cape : top;
  }

  // 2. Apply recolored template
  const d: PixelMap = new Map();
  template.pixels.forEach(([x, y, c]) => {
    const final = colorMap[c] || c;
    d.set(`${x},${y}`, final);
  });

  // 3. If template has cape but user wants no cape, also need to remove cape outline pixels
  // For simplicity: when hasCape=false on a cape template, recolor cape pixels to top color (done above)
  // The cape outline pixels (black) stay since they're shared with the body

  // 4. Apply hair overlay (replaces hair region)
  const hairStyle = HAIR_STYLES[state.hairStyleIdx];
  if (hairStyle && hairStyle.pixels) {
    // Clear existing hair area first (keep skin/face features below row 11)
    HAIR_ROWS.forEach((y) => {
      for (let x = 0; x < 32; x++) {
        d.delete(`${x},${y}`);
      }
    });
    // Re-apply skin pixels in hair region (forehead area) before drawing new hair
    template.pixels.forEach(([x, y, c]) => {
      if (HAIR_ROWS.includes(y) && c === template.skinColor) {
        d.set(`${x},${y}`, skin);
      }
    });
    // Apply new hair, recoloring black/dark to the hair color
    hairStyle.pixels.forEach(([x, y, c]) => {
      // Hair files use black for the hair color — recolor to user's chosen hair color
      const final = c === BLK ? hair : c;
      d.set(`${x},${y}`, final);
    });
  }

  // 5. Apply eye overlay (replaces eye region)
  const eyeStyle = EYE_STYLES[state.eyeIdx];
  if (eyeStyle && eyeStyle.pixels) {
    // Clear current eye pixels (keep skin)
    EYE_ROWS.forEach((y) => {
      for (let x = 12; x <= 21; x++) {
        const key = `${x},${y}`;
        const cur = d.get(key);
        // Only clear non-skin pixels in face region
        if (cur === BLK || cur === "#FFFFFF") d.set(key, skin);
      }
    });
    eyeStyle.pixels.forEach(([x, y, c]) => d.set(`${x},${y}`, c));
  }

  // 6. Apply mouth overlay
  const mouthStyle = MOUTH_STYLES[state.mouthIdx];
  if (mouthStyle && mouthStyle.pixels) {
    MOUTH_ROWS.forEach((y) => {
      for (let x = 12; x <= 21; x++) {
        const key = `${x},${y}`;
        const cur = d.get(key);
        if (cur === BLK) d.set(key, skin);
      }
    });
    mouthStyle.pixels.forEach(([x, y, c]) => d.set(`${x},${y}`, c));
  }

  // 7. Accessories
  if (state.accessoryIdx === 1) {
    // Crown
    const gold = "#FFC42A";
    [[13,4],[15,4],[17,4],[19,4]].forEach(([x, y]) => d.set(`${x},${y}`, gold));
    for (let x = 13; x <= 19; x++) d.set(`${x},5`, gold);
  } else if (state.accessoryIdx === 2) {
    // Halo
    const gold = "#FFC42A";
    for (let x = 13; x <= 19; x++) d.set(`${x},3`, gold);
    d.set("12,4", gold); d.set("20,4", gold);
  } else if (state.accessoryIdx === 3) {
    // Beard
    DS_FACE_BEARD.forEach(([x, y, c]) => d.set(`${x},${y}`, c));
  }

  return d;
}

// ══════════════════════════════════════════════════════
// ANALYZE — extract builder state from existing pixel data
// (for "Edit in Builder" from pre-made or free-draw)
// ══════════════════════════════════════════════════════

function findClosestColorIdx(hex: string, palette: Array<{ color: string }>): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let best = 0, bestDist = Infinity;
  palette.forEach((p, i) => {
    const pr = parseInt(p.color.slice(1, 3), 16);
    const pg = parseInt(p.color.slice(3, 5), 16);
    const pb = parseInt(p.color.slice(5, 7), 16);
    const dist = Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}

export function analyzePixelData(data: PixelMap): BuilderState {
  // Try to determine which template by color sampling
  const skinSample = data.get("15,15") || data.get("14,14") || "#FFCD94";
  const topSample = data.get("16,20") || data.get("15,21") || "#FFC42A";
  const accentSample = data.get("16,22") || data.get("14,25") || "#D50000";
  const leftSample = data.get("9,22") || data.get("8,23") || "";
  const hairSample = data.get("13,7") || data.get("14,8") || BLK;

  const skinIdx = findClosestColorIdx(skinSample, SKIN_TONES);
  const topIdx = findClosestColorIdx(topSample, OUTFIT_COLORS);
  const accentIdx = findClosestColorIdx(accentSample, OUTFIT_COLORS);
  const hairColorIdx = hairSample === BLK ? 0 : findClosestColorIdx(hairSample, HAIR_COLORS);
  const hasCape = !!leftSample && leftSample !== BLK && findClosestColorIdx(leftSample, OUTFIT_COLORS) !== topIdx;
  const capeColorIdx = hasCape ? findClosestColorIdx(leftSample, OUTFIT_COLORS) : 0;

  return {
    templateIdx: 1, // default to Crofly
    skinIdx,
    hairColorIdx,
    topIdx,
    accentIdx,
    hasCape,
    capeColorIdx,
    hairStyleIdx: 0,
    eyeIdx: 0,
    mouthIdx: 0,
    accessoryIdx: 0,
  };
}

// ══════════════════════════════════════════════════════
// EXPORTS for legacy compatibility
// ══════════════════════════════════════════════════════

export const TEMPLATE_STYLES = BASE_TEMPLATES.map((t) => ({ name: t.name, icon: "👤" }));
export const CAPE_OPTIONS = [
  { name: "Cape", icon: "🦸" },
  { name: "No Cape", icon: "❌" },
];
