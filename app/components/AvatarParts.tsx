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

export const EYE_COLORS = [
  { name: "Black", color: "#1A1A2E" },
  { name: "Brown", color: "#4C2D17" },
  { name: "Hazel", color: "#8B6914" },
  { name: "Green", color: "#2E7D32" },
  { name: "Blue", color: "#1976D2" },
  { name: "Grey", color: "#607D8B" },
  { name: "Violet", color: "#7B1FA2" },
];

// ══════════════════════════════════════════════════════
// COLOR ROLE SYSTEM
// Each template maps its source colors to semantic roles.
// At composite time, roles are filled from user choices + derived shadows.
// ══════════════════════════════════════════════════════

type ColorRole =
  | "skin" | "skinShadow"
  | "hair" | "hairShadow"
  | "top" | "topShadow"
  | "cape" | "capeShadow" | "capeHighlight"
  | "accent" | "accent2"
  | "bottom"
  | "eye" | "eyeWhite"
  | "outline"        // black outline — never recolor
  | "literal";       // keep exact color (e.g. arc reactor white)

export interface BaseTemplate {
  name: string;
  pixels: Pixel[];
  // Map each source color in the template to its semantic role
  colorRoles: Record<string, ColorRole>;
  // Whether the template has integrated hair (in the BLACK outline) — affects hair swap
  hasIntegratedHair: boolean;
  // Whether the template ships with a cape
  hasCape: boolean;
  // Color indices that reproduce the template's original look exactly
  naturalState: Partial<BuilderState>;
}

// ══════════════════════════════════════════════════════
// CAPE DEFINITION — extracted from Hero's cape shape.
// Used for both ADDING cape to non-cape templates AND REMOVING cape from
// templates that ship with one (Hero, Crofly).
// ══════════════════════════════════════════════════════

type CapeRole = "outline" | "fill" | "shadow";
const CAPE_PIXELS: Array<[number, number, CapeRole]> = [
  // Top attachment (above where cape meets shoulder)
  [9, 19, "outline"], [10, 19, "outline"], [11, 19, "fill"],
  // Cape body — flowing left sweep
  [8, 20, "outline"], [9, 20, "shadow"],   [10, 20, "fill"],
  [7, 21, "outline"], [8, 21, "shadow"],   [9, 21, "fill"],
  [6, 22, "outline"], [7, 22, "outline"],  [8, 22, "fill"],   [9, 22, "fill"],
  [6, 23, "outline"], [7, 23, "fill"],     [8, 23, "fill"],   [9, 23, "fill"],
  [5, 24, "outline"], [6, 24, "fill"],     [7, 24, "fill"],   [8, 24, "fill"],   [9, 24, "shadow"],
  [5, 25, "outline"], [6, 25, "fill"],     [7, 25, "fill"],   [8, 25, "shadow"], [9, 25, "shadow"], [10, 25, "outline"],
  [4, 26, "outline"], [5, 26, "fill"],     [6, 26, "fill"],   [7, 26, "shadow"], [8, 26, "shadow"], [9, 26, "shadow"], [10, 26, "shadow"],
  // Bottom edge
  [4, 27, "outline"], [5, 27, "outline"], [6, 27, "outline"], [7, 27, "outline"], [8, 27, "outline"], [9, 27, "outline"], [10, 27, "outline"],
];

// All pixel coords occupied by the cape — used to DELETE cape pixels when a
// cape-bearing template (Hero, Crofly) is rendered with hasCape: false.
const CAPE_COORD_SET = new Set(CAPE_PIXELS.map(([x, y]) => `${x},${y}`));

// ══════════════════════════════════════════════════════
// BASE TEMPLATES — full v1 character starting points
// ══════════════════════════════════════════════════════

export const BASE_TEMPLATES: BaseTemplate[] = [
  {
    name: "Hero",
    pixels: DS_HERO_V1,
    hasIntegratedHair: true, // hair is part of the BLACK outline
    hasCape: true,
    colorRoles: {
      "#000000": "outline",
      "#FFCD94": "skin",
      "#F1C27D": "skinShadow",
      "#2979FF": "top",
      "#D50000": "cape",
      "#850000": "capeShadow",
      "#FFC42A": "accent",
    },
    // Light skin, blue suit, red cape, yellow accent
    naturalState: { skinIdx: 1, topIdx: 8, accentIdx: 3, capeColorIdx: 0, hasCape: true },
  },
  {
    name: "Crofly",
    pixels: DS_CROFLY_V1,
    hasIntegratedHair: false,
    hasCape: true,
    colorRoles: {
      "#000000": "outline",
      "#FFCD94": "skin",
      "#8D5524": "hair",
      "#FFC42A": "top",
      "#448AFF": "cape",
      "#2962FF": "capeShadow",
      "#2196F3": "capeHighlight",
      "#D50000": "accent",
    },
    // Brown hair, yellow top, blue cape, red accent
    naturalState: { skinIdx: 1, hairColorIdx: 2, topIdx: 3, accentIdx: 0, capeColorIdx: 8, hasCape: true },
  },
  {
    name: "Zebos",
    pixels: DS_ZEBOS_V1,
    hasIntegratedHair: false,
    hasCape: false,
    colorRoles: {
      "#000000": "outline",
      "#FFE0BD": "skin",
      "#4C2D17": "eye",
      "#FFFFFF": "top",
      "#8D5524": "accent", // belt
      "#607D8B": "bottom", // pants
    },
    // Porcelain skin, white top, brown belt, dark grey pants, brown eyes
    naturalState: { skinIdx: 0, topIdx: 16, accentIdx: 14, bottomIdx: 18, eyeColorIdx: 1, hasCape: false },
  },
  {
    name: "Guru",
    pixels: DS_GURU_V1,
    hasIntegratedHair: false,
    hasCape: false,
    colorRoles: {
      "#000000": "outline",
      "#FFC587": "skin",
      "#FFE0BD": "skinShadow",
      "#850000": "top",
      "#FFFFFF": "accent",  // white robe details
      "#795548": "hair",    // beard/sideburns
      "#546E7A": "bottom",  // shoes
    },
    // Light skin, brown beard, dark red robe, white details, dark grey shoes
    naturalState: { skinIdx: 1, hairColorIdx: 2, topIdx: 1, accentIdx: 16, bottomIdx: 18, hasCape: false },
  },
  {
    name: "Iron",
    pixels: DS_IRON_V1,
    hasIntegratedHair: true, // mask is integrated, treat as fixed shape
    hasCape: false,
    colorRoles: {
      "#000000": "outline",
      "#FFC42A": "literal", // gold mask — preserve iconic gold
      "#850000": "top",     // red body
      "#BDBDBD": "literal", // arc reactor metals
      "#E0E0E0": "literal",
      "#FFFFFF": "accent",  // arc reactor highlight
    },
    // Dark red body, white arc reactor
    naturalState: { topIdx: 1, accentIdx: 16, hasCape: false },
  },
  {
    name: "Hipster",
    pixels: DS_MALE_HIPSTER_V1,
    hasIntegratedHair: false,
    hasCape: false,
    colorRoles: {
      "#000000": "outline",
      "#FFCD94": "skin",
      "#EAC086": "skinShadow",
      "#8D5524": "hair",       // beard + top-of-head hair
      "#03A9F4": "top",         // primary blue
      "#039BE5": "topShadow",
      "#2196F3": "topShadow",
      "#6B7EDB": "topShadow",
      "#F44336": "accent",
      "#FF3D00": "accent",
      "#263238": "literal",     // belt
      "#607D8B": "bottom",      // pants
      "#391E0B": "literal",     // shoes
    },
    // Light skin, brown beard, cyan/blue shirt, red accent, dark grey pants
    naturalState: { skinIdx: 1, hairColorIdx: 2, topIdx: 7, accentIdx: 0, bottomIdx: 18, hasCape: false },
  },
  {
    name: "MW",
    pixels: DS_MW_V1,
    hasIntegratedHair: true, // mouse fur extends into outline area
    hasCape: false,
    colorRoles: {
      "#000000": "outline",
      "#613D24": "skin",    // mouse fur — recolor as skin
      "#FFFFFF": "literal", // eye whites
      "#212121": "top",
      "#9E9E9E": "accent",
      "#FFC42A": "literal", // iconic yellow eyes — preserve
      "#544C0D": "bottom",
    },
    // Dark brown fur, black top, grey accent, brown bottom
    naturalState: { skinIdx: 7, topIdx: 19, accentIdx: 17, bottomIdx: 14, hasCape: false },
  },
];

// ══════════════════════════════════════════════════════
// HAIR / EYE / MOUTH STYLES
// ══════════════════════════════════════════════════════

export const HAIR_STYLES: Array<{ name: string; icon: string; pixels: Pixel[] | null }> = [
  { name: "Default", icon: "👤", pixels: null },
  { name: "Bald", icon: "🥚", pixels: DS_HAIR_BALD },
  { name: "Hero Hair", icon: "🔥", pixels: DS_HAIR_HERO },
  { name: "Curly", icon: "🌀", pixels: DS_HAIR_CURLY },
  { name: "Short", icon: "✂️", pixels: DS_HAIR_MALE_SHORT },
  { name: "Ponytail", icon: "👧", pixels: DS_HAIR_PONYTAIL },
  { name: "Topknot", icon: "👴", pixels: DS_HAIR_TOPKNOT },
];

export const EYE_STYLES: Array<{ name: string; icon: string; pixels: Pixel[] | null }> = [
  { name: "Default", icon: "👀", pixels: null },
  { name: "Dot", icon: "·", pixels: DS_EYES_DOT_NARROW },
  { name: "Dot Up", icon: "·", pixels: DS_EYES_DOT_NARROW_UP },
  { name: "Dot Wide", icon: "··", pixels: DS_EYES_DOT_WIDE },
  { name: "Dot Wide Up", icon: "··", pixels: DS_EYES_DOT_WIDE_UP },
  { name: "Tall", icon: "▮", pixels: DS_EYES_TALL_NARROW },
  { name: "Tall Up", icon: "▮", pixels: DS_EYES_TALL_NARROW_UP },
  { name: "Tall Wide", icon: "▮▮", pixels: DS_EYES_TALL_WIDE },
  { name: "Tall Wide Up", icon: "▮▮", pixels: DS_EYES_TALL_WIDE_UP },
  { name: "White", icon: "👁", pixels: DS_EYES_WHITE_NARROW },
  { name: "White Up", icon: "👁", pixels: DS_EYES_WHITE_NARROW_UP },
  { name: "White Wide", icon: "👁👁", pixels: DS_EYES_WHITE_WIDE },
  { name: "White Wide Up", icon: "👁👁", pixels: DS_EYES_WHITE_WIDE_UP },
];

export const MOUTH_STYLES: Array<{ name: string; icon: string; pixels: Pixel[] | null }> = [
  { name: "Default", icon: "😐", pixels: null },
  { name: "Narrow", icon: "—", pixels: DS_MOUTH_NARROW },
  { name: "Narrow Down", icon: "—", pixels: DS_MOUTH_NARROW_DOWN },
  { name: "Wide", icon: "——", pixels: DS_MOUTH_WIDE },
  { name: "Wide Down", icon: "——", pixels: DS_MOUTH_WIDE_DOWN },
  { name: "Smile Open", icon: "🙂", pixels: DS_SMILE_NARROW_OPEN },
  { name: "Smile Filled", icon: "😊", pixels: DS_SMILE_NARROW_FILLED },
  { name: "Big Smile", icon: "😃", pixels: DS_SMILE_WIDE_OPEN },
  { name: "Big Smile Filled", icon: "😄", pixels: DS_SMILE_WIDE_FILL },
];

export const ACCESSORIES = [
  { name: "None", icon: "❌" },
  { name: "Crown", icon: "👑" },
  { name: "Halo", icon: "😇" },
  { name: "Beard", icon: "🧔" },
];

export const CAPE_OPTIONS = [
  { name: "Cape", icon: "🦸" },
  { name: "No Cape", icon: "❌" },
];

export const TEMPLATE_STYLES = BASE_TEMPLATES.map((t) => ({ name: t.name, icon: "👤" }));

// Region rows used when overlaying hair/eyes/mouth
const HAIR_ROWS = [3, 4, 5, 6, 7, 8, 9, 10];
const EYE_ROWS = [12, 13, 14];
const MOUTH_ROWS = [17, 18];

// ══════════════════════════════════════════════════════
// BUILDER STATE
// ══════════════════════════════════════════════════════

export interface BuilderState {
  templateIdx: number;
  skinIdx: number;
  hairColorIdx: number;
  topIdx: number;
  accentIdx: number;
  bottomIdx: number;
  eyeColorIdx: number;
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
  bottomIdx: 18,
  eyeColorIdx: 0,
  hasCape: false, // off by default — pre-mades opt in via hasCape: true
  capeColorIdx: 8,
  hairStyleIdx: 0,
  eyeIdx: 0,
  mouthIdx: 0,
  accessoryIdx: 0,
};

// ══════════════════════════════════════════════════════
// COMPOSITE — build the full character pixel map
// ══════════════════════════════════════════════════════

export function compositeCharacter(state: BuilderState): PixelMap {
  const template = BASE_TEMPLATES[state.templateIdx] || BASE_TEMPLATES[0];
  const skin = SKIN_TONES[state.skinIdx]?.color || "#FFCD94";
  const hair = HAIR_COLORS[state.hairColorIdx]?.color || "#8B4513";
  const top = OUTFIT_COLORS[state.topIdx]?.color || "#FFC42A";
  const accent = OUTFIT_COLORS[state.accentIdx]?.color || "#D50000";
  const bottom = OUTFIT_COLORS[state.bottomIdx]?.color || "#94A3B8";
  const cape = OUTFIT_COLORS[state.capeColorIdx]?.color || "#D50000";
  const eye = EYE_COLORS[state.eyeColorIdx]?.color || "#1A1A2E";

  // Build role → color resolver
  const roleColor = (role: ColorRole, sourceColor: string): string => {
    switch (role) {
      case "outline": return BLK;
      case "skin": return skin;
      case "skinShadow": return darken(skin, 25);
      case "hair": return hair;
      case "hairShadow": return darken(hair, 25);
      case "top":
        // If template has cape but user disabled it, fill cape area with top
        return top;
      case "topShadow": return darken(top, 25);
      case "cape": return state.hasCape ? cape : top;
      case "capeShadow": return state.hasCape ? darken(cape, 40) : darken(top, 25);
      case "capeHighlight": return state.hasCape ? lighten(cape, 15) : lighten(top, 10);
      case "accent": return accent;
      case "accent2": return accent;
      case "bottom": return bottom;
      case "eye": return eye;
      case "eyeWhite": return "#FFFFFF";
      case "literal": return sourceColor;
      default: return sourceColor;
    }
  };

  // 1. Apply recolored template — skip cape silhouette pixels when removing cape
  const d: PixelMap = new Map();
  const removeCape = template.hasCape && !state.hasCape;
  template.pixels.forEach(([x, y, c]) => {
    if (removeCape && CAPE_COORD_SET.has(`${x},${y}`)) return;
    const role = template.colorRoles[c];
    if (role) {
      d.set(`${x},${y}`, roleColor(role, c));
    } else {
      d.set(`${x},${y}`, c);
    }
  });

  // 2. Add cape overlay if user wants cape on a non-cape template
  if (state.hasCape && !template.hasCape) {
    const capeShadow = darken(cape, 40);
    CAPE_PIXELS.forEach(([x, y, role]) => {
      const color = role === "outline" ? BLK : role === "shadow" ? capeShadow : cape;
      d.set(`${x},${y}`, color);
    });
  }

  // 3. Apply hair overlay
  const hairStyle = HAIR_STYLES[state.hairStyleIdx];
  if (hairStyle && hairStyle.pixels) {
    if (template.hasIntegratedHair) {
      // Don't fully clear — that would break the head. Just add hair on top.
      // But first, if "Bald" was chosen, we should keep the head outline from the template.
      // We can't really swap hair on integrated-hair templates cleanly, so just overlay hair pixels.
      hairStyle.pixels.forEach(([x, y, c]) => {
        d.set(`${x},${y}`, c === BLK ? hair : c);
      });
    } else {
      // Clear hair area first (rows 3-10), preserve the head outline (BLACK that's not skin)
      // Then re-add the head outline pixels from the original template
      const originalHairRows: PixelMap = new Map();
      template.pixels.forEach(([x, y, c]) => {
        if (HAIR_ROWS.includes(y)) {
          originalHairRows.set(`${x},${y}`, c);
        }
      });
      // Clear those rows in result
      HAIR_ROWS.forEach((y) => {
        for (let x = 0; x < 32; x++) d.delete(`${x},${y}`);
      });
      // Re-add only outline + skin pixels (no original hair)
      originalHairRows.forEach((c, key) => {
        const role = template.colorRoles[c];
        if (role === "outline" || role === "skin" || role === "skinShadow") {
          d.set(key, roleColor(role, c));
        }
      });
      // Apply new hair, recoloring black to user's hair color
      hairStyle.pixels.forEach(([x, y, c]) => {
        d.set(`${x},${y}`, c === BLK ? hair : c);
      });
    }
  }

  // 4. Apply eye overlay (replaces eye region)
  const eyeStyle = EYE_STYLES[state.eyeIdx];
  if (eyeStyle && eyeStyle.pixels) {
    // Clear current eye pixels (keep skin), revert to skin in eye area
    EYE_ROWS.forEach((y) => {
      for (let x = 12; x <= 21; x++) {
        const key = `${x},${y}`;
        const cur = d.get(key);
        // Only clear if it's a face feature color, not a structural element
        const role = template.colorRoles[cur || ""];
        if (role === "eye" || role === "eyeWhite" || cur === BLK || cur === "#FFFFFF") {
          d.set(key, skin);
        }
      }
    });
    // Apply new eye pixels — black recolors to chosen eye color, white stays white
    eyeStyle.pixels.forEach(([x, y, c]) => {
      d.set(`${x},${y}`, c === BLK ? eye : c);
    });
  }

  // 5. Apply mouth overlay
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

  // 6. Accessories
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
    // Beard — recolor to user's hair color
    DS_FACE_BEARD.forEach(([x, y]) => d.set(`${x},${y}`, hair));
  }

  return d;
}

// ══════════════════════════════════════════════════════
// ANALYZE PIXEL DATA — detect template + colors from existing character
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

// Compare data against each template's pixels — count matches on outline pixels
function detectTemplate(data: PixelMap): number {
  let bestIdx = 0, bestScore = -1;
  BASE_TEMPLATES.forEach((template, idx) => {
    let score = 0;
    template.pixels.forEach(([x, y, c]) => {
      const role = template.colorRoles[c];
      if (role !== "outline") return;
      // Check if outline pixel matches in the data
      if (data.get(`${x},${y}`) === BLK) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

export function analyzePixelData(data: PixelMap): BuilderState {
  const templateIdx = detectTemplate(data);
  const template = BASE_TEMPLATES[templateIdx];

  // For each role in the template, find a sample pixel and match closest color
  const roleSamples: Partial<Record<ColorRole, string>> = {};
  for (const [srcColor, role] of Object.entries(template.colorRoles)) {
    if (role === "outline" || role === "literal") continue;
    // Find first pixel with this source color in the template — sample data at that position
    const samplePixel = template.pixels.find(([, , c]) => c === srcColor);
    if (samplePixel) {
      const [x, y] = samplePixel;
      const sampledColor = data.get(`${x},${y}`);
      if (sampledColor) roleSamples[role] = sampledColor;
    }
  }

  const skinIdx = roleSamples.skin ? findClosestColorIdx(roleSamples.skin, SKIN_TONES) : 1;
  const hairColorIdx = roleSamples.hair ? findClosestColorIdx(roleSamples.hair, HAIR_COLORS) : 2;
  const topIdx = roleSamples.top ? findClosestColorIdx(roleSamples.top, OUTFIT_COLORS) : 3;
  const accentIdx = roleSamples.accent ? findClosestColorIdx(roleSamples.accent, OUTFIT_COLORS) : 0;
  const bottomIdx = roleSamples.bottom ? findClosestColorIdx(roleSamples.bottom, OUTFIT_COLORS) : 18;
  const eyeColorIdx = roleSamples.eye ? findClosestColorIdx(roleSamples.eye, EYE_COLORS) : 0;
  const hasCape = template.hasCape || (roleSamples.cape !== undefined && roleSamples.cape !== roleSamples.top);
  const capeColorIdx = roleSamples.cape ? findClosestColorIdx(roleSamples.cape, OUTFIT_COLORS) : 0;

  return {
    templateIdx,
    skinIdx,
    hairColorIdx,
    topIdx,
    accentIdx,
    bottomIdx,
    eyeColorIdx,
    hasCape,
    capeColorIdx,
    hairStyleIdx: 0,
    eyeIdx: 0,
    mouthIdx: 0,
    accessoryIdx: 0,
  };
}
