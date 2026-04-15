// Avatar part definitions for the character builder — outlined pixel art style
// Matches the chunky black-outlined art of newhero/newcrofly

type PixelMap = Map<string, string>;

const BLK = "#000000";

function rect(d: PixelMap, x: number, y: number, w: number, h: number, c: string) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      d.set(`${x + dx},${y + dy}`, c);
}

// Draws the shared body outline (arms, torso, legs) used by all characters
function drawBodyOutline(d: PixelMap) {
  for (let x = 13; x <= 20; x++) d.set(`${x},19`, BLK);
  d.set("12,18", BLK); d.set("21,18", BLK);
  d.set("10,19", BLK); d.set("11,19", BLK);
  d.set("9,20", BLK); d.set("12,20", BLK); d.set("13,20", BLK);
  d.set("8,21", BLK); d.set("11,21", BLK);
  d.set("7,22", BLK); d.set("8,22", BLK); d.set("11,22", BLK);
  d.set("7,23", BLK); d.set("11,23", BLK);
  d.set("6,24", BLK); d.set("11,24", BLK);
  d.set("6,25", BLK); d.set("11,25", BLK); d.set("12,25", BLK); d.set("13,25", BLK);
  d.set("5,26", BLK); d.set("12,26", BLK); d.set("13,26", BLK);
  for (let x = 5; x <= 11; x++) d.set(`${x},27`, BLK);
  d.set("13,27", BLK);
  d.set("20,20", BLK); d.set("21,20", BLK);
  d.set("22,21", BLK);
  d.set("20,22", BLK); d.set("22,22", BLK);
  d.set("20,23", BLK); d.set("22,23", BLK);
  d.set("20,24", BLK); d.set("22,24", BLK);
  d.set("16,25", BLK); d.set("17,25", BLK); d.set("20,25", BLK); d.set("21,25", BLK); d.set("22,25", BLK);
  d.set("20,26", BLK);
  d.set("20,27", BLK);
  d.set("13,28", BLK); d.set("16,28", BLK); d.set("17,28", BLK); d.set("20,28", BLK);
  d.set("13,29", BLK); d.set("14,29", BLK); d.set("15,29", BLK);
  d.set("18,29", BLK); d.set("19,29", BLK); d.set("20,29", BLK);
}

// ── Skin Tones ──
export const SKIN_TONES = [
  { name: "Light", color: "#FFCD94" },
  { name: "Fair", color: "#F1C27D" },
  { name: "Medium", color: "#E0AC69" },
  { name: "Tan", color: "#C68642" },
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
  { name: "Red", color: "#D50000" },
  { name: "Blue", color: "#2979FF" },
  { name: "Green", color: "#29845A" },
  { name: "Yellow", color: "#FFC42A" },
  { name: "Purple", color: "#8B5CF6" },
  { name: "Orange", color: "#E8963A" },
  { name: "Navy", color: "#1E3A5F" },
  { name: "Black", color: "#1A1A2E" },
  { name: "White", color: "#F0F0F0" },
  { name: "Pink", color: "#FF6B9D" },
];

// ══════════════════════════════════════════════════════
// HEAD SHAPES — each draws the head outline + skin fill
// ══════════════════════════════════════════════════════

export const HEAD_PARTS = [
  {
    name: "Round",
    icon: "🟢",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      // Head outline (same shape as newhero)
      d.set("14,5", BLK); d.set("15,5", BLK); d.set("16,5", BLK); d.set("17,5", BLK);
      d.set("12,6", BLK); d.set("13,6", BLK); d.set("18,6", BLK); d.set("19,6", BLK);
      d.set("11,7", BLK); d.set("20,7", BLK);
      d.set("11,8", BLK); d.set("20,8", BLK);
      for (let y = 9; y <= 15; y++) { d.set(`11,${y}`, BLK); d.set(`21,${y}`, BLK); }
      d.set("12,16", BLK); d.set("20,16", BLK);
      d.set("12,17", BLK); d.set("20,17", BLK);
      d.set("13,18", BLK); d.set("14,18", BLK); d.set("17,18", BLK); d.set("18,18", BLK); d.set("19,18", BLK);
      d.set("15,18", BLK); d.set("16,18", BLK);
      // Skin fill
      for (let y = 7; y <= 17; y++)
        for (let x = 12; x <= 20; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, skin);
      return d;
    },
  },
  {
    name: "Square",
    icon: "🟧",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      // Square head outline
      for (let x = 12; x <= 19; x++) d.set(`${x},6`, BLK);
      for (let y = 7; y <= 17; y++) { d.set(`11,${y}`, BLK); d.set(`20,${y}`, BLK); }
      for (let x = 12; x <= 19; x++) d.set(`${x},18`, BLK);
      // Skin fill
      for (let y = 7; y <= 17; y++)
        for (let x = 12; x <= 19; x++)
          d.set(`${x},${y}`, skin);
      return d;
    },
  },
  {
    name: "Tall",
    icon: "📐",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      // Taller head outline
      d.set("14,4", BLK); d.set("15,4", BLK); d.set("16,4", BLK); d.set("17,4", BLK);
      d.set("13,5", BLK); d.set("18,5", BLK);
      d.set("12,6", BLK); d.set("19,6", BLK);
      for (let y = 7; y <= 17; y++) { d.set(`12,${y}`, BLK); d.set(`19,${y}`, BLK); }
      for (let x = 13; x <= 18; x++) d.set(`${x},18`, BLK);
      for (let y = 6; y <= 17; y++)
        for (let x = 13; x <= 18; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, skin);
      return d;
    },
  },
  {
    name: "Wide",
    icon: "⬜",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 13; x <= 18; x++) d.set(`${x},6`, BLK);
      d.set("12,7", BLK); d.set("19,7", BLK);
      for (let y = 8; y <= 16; y++) { d.set(`10,${y}`, BLK); d.set(`21,${y}`, BLK); }
      d.set("11,17", BLK); d.set("20,17", BLK);
      for (let x = 12; x <= 19; x++) d.set(`${x},18`, BLK);
      for (let y = 7; y <= 17; y++)
        for (let x = 11; x <= 20; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, skin);
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// HAIR STYLES
// ══════════════════════════════════════════════════════

export const HAIR_PARTS = [
  {
    name: "Short",
    icon: "💇",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 13; x <= 18; x++) { d.set(`${x},6`, hair); d.set(`${x},7`, hair); }
      for (let x = 12; x <= 19; x++) d.set(`${x},8`, hair);
      return d;
    },
  },
  {
    name: "Messy",
    icon: "🌊",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      d.set("13,5", hair); d.set("17,5", hair); d.set("18,5", hair);
      for (let x = 12; x <= 19; x++) { d.set(`${x},6`, hair); d.set(`${x},7`, hair); }
      for (let x = 12; x <= 19; x++) d.set(`${x},8`, hair);
      d.set("12,9", hair); d.set("19,9", hair);
      return d;
    },
  },
  {
    name: "Long",
    icon: "👩",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 13; x <= 18; x++) { d.set(`${x},6`, hair); d.set(`${x},7`, hair); }
      for (let x = 12; x <= 19; x++) d.set(`${x},8`, hair);
      // Side hair down
      d.set("12,9", hair); d.set("12,10", hair); d.set("12,11", hair); d.set("12,12", hair);
      d.set("20,9", hair); d.set("20,10", hair); d.set("20,11", hair); d.set("20,12", hair);
      return d;
    },
  },
  {
    name: "Side Hair",
    icon: "💁",
    build: (hair: string): PixelMap => {
      // Like newcrofly: hair covers left side of head
      const d: PixelMap = new Map();
      // Top puff on left
      for (let x = 7; x <= 10; x++) d.set(`${x},6`, hair);
      d.set("7,7", hair); d.set("10,7", hair); d.set("11,7", hair);
      d.set("7,8", hair); d.set("10,8", hair); d.set("11,8", hair);
      // Side of head
      for (let y = 7; y <= 15; y++) d.set(`11,${y}`, hair);
      for (let x = 13; x <= 18; x++) { d.set(`${x},7`, hair); d.set(`${x},8`, hair); }
      for (let x = 12; x <= 20; x++) d.set(`${x},9`, hair);
      d.set("11,10", hair);
      return d;
    },
  },
  {
    name: "Mohawk",
    icon: "🦔",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      d.set("15,3", hair); d.set("16,3", hair);
      d.set("15,4", hair); d.set("16,4", hair);
      d.set("15,5", hair); d.set("16,5", hair);
      for (let x = 14; x <= 17; x++) { d.set(`${x},6`, hair); d.set(`${x},7`, hair); }
      for (let x = 12; x <= 19; x++) d.set(`${x},8`, hair);
      return d;
    },
  },
  {
    name: "Curly",
    icon: "🌀",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      d.set("12,5", hair); d.set("14,5", hair); d.set("16,5", hair); d.set("18,5", hair); d.set("20,5", hair);
      for (let x = 11; x <= 20; x++) { d.set(`${x},6`, hair); d.set(`${x},7`, hair); }
      for (let x = 12; x <= 19; x++) d.set(`${x},8`, hair);
      d.set("11,9", hair); d.set("20,9", hair);
      return d;
    },
  },
  {
    name: "Bald",
    icon: "🥚",
    build: (_hair: string): PixelMap => new Map(),
  },
];

// ══════════════════════════════════════════════════════
// EYE STYLES (2x2 blocks on face)
// ══════════════════════════════════════════════════════

export const EYE_PARTS = [
  {
    name: "Normal",
    icon: "👀",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,11", BLK); d.set("15,11", BLK);
      d.set("14,12", BLK); d.set("15,12", BLK);
      d.set("17,11", BLK); d.set("18,11", BLK);
      d.set("17,12", BLK); d.set("18,12", BLK);
      return d;
    },
  },
  {
    name: "Wide",
    icon: "😳",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      // 2x3 eyes
      d.set("14,10", BLK); d.set("15,10", BLK);
      d.set("14,11", BLK); d.set("15,11", BLK);
      d.set("14,12", BLK); d.set("15,12", BLK);
      d.set("17,10", BLK); d.set("18,10", BLK);
      d.set("17,11", BLK); d.set("18,11", BLK);
      d.set("17,12", BLK); d.set("18,12", BLK);
      return d;
    },
  },
  {
    name: "Sleepy",
    icon: "😑",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("13,12", BLK); d.set("14,12", BLK); d.set("15,12", BLK);
      d.set("17,12", BLK); d.set("18,12", BLK); d.set("19,12", BLK);
      return d;
    },
  },
  {
    name: "Angry",
    icon: "😠",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("13,10", BLK); d.set("14,11", BLK); d.set("15,12", BLK);
      d.set("19,10", BLK); d.set("18,11", BLK); d.set("17,12", BLK);
      return d;
    },
  },
  {
    name: "Glasses",
    icon: "🤓",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      // Left frame
      d.set("13,10", BLK); d.set("14,10", BLK); d.set("15,10", BLK); d.set("16,10", BLK);
      d.set("13,11", BLK); d.set("16,11", BLK);
      d.set("13,12", BLK); d.set("14,12", BLK); d.set("15,12", BLK); d.set("16,12", BLK);
      // Right frame
      d.set("17,10", BLK); d.set("18,10", BLK); d.set("19,10", BLK); d.set("20,10", BLK);
      d.set("17,11", BLK); d.set("20,11", BLK);
      d.set("17,12", BLK); d.set("18,12", BLK); d.set("19,12", BLK); d.set("20,12", BLK);
      return d;
    },
  },
  {
    name: "Sunglasses",
    icon: "😎",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 13; x <= 15; x++) { d.set(`${x},10`, BLK); d.set(`${x},11`, BLK); }
      for (let x = 17; x <= 19; x++) { d.set(`${x},10`, BLK); d.set(`${x},11`, BLK); }
      d.set("16,10", BLK); // bridge
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// MOUTH STYLES
// ══════════════════════════════════════════════════════

export const MOUTH_PARTS = [
  {
    name: "Neutral",
    icon: "😐",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("15,15", BLK); d.set("16,15", BLK);
      return d;
    },
  },
  {
    name: "Smile",
    icon: "😊",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,15", BLK); d.set("17,15", BLK);
      d.set("15,16", BLK); d.set("16,16", BLK);
      return d;
    },
  },
  {
    name: "Open",
    icon: "😮",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("15,15", BLK); d.set("16,15", BLK);
      d.set("15,16", BLK); d.set("16,16", BLK);
      return d;
    },
  },
  {
    name: "Grin",
    icon: "😁",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 14; x <= 17; x++) d.set(`${x},15`, BLK);
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// BODY STYLES (fills torso + arms)
// ══════════════════════════════════════════════════════

export const BODY_PARTS = [
  {
    name: "T-Shirt",
    icon: "👕",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutline(d);
      // Torso fill
      for (let y = 20; y <= 24; y++)
        for (let x = 12; x <= 19; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      // Arms fill
      for (let y = 20; y <= 26; y++)
        for (let x = 6; x <= 10; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      // Hand peek
      d.set("12,24", skin); d.set("21,24", skin);
      return d;
    },
  },
  {
    name: "Armor",
    icon: "🛡️",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutline(d);
      const grey = "#94A3B8";
      for (let y = 20; y <= 24; y++)
        for (let x = 12; x <= 19; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, grey);
      for (let y = 20; y <= 26; y++)
        for (let x = 6; x <= 10; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, grey);
      // Emblem
      d.set("15,22", outfit); d.set("16,22", outfit);
      d.set("15,23", outfit); d.set("16,23", outfit);
      d.set("12,24", skin); d.set("21,24", skin);
      return d;
    },
  },
  {
    name: "Suit",
    icon: "🤵",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutline(d);
      for (let y = 20; y <= 24; y++)
        for (let x = 12; x <= 19; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      for (let y = 20; y <= 26; y++)
        for (let x = 6; x <= 10; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      // White shirt
      d.set("15,20", "#FFFFFF"); d.set("16,20", "#FFFFFF");
      d.set("15,21", "#FFFFFF"); d.set("16,21", "#FFFFFF");
      // Tie
      d.set("15,22", "#D50000"); d.set("16,22", "#D50000");
      d.set("12,24", skin); d.set("21,24", skin);
      return d;
    },
  },
  {
    name: "Robe",
    icon: "🥋",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutline(d);
      for (let y = 20; y <= 24; y++)
        for (let x = 12; x <= 19; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      for (let y = 20; y <= 26; y++)
        for (let x = 6; x <= 10; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      // Belt
      for (let x = 12; x <= 19; x++) d.set(`${x},23`, "#8B4513");
      d.set("12,24", skin); d.set("21,24", skin);
      return d;
    },
  },
  {
    name: "Cape Hero",
    icon: "🦸",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutline(d);
      for (let y = 20; y <= 24; y++)
        for (let x = 12; x <= 19; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      for (let y = 20; y <= 26; y++)
        for (let x = 6; x <= 10; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      // Emblem star
      d.set("15,21", "#FFC42A"); d.set("16,21", "#FFC42A");
      d.set("14,22", "#FFC42A"); d.set("17,22", "#FFC42A");
      d.set("15,23", "#FFC42A"); d.set("16,23", "#FFC42A");
      d.set("12,24", skin); d.set("21,24", skin);
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// LEG / BOTTOM STYLES
// ══════════════════════════════════════════════════════

export const LEG_PARTS = [
  {
    name: "Pants",
    icon: "👖",
    build: (outfit: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 14; x <= 15; x++) { d.set(`${x},25`, outfit); d.set(`${x},26`, outfit); d.set(`${x},27`, outfit); d.set(`${x},28`, outfit); }
      for (let x = 18; x <= 19; x++) { d.set(`${x},25`, outfit); d.set(`${x},26`, outfit); d.set(`${x},27`, outfit); d.set(`${x},28`, outfit); }
      return d;
    },
  },
  {
    name: "Shorts",
    icon: "🩳",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 14; x <= 15; x++) { d.set(`${x},25`, outfit); d.set(`${x},26`, outfit); }
      for (let x = 18; x <= 19; x++) { d.set(`${x},25`, outfit); d.set(`${x},26`, outfit); }
      // Bare legs
      for (let x = 14; x <= 15; x++) { d.set(`${x},27`, skin); d.set(`${x},28`, skin); }
      for (let x = 18; x <= 19; x++) { d.set(`${x},27`, skin); d.set(`${x},28`, skin); }
      return d;
    },
  },
  {
    name: "Skirt",
    icon: "👗",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 12; x <= 19; x++) { d.set(`${x},25`, outfit); d.set(`${x},26`, outfit); }
      for (let x = 14; x <= 15; x++) { d.set(`${x},27`, skin); d.set(`${x},28`, skin); }
      for (let x = 18; x <= 19; x++) { d.set(`${x},27`, skin); d.set(`${x},28`, skin); }
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// SHOE STYLES
// ══════════════════════════════════════════════════════

export const SHOE_PARTS = [
  {
    name: "Boots",
    icon: "🥾",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,29", "#4A3728"); d.set("15,29", "#4A3728");
      d.set("18,29", "#4A3728"); d.set("19,29", "#4A3728");
      return d;
    },
  },
  {
    name: "Sneakers",
    icon: "👟",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,29", "#FFFFFF"); d.set("15,29", "#FFFFFF");
      d.set("18,29", "#FFFFFF"); d.set("19,29", "#FFFFFF");
      return d;
    },
  },
  {
    name: "Red Boots",
    icon: "🟥",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,29", "#D50000"); d.set("15,29", "#D50000");
      d.set("18,29", "#D50000"); d.set("19,29", "#D50000");
      return d;
    },
  },
  {
    name: "Gold",
    icon: "✨",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,29", "#FFC42A"); d.set("15,29", "#FFC42A");
      d.set("18,29", "#FFC42A"); d.set("19,29", "#FFC42A");
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// ACCESSORIES
// ══════════════════════════════════════════════════════

export const ACCESSORY_PARTS = [
  {
    name: "None",
    icon: "❌",
    build: (): PixelMap => new Map(),
  },
  {
    name: "Crown",
    icon: "👑",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("13,4", "#FFC42A"); d.set("15,4", "#FFC42A"); d.set("17,4", "#FFC42A"); d.set("19,4", "#FFC42A");
      d.set("13,5", "#FFC42A"); d.set("14,5", "#FFC42A"); d.set("15,5", "#FFC42A"); d.set("16,5", "#FFC42A"); d.set("17,5", "#FFC42A"); d.set("18,5", "#FFC42A"); d.set("19,5", "#FFC42A");
      return d;
    },
  },
  {
    name: "Halo",
    icon: "😇",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("13,3", "#FFC42A"); d.set("14,3", "#FFC42A"); d.set("15,3", "#FFC42A"); d.set("16,3", "#FFC42A"); d.set("17,3", "#FFC42A"); d.set("18,3", "#FFC42A");
      d.set("12,4", "#FFC42A"); d.set("19,4", "#FFC42A");
      return d;
    },
  },
  {
    name: "Cape",
    icon: "🦸",
    build: (outfit: string): PixelMap => {
      const d: PixelMap = new Map();
      // Cape behind hero
      for (let y = 19; y <= 27; y++) { d.set(`23,${y}`, outfit); d.set(`24,${y}`, outfit); }
      d.set("25,22", outfit); d.set("25,23", outfit); d.set("25,24", outfit);
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// COMPOSITE FUNCTION — layers all parts correctly
// ══════════════════════════════════════════════════════

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

  const layers = [
    ACCESSORY_PARTS[accessoryIdx]?.build(outfitColor), // back (cape)
    BODY_PARTS[bodyIdx]?.build(outfitColor, skinColor),
    LEG_PARTS[legIdx]?.build(outfitColor, skinColor),
    SHOE_PARTS[shoeIdx]?.build(),
    HEAD_PARTS[headIdx]?.build(skinColor),
    HAIR_PARTS[hairIdx]?.build(hairColor),
    EYE_PARTS[eyeIdx]?.build(),
    MOUTH_PARTS[mouthIdx]?.build(),
  ];

  layers.forEach((layer) => {
    if (!layer) return;
    layer.forEach((color, key) => result.set(key, color));
  });

  return result;
}
