// Avatar builder — dual template system (Hero + Crofly)
// Both share the same body (rows 19-29) but different heads (rows 5-18)

type PixelMap = Map<string, string>;
type Coord = [number, number];

const BLK = "#000000";

// ══════════════════════════════════════════════════════
// SHARED BODY REGIONS (identical between Hero and Crofly)
// ══════════════════════════════════════════════════════

// Body outline shared (right side + center + legs)
const BODY_OUTLINE_SHARED: Coord[] = [[13,19],[14,19],[15,19],[16,19],[17,19],[18,19],[19,19],[20,19],[12,20],[13,20],[20,20],[21,20],[22,21],[20,22],[22,22],[13,23],[20,23],[22,23],[13,24],[20,24],[22,24],[12,25],[13,25],[16,25],[17,25],[20,25],[21,25],[22,25],[12,26],[13,26],[20,26],[13,27],[20,27],[13,28],[16,28],[17,28],[20,28],[13,29],[14,29],[15,29],[18,29],[19,29],[20,29]];
// Cape-shape outline (left side sweep)
const BODY_OUTLINE_CAPE: Coord[] = [[10,19],[11,19],[9,20],[8,21],[11,21],[7,22],[8,22],[11,22],[7,23],[11,23],[6,24],[11,24],[6,25],[11,25],[5,26],[5,27],[6,27],[7,27],[8,27],[9,27],[10,27],[11,27]];
// No-cape arm outline (symmetric straight arm on left)
const BODY_OUTLINE_ARM: Coord[] = [[10,19],[11,19],[10,20],[11,20],[9,21],[11,21],[9,22],[11,22],[9,23],[11,23],[9,24],[11,24],[9,25],[10,25],[11,25],[11,26],[11,27]];

// Cape fill regions
const BODY_LEFT_CAPE: Coord[] = [[14,20],[15,20],[18,20],[19,20],[10,21],[12,21],[13,21],[20,21],[21,21],[9,22],[10,22],[8,23],[9,23],[10,23],[7,24],[8,24],[9,24],[7,25],[8,25],[6,26],[7,26],[16,27],[17,27],[14,28],[15,28],[18,28],[19,28]];
const BODY_LEFT_CAPE_SHADOW: Coord[] = [[10,20],[9,21],[10,24],[9,25],[10,25],[8,26],[9,26],[10,26],[11,26]];
const BODY_LEFT_CAPE_HIGHLIGHT: Coord[] = [[12,19],[11,20]];
// No-cape arm fill (inside the straight arm outline)
const BODY_LEFT_ARM_FILL: Coord[] = [[10,21],[10,22],[10,23],[10,24]];

const BODY_TOP: Coord[] = [[16,20],[17,20],[14,21],[15,21],[16,21],[17,21],[18,21],[19,21],[12,22],[13,22],[14,22],[15,22],[17,22],[18,22],[19,22],[21,22],[12,23],[14,23],[15,23],[16,23],[18,23],[19,23],[21,23],[14,24],[15,24],[16,24],[17,24],[18,24],[19,24],[14,26],[15,26],[16,26],[17,26],[18,26],[19,26],[14,27],[15,27],[18,27],[19,27]];
const BODY_ACCENT: Coord[] = [[16,22],[17,23],[14,25],[15,25],[18,25],[19,25]];
const BODY_SKIN: Coord[] = [[12,24],[21,24]];

// ══════════════════════════════════════════════════════
// HERO HEAD TEMPLATE (rows 5-18)
// Hair is part of the outline (dark hair = black pixels)
// ══════════════════════════════════════════════════════

const HERO_HEAD_OUTLINE: Coord[] = [[17,5],[18,5],[19,5],[15,6],[16,6],[17,6],[18,6],[19,6],[20,6],[13,7],[14,7],[15,7],[16,7],[17,7],[18,7],[19,7],[20,7],[21,7],[12,8],[13,8],[14,8],[15,8],[16,8],[17,8],[18,8],[19,8],[20,8],[21,8],[11,9],[12,9],[13,9],[14,9],[15,9],[16,9],[17,9],[18,9],[19,9],[20,9],[21,9],[22,9],[11,10],[12,10],[13,10],[15,10],[16,10],[17,10],[18,10],[19,10],[20,10],[21,10],[22,10],[11,11],[18,11],[22,11],[11,12],[22,12],[11,13],[22,13],[10,14],[15,14],[19,14],[22,14],[10,15],[22,15],[11,16],[16,16],[17,16],[18,16],[22,16],[11,17],[22,17],[12,18],[21,18]];
const HERO_SKIN: Coord[] = [[14,10],[12,11],[13,11],[14,11],[15,11],[16,11],[17,11],[19,11],[20,11],[21,11],[12,12],[13,12],[14,12],[15,12],[16,12],[17,12],[18,12],[19,12],[20,12],[21,12],[12,13],[13,13],[14,13],[15,13],[16,13],[17,13],[18,13],[19,13],[20,13],[21,13],[11,14],[12,14],[13,14],[14,14],[16,14],[17,14],[18,14],[20,14],[21,14],[11,15],[12,15],[13,15],[14,15],[15,15],[16,15],[17,15],[18,15],[19,15],[20,15],[21,15],[12,16],[13,16],[14,16],[15,16],[19,16],[20,16],[21,16],[12,17],[13,17],[14,17],[15,17],[16,17],[17,17],[18,17],[19,17],[20,17],[21,17],[13,18],[14,18],[15,18],[16,18],[17,18],[18,18],[19,18]];
// Hero's eyes are at different positions than Crofly's
const HERO_EYES: Coord[] = [[15,14],[19,14]]; // single pixel eyes
const HERO_MOUTH: Coord[] = [[16,16],[17,16],[18,16]]; // 3-pixel mouth

// ══════════════════════════════════════════════════════
// CROFLY HEAD TEMPLATE (rows 5-18)
// Hair is colored separately (brown), with top-left puff
// ══════════════════════════════════════════════════════

const CROFLY_HEAD_OUTLINE: Coord[] = [[7,5],[8,5],[9,5],[10,5],[6,6],[11,6],[13,6],[14,6],[15,6],[16,6],[17,6],[18,6],[6,7],[8,7],[9,7],[12,7],[19,7],[20,7],[6,8],[7,8],[9,8],[10,8],[11,8],[21,8],[11,9],[22,9],[10,10],[22,10],[10,11],[22,11],[10,12],[22,12],[10,13],[16,13],[19,13],[22,13],[10,14],[16,14],[19,14],[22,14],[10,15],[22,15],[11,16],[22,16],[11,17],[16,17],[17,17],[22,17],[12,18],[21,18]];
const CROFLY_HAIR: Coord[] = [[7,6],[8,6],[9,6],[10,6],[7,7],[10,7],[11,7],[13,7],[14,7],[15,7],[16,7],[17,7],[18,7],[12,8],[13,8],[14,8],[15,8],[16,8],[17,8],[18,8],[19,8],[20,8],[12,9],[13,9],[14,9],[15,9],[16,9],[17,9],[18,9],[19,9],[20,9],[21,9],[11,10],[12,10],[13,10],[14,10],[16,10],[17,10],[18,10],[21,10],[11,11],[11,12],[11,13],[11,14],[11,15]];
const CROFLY_SKIN: Coord[] = [[15,10],[19,10],[20,10],[12,11],[13,11],[14,11],[15,11],[16,11],[17,11],[18,11],[19,11],[20,11],[21,11],[12,12],[13,12],[14,12],[15,12],[16,12],[17,12],[18,12],[19,12],[20,12],[21,12],[12,13],[13,13],[14,13],[15,13],[17,13],[18,13],[20,13],[21,13],[12,14],[13,14],[14,14],[15,14],[17,14],[18,14],[20,14],[21,14],[12,15],[13,15],[14,15],[15,15],[16,15],[17,15],[18,15],[19,15],[20,15],[21,15],[12,16],[13,16],[14,16],[15,16],[16,16],[17,16],[18,16],[19,16],[20,16],[21,16],[12,17],[13,17],[14,17],[15,17],[18,17],[19,17],[20,17],[21,17],[13,18],[14,18],[15,18],[16,18],[17,18],[18,18],[19,18],[20,18]];
const CROFLY_EYES: Coord[] = [[16,13],[19,13],[16,14],[19,14]]; // 2x1 pixel eyes
const CROFLY_MOUTH: Coord[] = [[16,17],[17,17]]; // 2-pixel mouth

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
// TEMPLATE STYLES
// ══════════════════════════════════════════════════════

export const TEMPLATE_STYLES = [
  { name: "Hero", icon: "\uD83E\uDDB8" },
  { name: "Crofly", icon: "\uD83D\uDC64" },
];

export const CAPE_OPTIONS = [
  { name: "Cape", icon: "\uD83E\uDDB8" },
  { name: "No Cape", icon: "\u274C" },
];

// ══════════════════════════════════════════════════════
// EYE OVERRIDES (optional overlay on top of template eyes)
// ══════════════════════════════════════════════════════

export const EYE_STYLES = [
  { name: "Default", icon: "\uD83D\uDC40" },
  { name: "Wide", icon: "\uD83D\uDE33" },
  { name: "Shades", icon: "\uD83D\uDE0E" },
];

export const MOUTH_STYLES = [
  { name: "Default", icon: "\uD83D\uDE10" },
  { name: "Smile", icon: "\uD83D\uDE0A" },
  { name: "Open", icon: "\uD83D\uDE2E" },
];

export const ACCESSORIES = [
  { name: "None", icon: "\u274C" },
  { name: "Crown", icon: "\uD83D\uDC51" },
  { name: "Halo", icon: "\uD83D\uDE07" },
];

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
// COMPOSITE — builds full character from builder options
// ══════════════════════════════════════════════════════

export interface BuilderState {
  templateIdx: number;  // 0=Hero, 1=Crofly
  skinIdx: number;
  hairIdx: number;
  topIdx: number;
  accentIdx: number;
  hasCape: boolean;
  capeColorIdx: number;
  eyeIdx: number;
  mouthIdx: number;
  accessoryIdx: number;
}

export const DEFAULT_BUILDER_STATE: BuilderState = {
  templateIdx: 1, // Crofly default
  skinIdx: 1,
  hairIdx: 2,
  topIdx: 3,
  accentIdx: 0,
  hasCape: true,
  capeColorIdx: 0,
  eyeIdx: 0,
  mouthIdx: 0,
  accessoryIdx: 0,
};

export function compositeCharacter(state: BuilderState): PixelMap {
  const d: PixelMap = new Map();
  const skin = SKIN_TONES[state.skinIdx]?.color || "#FFCD94";
  const hair = HAIR_COLORS[state.hairIdx]?.color || "#8B4513";
  const top = OUTFIT_COLORS[state.topIdx]?.color || "#FFC42A";
  const accent = OUTFIT_COLORS[state.accentIdx]?.color || "#D50000";
  const isHero = state.templateIdx === 0;

  // 1. Head — depends on template
  if (isHero) {
    // Hero head: outline includes hair
    HERO_HEAD_OUTLINE.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
    HERO_SKIN.forEach(([x, y]) => d.set(`${x},${y}`, skin));
    // Hero eyes
    HERO_EYES.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
    // Hero mouth
    HERO_MOUTH.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
  } else {
    // Crofly head: colored hair + outline
    CROFLY_HEAD_OUTLINE.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
    CROFLY_HAIR.forEach(([x, y]) => d.set(`${x},${y}`, hair));
    CROFLY_SKIN.forEach(([x, y]) => d.set(`${x},${y}`, skin));
    // Crofly eyes
    CROFLY_EYES.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
    // Crofly mouth
    CROFLY_MOUTH.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
  }

  // 2. Eye style override
  if (state.eyeIdx === 1) {
    // Wide — add extra eye pixels
    const eyeBase = isHero ? HERO_EYES : CROFLY_EYES;
    eyeBase.forEach(([x, y]) => { d.set(`${x},${y}`, BLK); d.set(`${x},${y - 1}`, BLK); });
  } else if (state.eyeIdx === 2) {
    // Shades
    const baseY = isHero ? 13 : 12;
    for (let x = 14; x <= 20; x++) { d.set(`${x},${baseY}`, BLK); d.set(`${x},${baseY + 1}`, BLK); }
  }

  // 3. Mouth style override
  const mouthPixels = isHero ? HERO_MOUTH : CROFLY_MOUTH;
  if (state.mouthIdx === 1) {
    // Smile — wider
    mouthPixels.forEach(([x, y]) => d.set(`${x},${y}`, skin)); // clear default
    const mouthY = isHero ? 16 : 17;
    d.set(`14,${mouthY}`, BLK); d.set(`18,${mouthY}`, BLK);
    d.set(`15,${mouthY + 1}`, BLK); d.set(`16,${mouthY + 1}`, BLK); d.set(`17,${mouthY + 1}`, BLK);
  } else if (state.mouthIdx === 2) {
    // Open
    const mouthY = isHero ? 16 : 17;
    d.set(`16,${mouthY}`, BLK); d.set(`17,${mouthY}`, BLK);
    d.set(`16,${mouthY + 1}`, BLK); d.set(`17,${mouthY + 1}`, BLK);
  }

  // 4. Body — shared outline + top
  BODY_OUTLINE_SHARED.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
  BODY_TOP.forEach(([x, y]) => d.set(`${x},${y}`, top));
  BODY_ACCENT.forEach(([x, y]) => d.set(`${x},${y}`, accent));
  BODY_SKIN.forEach(([x, y]) => d.set(`${x},${y}`, skin));

  // 5. Left side — cape or straight arm
  if (state.hasCape) {
    const capeColor = OUTFIT_COLORS[state.capeColorIdx]?.color || "#D50000";
    BODY_OUTLINE_CAPE.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
    BODY_LEFT_CAPE.forEach(([x, y]) => d.set(`${x},${y}`, capeColor));
    BODY_LEFT_CAPE_SHADOW.forEach(([x, y]) => d.set(`${x},${y}`, darken(capeColor, 40)));
    BODY_LEFT_CAPE_HIGHLIGHT.forEach(([x, y]) => d.set(`${x},${y}`, lighten(capeColor, 10)));
  } else {
    // No cape — draw symmetric arm outline + fill with shirt color
    BODY_OUTLINE_ARM.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
    BODY_LEFT_ARM_FILL.forEach(([x, y]) => d.set(`${x},${y}`, top));
    // Legs fill (no cape bottom)
    d.set("16,27", top); d.set("17,27", top);
    d.set("14,28", top); d.set("15,28", top);
    d.set("18,28", top); d.set("19,28", top);
  }

  // 6. Accessories
  if (state.accessoryIdx === 1) {
    // Crown
    const gold = "#FFC42A";
    const crownY = isHero ? 4 : 4;
    d.set(`13,${crownY}`, gold); d.set(`15,${crownY}`, gold); d.set(`17,${crownY}`, gold); d.set(`19,${crownY}`, gold);
    for (let x = 13; x <= 19; x++) d.set(`${x},${crownY + 1}`, gold);
  } else if (state.accessoryIdx === 2) {
    // Halo
    const gold = "#FFC42A";
    for (let x = 13; x <= 19; x++) d.set(`${x},3`, gold);
    d.set("12,4", gold); d.set("20,4", gold);
  }

  return d;
}

// ══════════════════════════════════════════════════════
// ANALYZE PIXEL DATA — extract builder state from existing character
// Used to load pre-made or free-draw characters into the builder
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
  // Determine template by checking if Hero-specific hair outline pixels exist as black
  const heroHairCheck = [[17,5],[18,5],[19,5],[15,6],[16,6]]; // Hero has these as black, Crofly doesn't
  const isHero = heroHairCheck.every(([x, y]) => data.get(`${x},${y}`) === BLK);

  // Extract colors by sampling known positions
  const skinSample = data.get("15,15") || data.get("14,14") || "#FFCD94";
  const skinIdx = findClosestColorIdx(skinSample, SKIN_TONES);

  // Hair color — only matters for Crofly (Hero's hair is in the outline)
  const hairSample = data.get("13,7") || data.get("14,8") || "#8B4513";
  const hairIdx = hairSample === BLK ? 0 : findClosestColorIdx(hairSample, HAIR_COLORS);

  // Top/shirt color
  const topSample = data.get("16,20") || data.get("15,21") || "#FFC42A";
  const topIdx = findClosestColorIdx(topSample, OUTFIT_COLORS);

  // Accent
  const accentSample = data.get("16,22") || data.get("14,25") || "#D50000";
  const accentIdx = findClosestColorIdx(accentSample, OUTFIT_COLORS);

  // Cape — check if left region color differs from top
  const leftSample = data.get("9,22") || data.get("8,23") || "";
  const hasCape = leftSample && leftSample !== BLK && findClosestColorIdx(leftSample, OUTFIT_COLORS) !== topIdx;
  const capeColorIdx = hasCape ? findClosestColorIdx(leftSample, OUTFIT_COLORS) : 0;

  return {
    templateIdx: isHero ? 0 : 1,
    skinIdx,
    hairIdx,
    topIdx,
    accentIdx,
    hasCape: !!hasCape,
    capeColorIdx,
    eyeIdx: 0,
    mouthIdx: 0,
    accessoryIdx: 0,
  };
}
