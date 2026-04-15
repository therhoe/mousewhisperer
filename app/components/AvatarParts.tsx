// Avatar part definitions for the character builder — outlined pixel art style
// Matches the chunky black-outlined art of newhero/newcrofly

type PixelMap = Map<string, string>;

const BLK = "#000000";

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
// HEAD SHAPES — use the exact hero/crofly outline shape
// ══════════════════════════════════════════════════════

function drawStandardHeadOutline(d: PixelMap) {
  // Top
  d.set("14,5", BLK); d.set("15,5", BLK); d.set("16,5", BLK); d.set("17,5", BLK);
  d.set("12,6", BLK); d.set("13,6", BLK); d.set("18,6", BLK); d.set("19,6", BLK); d.set("20,6", BLK);
  d.set("11,7", BLK); d.set("21,7", BLK);
  d.set("11,8", BLK); d.set("21,8", BLK);
  // Left side
  d.set("11,9", BLK); d.set("11,10", BLK);
  d.set("11,11", BLK); d.set("11,12", BLK); d.set("11,13", BLK);
  d.set("10,14", BLK); d.set("10,15", BLK);
  d.set("11,16", BLK); d.set("11,17", BLK);
  d.set("12,18", BLK);
  // Right side
  d.set("22,9", BLK); d.set("22,10", BLK);
  d.set("22,11", BLK); d.set("22,12", BLK); d.set("22,13", BLK);
  d.set("22,14", BLK); d.set("22,15", BLK); d.set("22,16", BLK); d.set("22,17", BLK);
  d.set("21,18", BLK);
}

function fillFace(d: PixelMap, skin: string) {
  for (let y = 7; y <= 18; y++)
    for (let x = 12; x <= 21; x++)
      if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, skin);
  for (let x = 13; x <= 19; x++) if (!d.has(`${x},6`)) d.set(`${x},6`, skin);
}

export const HEAD_PARTS = [
  {
    name: "Standard",
    icon: "🟢",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawStandardHeadOutline(d);
      fillFace(d, skin);
      return d;
    },
  },
  {
    name: "Round",
    icon: "⚪",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      // Slightly rounder top
      d.set("14,5", BLK); d.set("15,5", BLK); d.set("16,5", BLK); d.set("17,5", BLK);
      d.set("12,6", BLK); d.set("13,6", BLK); d.set("18,6", BLK); d.set("19,6", BLK);
      d.set("11,7", BLK); d.set("20,7", BLK);
      d.set("11,8", BLK); d.set("20,8", BLK);
      for (let y = 9; y <= 17; y++) { d.set(`11,${y}`, BLK); d.set(`20,${y}`, BLK); }
      d.set("12,18", BLK); d.set("19,18", BLK);
      for (let y = 7; y <= 18; y++)
        for (let x = 12; x <= 19; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, skin);
      for (let x = 13; x <= 18; x++) if (!d.has(`${x},6`)) d.set(`${x},6`, skin);
      return d;
    },
  },
  {
    name: "Square",
    icon: "🟧",
    build: (skin: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 12; x <= 20; x++) d.set(`${x},6`, BLK);
      for (let y = 7; y <= 17; y++) { d.set(`11,${y}`, BLK); d.set(`21,${y}`, BLK); }
      for (let x = 12; x <= 20; x++) d.set(`${x},18`, BLK);
      for (let y = 7; y <= 17; y++)
        for (let x = 12; x <= 20; x++)
          d.set(`${x},${y}`, skin);
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
      for (let x = 13; x <= 19; x++) d.set(`${x},6`, hair);
      for (let x = 12; x <= 20; x++) { d.set(`${x},7`, hair); d.set(`${x},8`, hair); }
      return d;
    },
  },
  {
    name: "Messy",
    icon: "🌊",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      d.set("13,5", hair); d.set("17,5", hair); d.set("19,5", hair);
      for (let x = 13; x <= 19; x++) d.set(`${x},6`, hair);
      for (let x = 12; x <= 20; x++) { d.set(`${x},7`, hair); d.set(`${x},8`, hair); }
      d.set("12,9", hair); d.set("20,9", hair);
      return d;
    },
  },
  {
    name: "Long",
    icon: "👩",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 13; x <= 19; x++) d.set(`${x},6`, hair);
      for (let x = 12; x <= 20; x++) { d.set(`${x},7`, hair); d.set(`${x},8`, hair); }
      d.set("12,9", hair); d.set("20,9", hair);
      d.set("12,10", hair); d.set("21,10", hair);
      d.set("12,11", hair); d.set("21,11", hair);
      d.set("12,12", hair); d.set("21,12", hair);
      return d;
    },
  },
  {
    name: "Side Hair",
    icon: "💁",
    build: (hair: string): PixelMap => {
      // Crofly-style: tall puff on top-left + hair on top
      const d: PixelMap = new Map();
      d.set("7,5", hair); d.set("8,5", hair); d.set("9,5", hair); d.set("10,5", hair);
      d.set("7,6", hair); d.set("10,6", hair);
      d.set("7,7", hair); d.set("8,7", hair); d.set("9,7", hair);
      for (let x = 13; x <= 18; x++) { d.set(`${x},6`, hair); d.set(`${x},7`, hair); }
      for (let x = 12; x <= 20; x++) d.set(`${x},8`, hair);
      for (let x = 12; x <= 14; x++) d.set(`${x},9`, hair);
      d.set("12,10", hair); d.set("13,10", hair); d.set("14,10", hair);
      return d;
    },
  },
  {
    name: "Mohawk",
    icon: "🦔",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let y = 3; y <= 5; y++) { d.set(`15,${y}`, hair); d.set(`16,${y}`, hair); }
      for (let x = 14; x <= 17; x++) { d.set(`${x},6`, hair); d.set(`${x},7`, hair); }
      for (let x = 12; x <= 20; x++) d.set(`${x},8`, hair);
      return d;
    },
  },
  {
    name: "Curly",
    icon: "🌀",
    build: (hair: string): PixelMap => {
      const d: PixelMap = new Map();
      d.set("12,5", hair); d.set("14,5", hair); d.set("16,5", hair); d.set("18,5", hair); d.set("20,5", hair);
      for (let x = 11; x <= 21; x++) { d.set(`${x},6`, hair); d.set(`${x},7`, hair); }
      for (let x = 12; x <= 20; x++) d.set(`${x},8`, hair);
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
// EYE STYLES (2x2 blocks on face — positions match hero/crofly)
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
      for (let y = 10; y <= 12; y++) {
        d.set(`14,${y}`, BLK); d.set(`15,${y}`, BLK);
        d.set(`17,${y}`, BLK); d.set(`18,${y}`, BLK);
      }
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
      for (let x = 13; x <= 16; x++) { d.set(`${x},10`, BLK); d.set(`${x},11`, BLK); }
      for (let x = 17; x <= 20; x++) { d.set(`${x},10`, BLK); d.set(`${x},11`, BLK); }
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// MOUTH STYLES (matches 2-pixel mouth from hero/crofly)
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
// BODY OUTLINES
// ══════════════════════════════════════════════════════

function drawBodyOutlineNoCape(d: PixelMap) {
  d.set("10,19", BLK); d.set("11,19", BLK);
  for (let x = 13; x <= 20; x++) d.set(`${x},19`, BLK);
  d.set("12,18", BLK); d.set("21,18", BLK);
  // Symmetric left arm
  d.set("10,20", BLK); d.set("12,20", BLK); d.set("13,20", BLK);
  d.set("9,21", BLK); d.set("11,21", BLK);
  d.set("9,22", BLK); d.set("11,22", BLK);
  d.set("9,23", BLK); d.set("11,23", BLK);
  d.set("9,24", BLK); d.set("11,24", BLK);
  d.set("9,25", BLK); d.set("10,25", BLK); d.set("11,25", BLK); d.set("12,25", BLK); d.set("13,25", BLK);
  d.set("11,26", BLK); d.set("12,26", BLK); d.set("13,26", BLK);
  d.set("11,27", BLK); d.set("13,27", BLK);
  // Right arm
  d.set("20,20", BLK); d.set("21,20", BLK);
  d.set("22,21", BLK);
  d.set("20,22", BLK); d.set("22,22", BLK);
  d.set("20,23", BLK); d.set("22,23", BLK);
  d.set("20,24", BLK); d.set("22,24", BLK);
  d.set("16,25", BLK); d.set("17,25", BLK); d.set("20,25", BLK); d.set("21,25", BLK); d.set("22,25", BLK);
  d.set("20,26", BLK);
  d.set("20,27", BLK);
  // Legs
  d.set("13,28", BLK); d.set("16,28", BLK); d.set("17,28", BLK); d.set("20,28", BLK);
  d.set("13,29", BLK); d.set("14,29", BLK); d.set("15,29", BLK);
  d.set("18,29", BLK); d.set("19,29", BLK); d.set("20,29", BLK);
}

function drawBodyOutlineWithCape(d: PixelMap) {
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

// ══════════════════════════════════════════════════════
// BODY STYLES (torso + arms — always uses no-cape outline)
// ══════════════════════════════════════════════════════

function fillTorsoAndArms(d: PixelMap, outfit: string, skin: string) {
  // Torso fill
  for (let y = 20; y <= 24; y++)
    for (let x = 12; x <= 19; x++)
      if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
  // Left arm fill
  d.set("10,21", outfit); d.set("10,22", outfit); d.set("10,23", outfit); d.set("10,24", outfit);
  // Right arm fill
  d.set("21,21", outfit); d.set("21,22", outfit); d.set("21,23", outfit);
  // Hands
  d.set("12,24", skin); d.set("21,24", skin);
}

export const BODY_PARTS = [
  {
    name: "T-Shirt",
    icon: "👕",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutlineNoCape(d);
      fillTorsoAndArms(d, outfit, skin);
      return d;
    },
  },
  {
    name: "Armor",
    icon: "🛡️",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutlineNoCape(d);
      const grey = "#94A3B8";
      for (let y = 20; y <= 24; y++)
        for (let x = 12; x <= 19; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, grey);
      d.set("10,21", grey); d.set("10,22", grey); d.set("10,23", grey); d.set("10,24", grey);
      d.set("21,21", grey); d.set("21,22", grey); d.set("21,23", grey);
      // Emblem center
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
      drawBodyOutlineNoCape(d);
      fillTorsoAndArms(d, outfit, skin);
      // White shirt
      d.set("15,20", "#FFFFFF"); d.set("16,20", "#FFFFFF");
      d.set("15,21", "#FFFFFF"); d.set("16,21", "#FFFFFF");
      // Tie
      d.set("15,22", "#D50000"); d.set("16,22", "#D50000");
      return d;
    },
  },
  {
    name: "Robe",
    icon: "🥋",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutlineNoCape(d);
      fillTorsoAndArms(d, outfit, skin);
      // Belt
      for (let x = 12; x <= 19; x++) d.set(`${x},23`, "#8B4513");
      d.set("10,23", "#8B4513"); d.set("21,23", "#8B4513");
      return d;
    },
  },
  {
    name: "Cape Hero",
    icon: "🦸",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      drawBodyOutlineWithCape(d);
      // Torso
      for (let y = 20; y <= 24; y++)
        for (let x = 12; x <= 19; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, outfit);
      // Cape fill (left side)
      for (let y = 20; y <= 26; y++)
        for (let x = 6; x <= 10; x++)
          if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, "#D50000");
      // Right arm
      d.set("21,21", outfit); d.set("21,22", outfit); d.set("21,23", outfit);
      // Emblem star
      d.set("15,21", "#FFC42A"); d.set("16,21", "#FFC42A");
      d.set("12,24", skin); d.set("21,24", skin);
      return d;
    },
  },
];

// ══════════════════════════════════════════════════════
// LEG STYLES
// ══════════════════════════════════════════════════════

export const LEG_PARTS = [
  {
    name: "Pants",
    icon: "👖",
    build: (outfit: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let y = 25; y <= 26; y++)
        for (let x = 14; x <= 19; x++)
          d.set(`${x},${y}`, outfit);
      for (let x = 14; x <= 15; x++) { d.set(`${x},27`, outfit); d.set(`${x},28`, outfit); }
      for (let x = 18; x <= 19; x++) { d.set(`${x},27`, outfit); d.set(`${x},28`, outfit); }
      return d;
    },
  },
  {
    name: "Shorts",
    icon: "🩳",
    build: (outfit: string, skin: string): PixelMap => {
      const d: PixelMap = new Map();
      for (let y = 25; y <= 26; y++)
        for (let x = 14; x <= 19; x++)
          d.set(`${x},${y}`, outfit);
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
      for (let y = 25; y <= 26; y++)
        for (let x = 13; x <= 20; x++)
          d.set(`${x},${y}`, outfit);
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
    name: "Dark",
    icon: "🥾",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,29", "#4A3728"); d.set("15,29", "#4A3728");
      d.set("18,29", "#4A3728"); d.set("19,29", "#4A3728");
      return d;
    },
  },
  {
    name: "White",
    icon: "👟",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      d.set("14,29", "#FFFFFF"); d.set("15,29", "#FFFFFF");
      d.set("18,29", "#FFFFFF"); d.set("19,29", "#FFFFFF");
      return d;
    },
  },
  {
    name: "Red",
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
      for (let x = 13; x <= 19; x++) d.set(`${x},5`, "#FFC42A");
      return d;
    },
  },
  {
    name: "Halo",
    icon: "😇",
    build: (): PixelMap => {
      const d: PixelMap = new Map();
      for (let x = 13; x <= 18; x++) d.set(`${x},3`, "#FFC42A");
      d.set("12,4", "#FFC42A"); d.set("19,4", "#FFC42A");
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
    BODY_PARTS[bodyIdx]?.build(outfitColor, skinColor),
    LEG_PARTS[legIdx]?.build(outfitColor, skinColor),
    SHOE_PARTS[shoeIdx]?.build(),
    HEAD_PARTS[headIdx]?.build(skinColor),
    HAIR_PARTS[hairIdx]?.build(hairColor),
    EYE_PARTS[eyeIdx]?.build(),
    MOUTH_PARTS[mouthIdx]?.build(),
    ACCESSORY_PARTS[accessoryIdx]?.build(),
  ];

  layers.forEach((layer) => {
    if (!layer) return;
    layer.forEach((color, key) => result.set(key, color));
  });

  return result;
}
