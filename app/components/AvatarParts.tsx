// Avatar builder parts — uses the Crofly outline template
// Parts modify colors and add optional overlays on top of the fixed outline

type PixelMap = Map<string, string>;
type Coord = [number, number];

const BLK = "#000000";

// ══════════════════════════════════════════════════════
// CROFLY PIXEL TEMPLATE — regions of the fixed outline
// ══════════════════════════════════════════════════════

export const CROFLY_OUTLINE: Coord[] = [[7,5],[8,5],[9,5],[10,5],[6,6],[11,6],[13,6],[14,6],[15,6],[16,6],[17,6],[18,6],[6,7],[8,7],[9,7],[12,7],[19,7],[20,7],[6,8],[7,8],[9,8],[10,8],[11,8],[21,8],[11,9],[22,9],[10,10],[22,10],[10,11],[22,11],[10,12],[22,12],[10,13],[16,13],[19,13],[22,13],[10,14],[16,14],[19,14],[22,14],[10,15],[22,15],[11,16],[22,16],[11,17],[16,17],[17,17],[22,17],[12,18],[21,18],[10,19],[11,19],[13,19],[14,19],[15,19],[16,19],[17,19],[18,19],[19,19],[20,19],[9,20],[12,20],[13,20],[20,20],[21,20],[8,21],[11,21],[22,21],[7,22],[8,22],[11,22],[20,22],[22,22],[7,23],[11,23],[13,23],[20,23],[22,23],[6,24],[11,24],[13,24],[20,24],[22,24],[6,25],[11,25],[12,25],[13,25],[16,25],[17,25],[20,25],[21,25],[22,25],[5,26],[12,26],[13,26],[20,26],[5,27],[6,27],[7,27],[8,27],[9,27],[10,27],[11,27],[13,27],[20,27],[13,28],[16,28],[17,28],[20,28],[13,29],[14,29],[15,29],[18,29],[19,29],[20,29]];
export const CROFLY_HAIR: Coord[] = [[7,6],[8,6],[9,6],[10,6],[7,7],[10,7],[11,7],[13,7],[14,7],[15,7],[16,7],[17,7],[18,7],[12,8],[13,8],[14,8],[15,8],[16,8],[17,8],[18,8],[19,8],[20,8],[12,9],[13,9],[14,9],[15,9],[16,9],[17,9],[18,9],[19,9],[20,9],[21,9],[11,10],[12,10],[13,10],[14,10],[16,10],[17,10],[18,10],[21,10],[11,11],[11,12],[11,13],[11,14],[11,15]];
export const CROFLY_SKIN: Coord[] = [[15,10],[19,10],[20,10],[12,11],[13,11],[14,11],[15,11],[16,11],[17,11],[18,11],[19,11],[20,11],[21,11],[12,12],[13,12],[14,12],[15,12],[16,12],[17,12],[18,12],[19,12],[20,12],[21,12],[12,13],[13,13],[14,13],[15,13],[17,13],[18,13],[20,13],[21,13],[12,14],[13,14],[14,14],[15,14],[17,14],[18,14],[20,14],[21,14],[12,15],[13,15],[14,15],[15,15],[16,15],[17,15],[18,15],[19,15],[20,15],[21,15],[12,16],[13,16],[14,16],[15,16],[16,16],[17,16],[18,16],[19,16],[20,16],[21,16],[12,17],[13,17],[14,17],[15,17],[18,17],[19,17],[20,17],[21,17],[13,18],[14,18],[15,18],[16,18],[17,18],[18,18],[19,18],[20,18],[12,24],[21,24]];
export const CROFLY_TOP: Coord[] = [[16,20],[17,20],[14,21],[15,21],[16,21],[17,21],[18,21],[19,21],[12,22],[13,22],[14,22],[15,22],[17,22],[18,22],[19,22],[21,22],[12,23],[14,23],[15,23],[16,23],[18,23],[19,23],[21,23],[14,24],[15,24],[16,24],[17,24],[18,24],[19,24],[14,26],[15,26],[16,26],[17,26],[18,26],[19,26],[14,27],[15,27],[18,27],[19,27]];
export const CROFLY_LEFT: Coord[] = [[14,20],[15,20],[18,20],[19,20],[10,21],[12,21],[13,21],[20,21],[21,21],[9,22],[10,22],[8,23],[9,23],[10,23],[7,24],[8,24],[9,24],[7,25],[8,25],[6,26],[7,26],[16,27],[17,27],[14,28],[15,28],[18,28],[19,28]];
export const CROFLY_LEFT_SHADOW: Coord[] = [[10,20],[9,21],[10,24],[9,25],[10,25],[8,26],[9,26],[10,26],[11,26]];
export const CROFLY_LEFT_HIGHLIGHT: Coord[] = [[12,19],[11,20]];
export const CROFLY_ACCENT: Coord[] = [[16,22],[17,23],[14,25],[15,25],[18,25],[19,25]];

// Hair puff position (top-left area of head)
const HAIR_PUFF: Coord[] = [[7,6],[8,6],[9,6],[10,6],[7,7],[10,7],[7,8],[8,8],[9,8],[10,8]];
// Eye pixel positions in Crofly (default: (16,13)(16,14)(19,13)(19,14) — single pixel eyes)
const CROFLY_EYES: Coord[] = [[16,13],[19,13],[16,14],[19,14]];
// Mouth pixel positions in Crofly
const CROFLY_MOUTH: Coord[] = [[16,17],[17,17]];

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
// COLOR PALETTES (expanded)
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
  { name: "Silver", color: "#B8C5D6" },
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
// HAIR STYLES — modify which hair pixels are drawn
// ══════════════════════════════════════════════════════

export const HAIR_STYLES = [
  {
    name: "Crofly",
    icon: "💇",
    description: "With top-left puff",
    getHairPixels: (): Coord[] => CROFLY_HAIR,
  },
  {
    name: "Hero",
    icon: "👦",
    description: "Clean cropped",
    getHairPixels: (): Coord[] => CROFLY_HAIR.filter(([x,y]) => !HAIR_PUFF.some(([px,py]) => px === x && py === y)),
  },
  {
    name: "Spiky",
    icon: "🦔",
    description: "Spikes on top",
    getHairPixels: (): Coord[] => {
      const base = CROFLY_HAIR.filter(([x,y]) => !HAIR_PUFF.some(([px,py]) => px === x && py === y));
      return [...base, [14,5] as Coord, [16,5] as Coord, [18,5] as Coord, [13,6] as Coord, [15,6] as Coord, [17,6] as Coord];
    },
  },
  {
    name: "Long",
    icon: "👩",
    description: "Flowing sides",
    getHairPixels: (): Coord[] => {
      const base = CROFLY_HAIR.filter(([x,y]) => !HAIR_PUFF.some(([px,py]) => px === x && py === y));
      return [...base, [11,11] as Coord, [11,12] as Coord, [11,13] as Coord];
    },
  },
  {
    name: "Bald",
    icon: "🥚",
    description: "No hair",
    getHairPixels: (): Coord[] => [],
  },
];

// ══════════════════════════════════════════════════════
// EYE STYLES — override default eye pixels
// ══════════════════════════════════════════════════════

export const EYE_STYLES = [
  {
    name: "Default",
    icon: "👀",
    getEyePixels: (): Coord[] => CROFLY_EYES,
  },
  {
    name: "Wide",
    icon: "😳",
    getEyePixels: (): Coord[] => [[15,13],[16,13],[18,13],[19,13],[15,14],[16,14],[18,14],[19,14]],
  },
  {
    name: "Sleepy",
    icon: "😑",
    getEyePixels: (): Coord[] => [[15,14],[16,14],[18,14],[19,14]],
  },
  {
    name: "Angry",
    icon: "😠",
    getEyePixels: (): Coord[] => [[15,13],[17,13],[16,14],[18,14]],
  },
  {
    name: "Shades",
    icon: "😎",
    getEyePixels: (): Coord[] => [[14,13],[15,13],[16,13],[17,13],[18,13],[19,13],[14,14],[15,14],[18,14],[19,14]],
  },
];

// ══════════════════════════════════════════════════════
// MOUTH STYLES
// ══════════════════════════════════════════════════════

export const MOUTH_STYLES = [
  {
    name: "Neutral",
    icon: "😐",
    getMouthPixels: (): Coord[] => CROFLY_MOUTH,
  },
  {
    name: "Smile",
    icon: "😊",
    getMouthPixels: (): Coord[] => [[15,17],[16,17],[17,17],[18,17]],
  },
  {
    name: "Wide Grin",
    icon: "😁",
    getMouthPixels: (): Coord[] => [[14,17],[15,17],[16,17],[17,17],[18,17],[19,17]],
  },
  {
    name: "Small",
    icon: "🙂",
    getMouthPixels: (): Coord[] => [[16,17]],
  },
  {
    name: "Open",
    icon: "😮",
    getMouthPixels: (): Coord[] => [[16,17],[17,17],[16,18],[17,18]],
  },
];

// ══════════════════════════════════════════════════════
// ACCESSORIES — overlay pixels on top
// ══════════════════════════════════════════════════════

export const ACCESSORIES = [
  {
    name: "None",
    icon: "❌",
    overlay: (): PixelMap => new Map(),
  },
  {
    name: "Crown",
    icon: "👑",
    overlay: (): PixelMap => {
      const d = new Map<string, string>();
      const gold = "#FFC42A";
      d.set("13,4", gold); d.set("15,4", gold); d.set("17,4", gold); d.set("19,4", gold);
      for (let x = 13; x <= 19; x++) d.set(`${x},5`, gold);
      return d;
    },
  },
  {
    name: "Halo",
    icon: "😇",
    overlay: (): PixelMap => {
      const d = new Map<string, string>();
      for (let x = 13; x <= 19; x++) d.set(`${x},3`, "#FFC42A");
      d.set("12,4", "#FFC42A"); d.set("20,4", "#FFC42A");
      return d;
    },
  },
  {
    name: "Horns",
    icon: "😈",
    overlay: (): PixelMap => {
      const d = new Map<string, string>();
      d.set("12,3", BLK); d.set("12,4", BLK);
      d.set("20,3", BLK); d.set("20,4", BLK);
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// CAPE COLORS (sets left region independently from top)
// ══════════════════════════════════════════════════════

export const CAPE_OPTIONS = [
  { name: "None", color: null as string | null },
  { name: "Red", color: "#D50000" },
  { name: "Blue", color: "#2979FF" },
  { name: "Green", color: "#29845A" },
  { name: "Purple", color: "#8B5CF6" },
  { name: "Yellow", color: "#FFC42A" },
  { name: "Black", color: "#1A1A2E" },
  { name: "White", color: "#F0F0F0" },
];

// ══════════════════════════════════════════════════════
// COMPOSITE — builds the full character from all options
// ══════════════════════════════════════════════════════

export function compositeCharacter(opts: {
  skin: string;
  hair: string;
  top: string;
  accent: string;
  capeColor: string | null;
  hairStyleIdx: number;
  eyeStyleIdx: number;
  mouthStyleIdx: number;
  accessoryIdx: number;
}): PixelMap {
  const d: PixelMap = new Map();

  // 1. Black outline (always)
  CROFLY_OUTLINE.forEach(([x, y]) => d.set(`${x},${y}`, BLK));

  // 2. Skin fill
  CROFLY_SKIN.forEach(([x, y]) => d.set(`${x},${y}`, opts.skin));

  // 3. Top (shirt/torso)
  CROFLY_TOP.forEach(([x, y]) => d.set(`${x},${y}`, opts.top));

  // 4. Left region (cape or sleeve — same color as top if no cape)
  const leftColor = opts.capeColor || opts.top;
  CROFLY_LEFT.forEach(([x, y]) => d.set(`${x},${y}`, leftColor));
  CROFLY_LEFT_SHADOW.forEach(([x, y]) => d.set(`${x},${y}`, darken(leftColor, 40)));
  CROFLY_LEFT_HIGHLIGHT.forEach(([x, y]) => d.set(`${x},${y}`, lighten(leftColor, 10)));

  // 5. Accent (belt, boots)
  CROFLY_ACCENT.forEach(([x, y]) => d.set(`${x},${y}`, opts.accent));

  // 6. Hair (based on style)
  const hairStyle = HAIR_STYLES[opts.hairStyleIdx] || HAIR_STYLES[0];
  const hairPixels = hairStyle.getHairPixels();
  hairPixels.forEach(([x, y]) => d.set(`${x},${y}`, opts.hair));

  // 7. Eyes (override default — clear Crofly eyes first, then set new)
  CROFLY_EYES.forEach(([x, y]) => {
    // Only clear if inside face (skin color) — avoid erasing outline
    const key = `${x},${y}`;
    if (d.get(key) === BLK) d.delete(key);
  });
  const eyeStyle = EYE_STYLES[opts.eyeStyleIdx] || EYE_STYLES[0];
  eyeStyle.getEyePixels().forEach(([x, y]) => d.set(`${x},${y}`, BLK));
  // Restore skin pixels for any cleared eye positions that aren't in new style
  CROFLY_SKIN.forEach(([x, y]) => {
    if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, opts.skin);
  });

  // 8. Mouth
  CROFLY_MOUTH.forEach(([x, y]) => {
    if (d.get(`${x},${y}`) === BLK) d.delete(`${x},${y}`);
  });
  const mouthStyle = MOUTH_STYLES[opts.mouthStyleIdx] || MOUTH_STYLES[0];
  mouthStyle.getMouthPixels().forEach(([x, y]) => d.set(`${x},${y}`, BLK));
  // Restore skin
  CROFLY_SKIN.forEach(([x, y]) => {
    if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, opts.skin);
  });

  // 9. Accessories (overlay on top)
  const accessory = ACCESSORIES[opts.accessoryIdx] || ACCESSORIES[0];
  const overlay = accessory.overlay();
  overlay.forEach((color, key) => d.set(key, color));

  return d;
}
