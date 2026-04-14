// Avatar part definitions for the character builder
// Each part function receives color choices and returns positioned pixel data

type PixelMap = Map<string, string>;

function rect(d: PixelMap, x: number, y: number, w: number, h: number, c: string) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      d.set(`${x + dx},${y + dy}`, c);
}

// ── Skin Tones ──
export const SKIN_TONES = [
  { name: "Light", color: "#FFDBB4" },
  { name: "Fair", color: "#F5D0A9" },
  { name: "Medium", color: "#E8B887" },
  { name: "Tan", color: "#C8956C" },
  { name: "Brown", color: "#8D5524" },
  { name: "Dark", color: "#5C3310" },
];

// ── Hair Colors ──
export const HAIR_COLORS = [
  { name: "Black", color: "#1A1A2E" },
  { name: "Dark Brown", color: "#3D2314" },
  { name: "Brown", color: "#8B4513" },
  { name: "Auburn", color: "#A0522D" },
  { name: "Blonde", color: "#C4A35A" },
  { name: "Red", color: "#D94000" },
  { name: "Grey", color: "#94A3B8" },
  { name: "Blue", color: "#2C6ECB" },
  { name: "Pink", color: "#FF6B9D" },
  { name: "White", color: "#E8E8E8" },
];

// ── Outfit Colors ──
export const OUTFIT_COLORS = [
  { name: "Red", color: "#DC143C" },
  { name: "Blue", color: "#2C6ECB" },
  { name: "Green", color: "#29845A" },
  { name: "Yellow", color: "#F5C518" },
  { name: "Purple", color: "#8B5CF6" },
  { name: "Orange", color: "#E8963A" },
  { name: "Navy", color: "#1E3A5F" },
  { name: "Black", color: "#1A1A2E" },
  { name: "White", color: "#F0F0F0" },
  { name: "Pink", color: "#FF6B9D" },
];

// ── Head Shapes ──
export const HEAD_PARTS = [
  {
    name: "Round",
    icon: "🟢",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 12, 7, 8, 7, skin);
      // Ears
      d.set("11,9", skin); d.set("20,9", skin);
      d.set("11,10", skin); d.set("20,10", skin);
      // Neck
      rect(d, 14, 14, 4, 1, skin);
      return d;
    },
  },
  {
    name: "Square",
    icon: "🟧",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 11, 7, 10, 7, skin);
      // Neck
      rect(d, 14, 14, 4, 1, skin);
      return d;
    },
  },
  {
    name: "Tall",
    icon: "📐",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 12, 6, 8, 8, skin);
      d.set("11,9", skin); d.set("20,9", skin);
      rect(d, 14, 14, 4, 1, skin);
      return d;
    },
  },
  {
    name: "Wide",
    icon: "⬜",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 7, 12, 7, skin);
      rect(d, 14, 14, 4, 1, skin);
      return d;
    },
  },
];

// ── Hair Styles ──
export const HAIR_PARTS = [
  {
    name: "Short",
    icon: "💇",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 12, 5, 8, 2, hair);
      rect(d, 11, 6, 10, 1, hair);
      return d;
    },
  },
  {
    name: "Messy",
    icon: "🌊",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 12, 4, 7, 1, hair);
      rect(d, 11, 5, 9, 2, hair);
      d.set("18,3", hair); d.set("19,4", hair); // sticking up
      d.set("11,4", hair); d.set("10,5", hair);
      return d;
    },
  },
  {
    name: "Long",
    icon: "👩",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 12, 4, 8, 3, hair);
      rect(d, 11, 5, 10, 2, hair);
      // Long sides
      rect(d, 10, 7, 2, 7, hair);
      rect(d, 20, 7, 2, 7, hair);
      return d;
    },
  },
  {
    name: "Mohawk",
    icon: "🦔",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 14, 1, 4, 6, hair);
      rect(d, 13, 4, 6, 2, hair);
      return d;
    },
  },
  {
    name: "Ponytail",
    icon: "🎀",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 12, 4, 8, 3, hair);
      rect(d, 11, 5, 10, 2, hair);
      // Ponytail going right
      rect(d, 21, 6, 2, 2, hair);
      rect(d, 23, 7, 2, 3, hair);
      rect(d, 24, 10, 1, 2, hair);
      return d;
    },
  },
  {
    name: "Buzz",
    icon: "✂️",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 12, 6, 8, 1, hair);
      rect(d, 13, 5, 6, 1, hair);
      return d;
    },
  },
  {
    name: "Curly",
    icon: "🌀",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 11, 4, 10, 3, hair);
      d.set("10,5", hair); d.set("10,6", hair); d.set("10,7", hair);
      d.set("21,5", hair); d.set("21,6", hair); d.set("21,7", hair);
      d.set("12,3", hair); d.set("15,3", hair); d.set("18,3", hair);
      return d;
    },
  },
  {
    name: "Bald",
    icon: "🥚",
    build: (_hair: string): PixelMap => new Map(),
  },
];

// ── Eye Styles ──
export const EYE_PARTS = [
  {
    name: "Normal",
    icon: "👀",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      const BLK = "#1A1A2E";
      d.set("13,10", BLK); d.set("14,10", BLK);
      d.set("17,10", BLK); d.set("18,10", BLK);
      return d;
    },
  },
  {
    name: "Sleepy",
    icon: "😑",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("13,10", "#1A1A2E"); d.set("14,10", "#1A1A2E"); d.set("15,10", "#1A1A2E");
      d.set("17,10", "#1A1A2E"); d.set("18,10", "#1A1A2E"); d.set("19,10", "#1A1A2E");
      return d;
    },
  },
  {
    name: "Angry",
    icon: "😠",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      const BLK = "#1A1A2E";
      d.set("13,9", BLK); d.set("14,10", BLK); // left angled
      d.set("18,9", BLK); d.set("17,10", BLK); // right angled
      return d;
    },
  },
  {
    name: "Glasses",
    icon: "🤓",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      const BLK = "#1A1A2E", FRAME = "#4A3728";
      // Frames
      rect(d, 12, 9, 4, 3, FRAME);
      rect(d, 17, 9, 4, 3, FRAME);
      d.set("16,10", FRAME); // bridge
      // Lenses (clear)
      rect(d, 13, 10, 2, 1, "#B0D4F1");
      rect(d, 18, 10, 2, 1, "#B0D4F1");
      // Pupils
      d.set("13,10", BLK); d.set("18,10", BLK);
      return d;
    },
  },
  {
    name: "Wink",
    icon: "😉",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      const BLK = "#1A1A2E";
      d.set("13,10", BLK); d.set("14,10", BLK); // left open
      d.set("17,10", BLK); // right wink line
      d.set("18,9", BLK);
      return d;
    },
  },
  {
    name: "Sunglasses",
    icon: "😎",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      const BLK = "#1A1A2E";
      rect(d, 12, 9, 4, 2, BLK);
      rect(d, 17, 9, 4, 2, BLK);
      d.set("16,9", BLK); // bridge
      return d;
    },
  },
];

// ── Mouth Styles ──
export const MOUTH_PARTS = [
  {
    name: "Smile",
    icon: "😊",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,12", "#1A1A2E"); d.set("17,12", "#1A1A2E");
      d.set("15,13", "#1A1A2E"); d.set("16,13", "#1A1A2E");
      return d;
    },
  },
  {
    name: "Neutral",
    icon: "😐",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,12", "#1A1A2E"); d.set("15,12", "#1A1A2E"); d.set("16,12", "#1A1A2E"); d.set("17,12", "#1A1A2E");
      return d;
    },
  },
  {
    name: "Open",
    icon: "😮",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 14, 12, 4, 2, "#1A1A2E");
      d.set("15,12", "#DC143C"); d.set("16,12", "#DC143C"); // tongue
      return d;
    },
  },
  {
    name: "Grin",
    icon: "😁",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("13,12", "#1A1A2E");
      rect(d, 14, 12, 4, 1, "#FFFFFF");
      d.set("18,12", "#1A1A2E");
      return d;
    },
  },
];

// ── Body/Outfit Styles ──
export const BODY_PARTS = [
  {
    name: "T-Shirt",
    icon: "👕",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 15, 12, 7, outfit);
      // Arms
      rect(d, 8, 15, 2, 4, outfit);
      rect(d, 22, 15, 2, 4, outfit);
      // Hands
      rect(d, 8, 19, 2, 3, skin);
      rect(d, 22, 19, 2, 3, skin);
      return d;
    },
  },
  {
    name: "Suit",
    icon: "🤵",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 15, 12, 7, outfit);
      // White shirt center
      rect(d, 14, 15, 4, 7, "#F0F0F0");
      // Tie
      rect(d, 15, 15, 2, 5, "#DC143C");
      // Arms
      rect(d, 8, 15, 2, 5, outfit);
      rect(d, 22, 15, 2, 5, outfit);
      // Hands
      rect(d, 8, 20, 2, 2, skin);
      rect(d, 22, 20, 2, 2, skin);
      return d;
    },
  },
  {
    name: "Hoodie",
    icon: "🧥",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 15, 12, 7, outfit);
      // Hood behind head
      rect(d, 10, 13, 2, 2, outfit);
      rect(d, 20, 13, 2, 2, outfit);
      // Front pocket
      rect(d, 12, 19, 8, 2, darken(outfit));
      // Arms
      rect(d, 8, 15, 2, 5, outfit);
      rect(d, 22, 15, 2, 5, outfit);
      rect(d, 8, 20, 2, 2, skin);
      rect(d, 22, 20, 2, 2, skin);
      return d;
    },
  },
  {
    name: "Armor",
    icon: "🛡️",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 15, 12, 7, "#94A3B8");
      // Shoulder pads
      rect(d, 8, 14, 3, 2, "#94A3B8");
      rect(d, 21, 14, 3, 2, "#94A3B8");
      // Chest emblem
      rect(d, 14, 17, 4, 2, "#FFD700");
      // Arms
      rect(d, 8, 16, 2, 4, "#94A3B8");
      rect(d, 22, 16, 2, 4, "#94A3B8");
      rect(d, 8, 20, 2, 2, skin);
      rect(d, 22, 20, 2, 2, skin);
      return d;
    },
  },
  {
    name: "Robe",
    icon: "🥋",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 9, 15, 14, 7, outfit);
      // Belt
      rect(d, 9, 19, 14, 1, darken(outfit));
      // Arms (wide sleeves)
      rect(d, 7, 15, 2, 5, outfit);
      rect(d, 23, 15, 2, 5, outfit);
      rect(d, 7, 20, 2, 2, skin);
      rect(d, 23, 20, 2, 2, skin);
      return d;
    },
  },
  {
    name: "Tank Top",
    icon: "🎽",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 11, 15, 10, 7, outfit);
      // Bare arms
      rect(d, 8, 15, 3, 5, skin);
      rect(d, 21, 15, 3, 5, skin);
      rect(d, 8, 20, 2, 2, skin);
      rect(d, 22, 20, 2, 2, skin);
      return d;
    },
  },
];

// ── Leg Styles ──
export const LEG_PARTS = [
  {
    name: "Pants",
    icon: "👖",
    build: (outfit: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 11, 22, 4, 5, darken(outfit));
      rect(d, 17, 22, 4, 5, darken(outfit));
      return d;
    },
  },
  {
    name: "Shorts",
    icon: "🩳",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 11, 22, 4, 3, darken(outfit));
      rect(d, 17, 22, 4, 3, darken(outfit));
      // Exposed legs
      rect(d, 11, 25, 4, 2, skin);
      rect(d, 17, 25, 4, 2, skin);
      return d;
    },
  },
  {
    name: "Skirt",
    icon: "👗",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      // Flared skirt
      rect(d, 10, 22, 12, 3, outfit);
      // Legs below
      rect(d, 12, 25, 3, 2, skin);
      rect(d, 17, 25, 3, 2, skin);
      return d;
    },
  },
];

// ── Shoe Styles ──
export const SHOE_PARTS = [
  {
    name: "Boots",
    icon: "🥾",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 27, 5, 2, "#2C1810");
      rect(d, 17, 27, 5, 2, "#2C1810");
      // Boot tops
      rect(d, 10, 26, 5, 1, "#3D2314");
      rect(d, 17, 26, 5, 1, "#3D2314");
      return d;
    },
  },
  {
    name: "Sneakers",
    icon: "👟",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 27, 5, 2, "#F0F0F0");
      rect(d, 17, 27, 5, 2, "#F0F0F0");
      // Sole
      rect(d, 10, 28, 5, 1, "#1A1A2E");
      rect(d, 17, 28, 5, 1, "#1A1A2E");
      return d;
    },
  },
  {
    name: "Sandals",
    icon: "🩴",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 28, 5, 1, "#8B4513");
      rect(d, 17, 28, 5, 1, "#8B4513");
      // Visible feet
      rect(d, 11, 27, 3, 1, skin);
      rect(d, 18, 27, 3, 1, skin);
      return d;
    },
  },
  {
    name: "None",
    icon: "🦶",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 11, 27, 4, 2, skin);
      rect(d, 17, 27, 4, 2, skin);
      return d;
    },
  },
];

// ── Accessories ──
export const ACCESSORY_PARTS = [
  {
    name: "None",
    icon: "❌",
    build: (): PixelMap => new Map(),
  },
  {
    name: "Cape",
    icon: "🦸",
    build: (outfit: string): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 7, 15, 2, 8, outfit);
      rect(d, 6, 17, 1, 6, outfit);
      rect(d, 5, 19, 1, 4, outfit);
      rect(d, 23, 15, 2, 6, outfit);
      return d;
    },
  },
  {
    name: "Sword",
    icon: "⚔️",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 24, 12, 1, 10, "#C0C0C0");
      rect(d, 23, 11, 3, 1, "#FFD700");
      rect(d, 24, 22, 1, 2, "#8B4513");
      return d;
    },
  },
  {
    name: "Shield",
    icon: "🛡️",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 5, 16, 3, 5, "#2C6ECB");
      d.set("6,17", "#FFD700"); d.set("6,18", "#FFD700"); d.set("6,19", "#FFD700");
      return d;
    },
  },
  {
    name: "Crown",
    icon: "👑",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 12, 3, 8, 2, "#FFD700");
      d.set("12,2", "#FFD700"); d.set("15,2", "#FFD700"); d.set("19,2", "#FFD700");
      d.set("15,3", "#DC143C"); d.set("16,3", "#DC143C");
      return d;
    },
  },
  {
    name: "Headphones",
    icon: "🎧",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 10, 5, 1, 1, "#1A1A2E");
      rect(d, 21, 5, 1, 1, "#1A1A2E");
      rect(d, 10, 8, 1, 3, "#1A1A2E");
      rect(d, 21, 8, 1, 3, "#1A1A2E");
      rect(d, 9, 9, 1, 2, "#DC143C");
      rect(d, 22, 9, 1, 2, "#DC143C");
      return d;
    },
  },
  {
    name: "Backpack",
    icon: "🎒",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      rect(d, 23, 14, 3, 7, "#8B4513");
      rect(d, 24, 16, 1, 3, "#C4A35A");
      return d;
    },
  },
];

// Helper: darken a hex color
function darken(hex: string, amount = 30): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Composite all selected parts into a single pixel map
export function compositeCharacter(
  skinColor: string,
  hairColor: string,
  outfitColor: string,
  headIdx: number,
  hairIdx: number,
  eyeIdx: number,
  mouthIdx: number,
  bodyIdx: number,
  legIdx: number,
  shoeIdx: number,
  accessoryIdx: number,
): PixelMap {
  const result: PixelMap = new Map();

  // Layer order matters: bottom to top
  const layers = [
    SHOE_PARTS[shoeIdx]?.build(skinColor),
    LEG_PARTS[legIdx]?.build(outfitColor, skinColor),
    BODY_PARTS[bodyIdx]?.build(outfitColor, skinColor),
    HEAD_PARTS[headIdx]?.build(skinColor),
    HAIR_PARTS[hairIdx]?.build(hairColor),
    EYE_PARTS[eyeIdx]?.build(),
    MOUTH_PARTS[mouthIdx]?.build(skinColor),
    ACCESSORY_PARTS[accessoryIdx]?.build(outfitColor),
  ];

  layers.forEach((layer) => {
    if (!layer) return;
    layer.forEach((color, key) => result.set(key, color));
  });

  return result;
}
