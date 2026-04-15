import { useState, useCallback } from "react";
import { Text, Button, InlineStack, BlockStack } from "@shopify/polaris";
import {
  SKIN_TONES, HAIR_COLORS, OUTFIT_COLORS,
  HAIR_STYLES, EYE_STYLES, MOUTH_STYLES, ACCESSORIES, CAPE_OPTIONS,
  compositeCharacter,
} from "./AvatarParts";

const GRID_SIZE = 32;
const CELL_PX = 12;
const BLK = "#000000";

const PALETTE = [
  // Skin tones (light to dark)
  "#FFE6C7", "#FFDBB4", "#FFCD94", "#F1C27D", "#E0AC69", "#C68642", "#A57548", "#8D5524", "#6F4E37", "#4E342E", "#3E2723",
  // Hair
  "#1A1A2E", "#2C1810", "#3D2314", "#4A3728", "#6F4E37", "#8B4513", "#A0522D", "#B8860B", "#C4A35A", "#E8D5B7", "#D94000", "#C1272D",
  "#94A3B8", "#E8E8E8", "#B8C5D6",
  // Reds & pinks
  "#D50000", "#850000", "#FF1744", "#EC4899", "#FF6B9D", "#FFB3C1",
  // Oranges & yellows
  "#E8963A", "#FF9100", "#FFC42A", "#FFEB3B", "#FFF59D",
  // Greens
  "#A4DD00", "#29845A", "#14B8A6", "#2E7D32", "#81C784", "#004D40",
  // Blues & cyans
  "#06B6D4", "#2979FF", "#2C6ECB", "#1E3A5F", "#0F1E3C", "#448AFF", "#80DEEA",
  // Purples
  "#8B5CF6", "#6D28D9", "#311B92", "#B388FF",
  // Browns & beiges
  "#D4B896", "#C4A35A", "#8B4513", "#5C3310",
  // Metals
  "#FFD700", "#C0C0C0", "#CD7F32", "#B87333",
  // Greys & neutrals
  "#F0F0F0", "#E4E5E7", "#BDBDBD", "#94A3B8", "#757575", "#4A5568", "#1A1A2E", "#000000", "#FFFFFF",
  // Eraser
  "transparent",
];


// ══════════════════════════════════════════════════════
// CROFLY PIXEL TEMPLATE — exact coordinates grouped by region
// Used as the base shape for all generated characters
// ══════════════════════════════════════════════════════

const CROFLY_OUTLINE: [number, number][] = [[7,5],[8,5],[9,5],[10,5],[6,6],[11,6],[13,6],[14,6],[15,6],[16,6],[17,6],[18,6],[6,7],[8,7],[9,7],[12,7],[19,7],[20,7],[6,8],[7,8],[9,8],[10,8],[11,8],[21,8],[11,9],[22,9],[10,10],[22,10],[10,11],[22,11],[10,12],[22,12],[10,13],[16,13],[19,13],[22,13],[10,14],[16,14],[19,14],[22,14],[10,15],[22,15],[11,16],[22,16],[11,17],[16,17],[17,17],[22,17],[12,18],[21,18],[10,19],[11,19],[13,19],[14,19],[15,19],[16,19],[17,19],[18,19],[19,19],[20,19],[9,20],[12,20],[13,20],[20,20],[21,20],[8,21],[11,21],[22,21],[7,22],[8,22],[11,22],[20,22],[22,22],[7,23],[11,23],[13,23],[20,23],[22,23],[6,24],[11,24],[13,24],[20,24],[22,24],[6,25],[11,25],[12,25],[13,25],[16,25],[17,25],[20,25],[21,25],[22,25],[5,26],[12,26],[13,26],[20,26],[5,27],[6,27],[7,27],[8,27],[9,27],[10,27],[11,27],[13,27],[20,27],[13,28],[16,28],[17,28],[20,28],[13,29],[14,29],[15,29],[18,29],[19,29],[20,29]];
const CROFLY_HAIR: [number, number][] = [[7,6],[8,6],[9,6],[10,6],[7,7],[10,7],[11,7],[13,7],[14,7],[15,7],[16,7],[17,7],[18,7],[12,8],[13,8],[14,8],[15,8],[16,8],[17,8],[18,8],[19,8],[20,8],[12,9],[13,9],[14,9],[15,9],[16,9],[17,9],[18,9],[19,9],[20,9],[21,9],[11,10],[12,10],[13,10],[14,10],[16,10],[17,10],[18,10],[21,10],[11,11],[11,12],[11,13],[11,14],[11,15]];
const CROFLY_SKIN: [number, number][] = [[15,10],[19,10],[20,10],[12,11],[13,11],[14,11],[15,11],[16,11],[17,11],[18,11],[19,11],[20,11],[21,11],[12,12],[13,12],[14,12],[15,12],[16,12],[17,12],[18,12],[19,12],[20,12],[21,12],[12,13],[13,13],[14,13],[15,13],[17,13],[18,13],[20,13],[21,13],[12,14],[13,14],[14,14],[15,14],[17,14],[18,14],[20,14],[21,14],[12,15],[13,15],[14,15],[15,15],[16,15],[17,15],[18,15],[19,15],[20,15],[21,15],[12,16],[13,16],[14,16],[15,16],[16,16],[17,16],[18,16],[19,16],[20,16],[21,16],[12,17],[13,17],[14,17],[15,17],[18,17],[19,17],[20,17],[21,17],[13,18],[14,18],[15,18],[16,18],[17,18],[18,18],[19,18],[20,18],[12,24],[21,24]];
const CROFLY_TOP: [number, number][] = [[16,20],[17,20],[14,21],[15,21],[16,21],[17,21],[18,21],[19,21],[12,22],[13,22],[14,22],[15,22],[17,22],[18,22],[19,22],[21,22],[12,23],[14,23],[15,23],[16,23],[18,23],[19,23],[21,23],[14,24],[15,24],[16,24],[17,24],[18,24],[19,24],[14,26],[15,26],[16,26],[17,26],[18,26],[19,26],[14,27],[15,27],[18,27],[19,27]];
// Left side region (cape or arm depending on character)
const CROFLY_LEFT: [number, number][] = [[14,20],[15,20],[18,20],[19,20],[10,21],[12,21],[13,21],[20,21],[21,21],[9,22],[10,22],[8,23],[9,23],[10,23],[7,24],[8,24],[9,24],[7,25],[8,25],[6,26],[7,26],[16,27],[17,27],[14,28],[15,28],[18,28],[19,28]];
const CROFLY_LEFT_SHADOW: [number, number][] = [[10,20],[9,21],[10,24],[9,25],[10,25],[8,26],[9,26],[10,26],[11,26]];
const CROFLY_LEFT_HIGHLIGHT: [number, number][] = [[12,19],[11,20]];
const CROFLY_ACCENT: [number, number][] = [[16,22],[17,23],[14,25],[15,25],[18,25],[19,25]];

// Darken a hex color for shadow effect
function darken(hex: string, amount = 40): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function lighten(hex: string, amount = 30): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Head outline (matches exact hero/crofly shape) ──
function drawHeadOutline(d: Map<string, string>) {
  // Top of head outline — exact from newhero
  d.set("14,5", BLK); d.set("15,5", BLK); d.set("16,5", BLK); d.set("17,5", BLK);
  d.set("12,6", BLK); d.set("13,6", BLK); d.set("18,6", BLK); d.set("19,6", BLK); d.set("20,6", BLK);
  d.set("11,7", BLK); d.set("21,7", BLK);
  d.set("11,8", BLK); d.set("21,8", BLK);
  // Left side
  d.set("11,9", BLK); d.set("11,10", BLK);
  d.set("11,11", BLK); d.set("11,12", BLK); d.set("11,13", BLK);
  d.set("10,14", BLK); d.set("10,15", BLK); // jaw bulge
  d.set("11,16", BLK); d.set("11,17", BLK);
  d.set("12,18", BLK);
  // Right side
  d.set("22,9", BLK); d.set("22,10", BLK);
  d.set("22,11", BLK); d.set("22,12", BLK); d.set("22,13", BLK);
  d.set("22,14", BLK); d.set("22,15", BLK); d.set("22,16", BLK); d.set("22,17", BLK);
  d.set("21,18", BLK);
  // Bottom — neck transition
  d.set("13,19", BLK); d.set("14,19", BLK); d.set("15,19", BLK); d.set("16,19", BLK);
  d.set("17,19", BLK); d.set("18,19", BLK); d.set("19,19", BLK); d.set("20,19", BLK);
}

// ── Body outline WITH cape (matches newhero/newcrofly exactly) ──
function drawBodyOutlineWithCape(d: Map<string, string>) {
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

// ── Body outline WITHOUT cape (symmetric arms) ──
function drawBodyOutlineNoCape(d: Map<string, string>) {
  // Shoulders
  d.set("10,19", BLK); d.set("11,19", BLK);
  // Left arm — symmetric to right arm
  d.set("10,20", BLK); d.set("12,20", BLK); d.set("13,20", BLK);
  d.set("9,21", BLK); d.set("11,21", BLK);
  d.set("9,22", BLK); d.set("11,22", BLK);
  d.set("9,23", BLK); d.set("11,23", BLK);
  d.set("9,24", BLK); d.set("11,24", BLK);
  d.set("9,25", BLK); d.set("10,25", BLK); d.set("11,25", BLK); d.set("12,25", BLK); d.set("13,25", BLK);
  d.set("11,26", BLK); d.set("12,26", BLK); d.set("13,26", BLK);
  d.set("11,27", BLK); d.set("13,27", BLK);
  // Right arm — existing
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

type CharOpts = {
  skin: string;
  hair: string;
  top: string;   // main shirt/body color
  left: string;  // left-side region (cape/sleeve) — often same as top
  accent: string; // belt/emblem/boots highlight
  noHairPuff?: boolean; // if true, use hero's hair layout (no top-left puff)
};

// Generate a character using Crofly's exact outline shape
function generateOutlinedCharacter(opts: CharOpts): Map<string, string> {
  const d = new Map<string, string>();
  const { skin, hair, top, left, accent, noHairPuff } = opts;

  // Draw black outline
  CROFLY_OUTLINE.forEach(([x, y]) => d.set(`${x},${y}`, BLK));
  // Fill skin region
  CROFLY_SKIN.forEach(([x, y]) => d.set(`${x},${y}`, skin));
  // Fill hair region (including top-left puff)
  if (noHairPuff) {
    // Hero-style: skip top-left puff positions (7-10, 5-8)
    CROFLY_HAIR.forEach(([x, y]) => {
      if (!(x >= 7 && x <= 10 && y >= 5 && y <= 8)) {
        d.set(`${x},${y}`, hair);
      }
    });
  } else {
    CROFLY_HAIR.forEach(([x, y]) => d.set(`${x},${y}`, hair));
  }
  // Fill top (torso/shirt)
  CROFLY_TOP.forEach(([x, y]) => d.set(`${x},${y}`, top));
  // Fill left side (cape or sleeve)
  CROFLY_LEFT.forEach(([x, y]) => d.set(`${x},${y}`, left));
  CROFLY_LEFT_SHADOW.forEach(([x, y]) => d.set(`${x},${y}`, darken(left, 40)));
  CROFLY_LEFT_HIGHLIGHT.forEach(([x, y]) => d.set(`${x},${y}`, lighten(left, 10)));
  // Accent pixels (belt, boots)
  CROFLY_ACCENT.forEach(([x, y]) => d.set(`${x},${y}`, accent));

  return d;
}

const PREMADE_AVATARS = [
  // Exact from .pixil files
  { name: "Hero", data: generateNewHero() },
  { name: "Crofly", data: generateNewCrofly() },
  // Caped characters (left region is a cape)
  { name: "Super", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#1A1A2E", top: "#2979FF", left: "#D50000", accent: "#FFC42A", noHairPuff: true }) },
  { name: "Mage", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#C4A35A", top: "#8B5CF6", left: "#6D28D9", accent: "#FFC42A", noHairPuff: true }) },
  { name: "Wizard", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#E8E8E8", top: "#1E3A5F", left: "#1E3A5F", accent: "#FFC42A", noHairPuff: true }) },
  { name: "Healer", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#D94000", top: "#F0F0F0", left: "#D50000", accent: "#D50000", noHairPuff: true }) },
  { name: "Champion", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#2C1810", top: "#FFC42A", left: "#29845A", accent: "#D50000", noHairPuff: true }) },
  // Characters with Crofly-style left sleeve (top puff hair)
  { name: "Knight", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#2C1810", top: "#94A3B8", left: "#94A3B8", accent: "#FFC42A" }) },
  { name: "Ranger", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#8B6914", top: "#29845A", left: "#29845A", accent: "#C4A35A" }) },
  { name: "Rogue", data: generateOutlinedCharacter({ skin: "#C8956C", hair: "#1A1A2E", top: "#1A1A2E", left: "#1A1A2E", accent: "#4A3728" }) },
  { name: "Viking", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#B8860B", top: "#8B4513", left: "#8B4513", accent: "#94A3B8" }) },
  { name: "Pirate", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#2C1810", top: "#D50000", left: "#D50000", accent: "#FFC42A" }) },
  { name: "Warrior", data: generateOutlinedCharacter({ skin: "#8D5524", hair: "#2C1810", top: "#D50000", left: "#D50000", accent: "#94A3B8" }) },
  { name: "Bard", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#D94000", top: "#29845A", left: "#29845A", accent: "#FFC42A" }) },
  { name: "Executive", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#3D2314", top: "#1E3A5F", left: "#1E3A5F", accent: "#FFFFFF" }) },
  { name: "Casual", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#8B4513", top: "#5B9BD5", left: "#5B9BD5", accent: "#FFFFFF" }) },
  { name: "Medic", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#8B4513", top: "#FFC42A", left: "#FFC42A", accent: "#D50000" }) },
  { name: "Student", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#8B4513", top: "#5B9BD5", left: "#5B9BD5", accent: "#FFFFFF" }) },
  { name: "Elder", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#94A3B8", top: "#F5F5F5", left: "#F5F5F5", accent: "#8B4513" }) },
  { name: "Chill", data: generateOutlinedCharacter({ skin: "#FFDBB4", hair: "#5C2E00", top: "#E8963A", left: "#E8963A", accent: "#FFC42A" }) },
];

// Simple character generator helpers
function drawRect(data: Map<string, string>, x: number, y: number, w: number, h: number, color: string) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      data.set(`${x + dx},${y + dy}`, color);
    }
  }
}

// ══════════════════════════════════════════════════════
// OUTLINED CHARACTER SYSTEM
// Matches the chunky black-outlined pixel art style of newhero / newcrofly
// Shared body template: arms extend out with hands, two legs with gap
// ══════════════════════════════════════════════════════

// ── Exact pre-mades from .pixil files ──
function generateNewHero(): Map<string, string> {
  const d = new Map<string, string>();
  d.set("17,5", "#000000");
  d.set("18,5", "#000000");
  d.set("19,5", "#000000");
  d.set("15,6", "#000000");
  d.set("16,6", "#000000");
  d.set("17,6", "#000000");
  d.set("18,6", "#000000");
  d.set("19,6", "#000000");
  d.set("20,6", "#000000");
  d.set("13,7", "#000000");
  d.set("14,7", "#000000");
  d.set("15,7", "#000000");
  d.set("16,7", "#000000");
  d.set("17,7", "#000000");
  d.set("18,7", "#000000");
  d.set("19,7", "#000000");
  d.set("20,7", "#000000");
  d.set("21,7", "#000000");
  d.set("12,8", "#000000");
  d.set("13,8", "#000000");
  d.set("14,8", "#000000");
  d.set("15,8", "#000000");
  d.set("16,8", "#000000");
  d.set("17,8", "#000000");
  d.set("18,8", "#000000");
  d.set("19,8", "#000000");
  d.set("20,8", "#000000");
  d.set("21,8", "#000000");
  d.set("11,9", "#000000");
  d.set("12,9", "#000000");
  d.set("13,9", "#000000");
  d.set("14,9", "#000000");
  d.set("15,9", "#000000");
  d.set("16,9", "#000000");
  d.set("17,9", "#000000");
  d.set("18,9", "#000000");
  d.set("19,9", "#000000");
  d.set("20,9", "#000000");
  d.set("21,9", "#000000");
  d.set("22,9", "#000000");
  d.set("11,10", "#000000");
  d.set("12,10", "#000000");
  d.set("13,10", "#000000");
  d.set("14,10", "#FFCD94");
  d.set("15,10", "#000000");
  d.set("16,10", "#000000");
  d.set("17,10", "#000000");
  d.set("18,10", "#000000");
  d.set("19,10", "#000000");
  d.set("20,10", "#000000");
  d.set("21,10", "#000000");
  d.set("22,10", "#000000");
  d.set("11,11", "#000000");
  d.set("12,11", "#FFCD94");
  d.set("13,11", "#FFCD94");
  d.set("14,11", "#FFCD94");
  d.set("15,11", "#FFCD94");
  d.set("16,11", "#FFCD94");
  d.set("17,11", "#FFCD94");
  d.set("18,11", "#000000");
  d.set("19,11", "#FFCD94");
  d.set("20,11", "#FFCD94");
  d.set("21,11", "#FFCD94");
  d.set("22,11", "#000000");
  d.set("11,12", "#000000");
  d.set("12,12", "#FFCD94");
  d.set("13,12", "#FFCD94");
  d.set("14,12", "#FFCD94");
  d.set("15,12", "#FFCD94");
  d.set("16,12", "#FFCD94");
  d.set("17,12", "#FFCD94");
  d.set("18,12", "#FFCD94");
  d.set("19,12", "#FFCD94");
  d.set("20,12", "#FFCD94");
  d.set("21,12", "#FFCD94");
  d.set("22,12", "#000000");
  d.set("11,13", "#000000");
  d.set("12,13", "#FFCD94");
  d.set("13,13", "#FFCD94");
  d.set("14,13", "#FFCD94");
  d.set("15,13", "#FFCD94");
  d.set("16,13", "#FFCD94");
  d.set("17,13", "#FFCD94");
  d.set("18,13", "#FFCD94");
  d.set("19,13", "#FFCD94");
  d.set("20,13", "#FFCD94");
  d.set("21,13", "#FFCD94");
  d.set("22,13", "#000000");
  d.set("10,14", "#000000");
  d.set("11,14", "#FFCD94");
  d.set("12,14", "#FFCD94");
  d.set("13,14", "#FFCD94");
  d.set("14,14", "#FFCD94");
  d.set("15,14", "#000000");
  d.set("16,14", "#FFCD94");
  d.set("17,14", "#FFCD94");
  d.set("18,14", "#FFCD94");
  d.set("19,14", "#000000");
  d.set("20,14", "#FFCD94");
  d.set("21,14", "#FFCD94");
  d.set("22,14", "#000000");
  d.set("10,15", "#000000");
  d.set("11,15", "#FFCD94");
  d.set("12,15", "#FFCD94");
  d.set("13,15", "#FFCD94");
  d.set("14,15", "#FFCD94");
  d.set("15,15", "#FFCD94");
  d.set("16,15", "#FFCD94");
  d.set("17,15", "#FFCD94");
  d.set("18,15", "#FFCD94");
  d.set("19,15", "#FFCD94");
  d.set("20,15", "#FFCD94");
  d.set("21,15", "#FFCD94");
  d.set("22,15", "#000000");
  d.set("11,16", "#000000");
  d.set("12,16", "#FFCD94");
  d.set("13,16", "#FFCD94");
  d.set("14,16", "#FFCD94");
  d.set("15,16", "#FFCD94");
  d.set("16,16", "#000000");
  d.set("17,16", "#000000");
  d.set("18,16", "#000000");
  d.set("19,16", "#FFCD94");
  d.set("20,16", "#FFCD94");
  d.set("21,16", "#FFCD94");
  d.set("22,16", "#000000");
  d.set("11,17", "#000000");
  d.set("12,17", "#FFCD94");
  d.set("13,17", "#FFCD94");
  d.set("14,17", "#FFCD94");
  d.set("15,17", "#FFCD94");
  d.set("16,17", "#FFCD94");
  d.set("17,17", "#FFCD94");
  d.set("18,17", "#FFCD94");
  d.set("19,17", "#FFCD94");
  d.set("20,17", "#FFCD94");
  d.set("21,17", "#FFCD94");
  d.set("22,17", "#000000");
  d.set("12,18", "#000000");
  d.set("13,18", "#FFCD94");
  d.set("14,18", "#FFCD94");
  d.set("15,18", "#FFCD94");
  d.set("16,18", "#FFCD94");
  d.set("17,18", "#FFCD94");
  d.set("18,18", "#FFCD94");
  d.set("19,18", "#FFCD94");
  d.set("20,18", "#F1C27D");
  d.set("21,18", "#000000");
  d.set("10,19", "#000000");
  d.set("11,19", "#000000");
  d.set("12,19", "#D50000");
  d.set("13,19", "#000000");
  d.set("14,19", "#000000");
  d.set("15,19", "#000000");
  d.set("16,19", "#000000");
  d.set("17,19", "#000000");
  d.set("18,19", "#000000");
  d.set("19,19", "#000000");
  d.set("20,19", "#000000");
  d.set("9,20", "#000000");
  d.set("10,20", "#850000");
  d.set("11,20", "#D50000");
  d.set("12,20", "#000000");
  d.set("13,20", "#000000");
  d.set("14,20", "#D50000");
  d.set("15,20", "#D50000");
  d.set("16,20", "#2979FF");
  d.set("17,20", "#2979FF");
  d.set("18,20", "#D50000");
  d.set("19,20", "#D50000");
  d.set("20,20", "#000000");
  d.set("21,20", "#000000");
  d.set("8,21", "#000000");
  d.set("9,21", "#850000");
  d.set("10,21", "#D50000");
  d.set("11,21", "#000000");
  d.set("12,21", "#D50000");
  d.set("13,21", "#D50000");
  d.set("14,21", "#2979FF");
  d.set("15,21", "#2979FF");
  d.set("16,21", "#2979FF");
  d.set("17,21", "#2979FF");
  d.set("18,21", "#2979FF");
  d.set("19,21", "#2979FF");
  d.set("20,21", "#D50000");
  d.set("21,21", "#D50000");
  d.set("22,21", "#000000");
  d.set("7,22", "#000000");
  d.set("8,22", "#000000");
  d.set("9,22", "#D50000");
  d.set("10,22", "#D50000");
  d.set("11,22", "#000000");
  d.set("12,22", "#2979FF");
  d.set("13,22", "#2979FF");
  d.set("14,22", "#2979FF");
  d.set("15,22", "#2979FF");
  d.set("16,22", "#2979FF");
  d.set("17,22", "#FFC42A");
  d.set("18,22", "#2979FF");
  d.set("19,22", "#2979FF");
  d.set("20,22", "#000000");
  d.set("21,22", "#2979FF");
  d.set("22,22", "#000000");
  d.set("7,23", "#000000");
  d.set("8,23", "#D50000");
  d.set("9,23", "#D50000");
  d.set("10,23", "#D50000");
  d.set("11,23", "#000000");
  d.set("12,23", "#2979FF");
  d.set("13,23", "#000000");
  d.set("14,23", "#2979FF");
  d.set("15,23", "#2979FF");
  d.set("16,23", "#FFC42A");
  d.set("17,23", "#2979FF");
  d.set("18,23", "#2979FF");
  d.set("19,23", "#2979FF");
  d.set("20,23", "#000000");
  d.set("21,23", "#2979FF");
  d.set("22,23", "#000000");
  d.set("6,24", "#000000");
  d.set("7,24", "#D50000");
  d.set("8,24", "#D50000");
  d.set("9,24", "#D50000");
  d.set("10,24", "#850000");
  d.set("11,24", "#000000");
  d.set("12,24", "#FFCD94");
  d.set("13,24", "#000000");
  d.set("14,24", "#2979FF");
  d.set("15,24", "#2979FF");
  d.set("16,24", "#2979FF");
  d.set("17,24", "#2979FF");
  d.set("18,24", "#2979FF");
  d.set("19,24", "#2979FF");
  d.set("20,24", "#000000");
  d.set("21,24", "#FFCD94");
  d.set("22,24", "#000000");
  d.set("6,25", "#000000");
  d.set("7,25", "#D50000");
  d.set("8,25", "#D50000");
  d.set("9,25", "#850000");
  d.set("10,25", "#850000");
  d.set("11,25", "#000000");
  d.set("12,25", "#000000");
  d.set("13,25", "#000000");
  d.set("14,25", "#FFC42A");
  d.set("15,25", "#FFC42A");
  d.set("16,25", "#000000");
  d.set("17,25", "#000000");
  d.set("18,25", "#FFC42A");
  d.set("19,25", "#FFC42A");
  d.set("20,25", "#000000");
  d.set("21,25", "#000000");
  d.set("22,25", "#000000");
  d.set("5,26", "#000000");
  d.set("6,26", "#D50000");
  d.set("7,26", "#D50000");
  d.set("8,26", "#850000");
  d.set("9,26", "#850000");
  d.set("10,26", "#850000");
  d.set("11,26", "#850000");
  d.set("12,26", "#000000");
  d.set("13,26", "#000000");
  d.set("14,26", "#2979FF");
  d.set("15,26", "#2979FF");
  d.set("16,26", "#2979FF");
  d.set("17,26", "#2979FF");
  d.set("18,26", "#2979FF");
  d.set("19,26", "#2979FF");
  d.set("20,26", "#000000");
  d.set("5,27", "#000000");
  d.set("6,27", "#000000");
  d.set("7,27", "#000000");
  d.set("8,27", "#000000");
  d.set("9,27", "#000000");
  d.set("10,27", "#000000");
  d.set("11,27", "#000000");
  d.set("13,27", "#000000");
  d.set("14,27", "#2979FF");
  d.set("15,27", "#2979FF");
  d.set("16,27", "#D50000");
  d.set("17,27", "#D50000");
  d.set("18,27", "#2979FF");
  d.set("19,27", "#2979FF");
  d.set("20,27", "#000000");
  d.set("13,28", "#000000");
  d.set("14,28", "#D50000");
  d.set("15,28", "#D50000");
  d.set("16,28", "#000000");
  d.set("17,28", "#000000");
  d.set("18,28", "#D50000");
  d.set("19,28", "#D50000");
  d.set("20,28", "#000000");
  d.set("13,29", "#000000");
  d.set("14,29", "#000000");
  d.set("15,29", "#000000");
  d.set("18,29", "#000000");
  d.set("19,29", "#000000");
  d.set("20,29", "#000000");
  return d;
}

function generateNewCrofly(): Map<string, string> {
  const d = new Map<string, string>();
  d.set("7,5", "#000000");
  d.set("8,5", "#000000");
  d.set("9,5", "#000000");
  d.set("10,5", "#000000");
  d.set("6,6", "#000000");
  d.set("7,6", "#8D5524");
  d.set("8,6", "#8D5524");
  d.set("9,6", "#8D5524");
  d.set("10,6", "#8D5524");
  d.set("11,6", "#000000");
  d.set("13,6", "#000000");
  d.set("14,6", "#000000");
  d.set("15,6", "#000000");
  d.set("16,6", "#000000");
  d.set("17,6", "#000000");
  d.set("18,6", "#000000");
  d.set("6,7", "#000000");
  d.set("7,7", "#8D5524");
  d.set("8,7", "#000000");
  d.set("9,7", "#000000");
  d.set("10,7", "#8D5524");
  d.set("11,7", "#8D5524");
  d.set("12,7", "#000000");
  d.set("13,7", "#8D5524");
  d.set("14,7", "#8D5524");
  d.set("15,7", "#8D5524");
  d.set("16,7", "#8D5524");
  d.set("17,7", "#8D5524");
  d.set("18,7", "#8D5524");
  d.set("19,7", "#000000");
  d.set("20,7", "#000000");
  d.set("6,8", "#000000");
  d.set("7,8", "#000000");
  d.set("9,8", "#000000");
  d.set("10,8", "#000000");
  d.set("11,8", "#000000");
  d.set("12,8", "#8D5524");
  d.set("13,8", "#8D5524");
  d.set("14,8", "#8D5524");
  d.set("15,8", "#8D5524");
  d.set("16,8", "#8D5524");
  d.set("17,8", "#8D5524");
  d.set("18,8", "#8D5524");
  d.set("19,8", "#8D5524");
  d.set("20,8", "#8D5524");
  d.set("21,8", "#000000");
  d.set("11,9", "#000000");
  d.set("12,9", "#8D5524");
  d.set("13,9", "#8D5524");
  d.set("14,9", "#8D5524");
  d.set("15,9", "#8D5524");
  d.set("16,9", "#8D5524");
  d.set("17,9", "#8D5524");
  d.set("18,9", "#8D5524");
  d.set("19,9", "#8D5524");
  d.set("20,9", "#8D5524");
  d.set("21,9", "#8D5524");
  d.set("22,9", "#000000");
  d.set("10,10", "#000000");
  d.set("11,10", "#8D5524");
  d.set("12,10", "#8D5524");
  d.set("13,10", "#8D5524");
  d.set("14,10", "#8D5524");
  d.set("15,10", "#FFCD94");
  d.set("16,10", "#8D5524");
  d.set("17,10", "#8D5524");
  d.set("18,10", "#8D5524");
  d.set("19,10", "#FFCD94");
  d.set("20,10", "#FFCD94");
  d.set("21,10", "#8D5524");
  d.set("22,10", "#000000");
  d.set("10,11", "#000000");
  d.set("11,11", "#8D5524");
  d.set("12,11", "#FFCD94");
  d.set("13,11", "#FFCD94");
  d.set("14,11", "#FFCD94");
  d.set("15,11", "#FFCD94");
  d.set("16,11", "#FFCD94");
  d.set("17,11", "#FFCD94");
  d.set("18,11", "#FFCD94");
  d.set("19,11", "#FFCD94");
  d.set("20,11", "#FFCD94");
  d.set("21,11", "#FFCD94");
  d.set("22,11", "#000000");
  d.set("10,12", "#000000");
  d.set("11,12", "#8D5524");
  d.set("12,12", "#FFCD94");
  d.set("13,12", "#FFCD94");
  d.set("14,12", "#FFCD94");
  d.set("15,12", "#FFCD94");
  d.set("16,12", "#FFCD94");
  d.set("17,12", "#FFCD94");
  d.set("18,12", "#FFCD94");
  d.set("19,12", "#FFCD94");
  d.set("20,12", "#FFCD94");
  d.set("21,12", "#FFCD94");
  d.set("22,12", "#000000");
  d.set("10,13", "#000000");
  d.set("11,13", "#8D5524");
  d.set("12,13", "#FFCD94");
  d.set("13,13", "#FFCD94");
  d.set("14,13", "#FFCD94");
  d.set("15,13", "#FFCD94");
  d.set("16,13", "#000000");
  d.set("17,13", "#FFCD94");
  d.set("18,13", "#FFCD94");
  d.set("19,13", "#000000");
  d.set("20,13", "#FFCD94");
  d.set("21,13", "#FFCD94");
  d.set("22,13", "#000000");
  d.set("10,14", "#000000");
  d.set("11,14", "#8D5524");
  d.set("12,14", "#FFCD94");
  d.set("13,14", "#FFCD94");
  d.set("14,14", "#FFCD94");
  d.set("15,14", "#FFCD94");
  d.set("16,14", "#000000");
  d.set("17,14", "#FFCD94");
  d.set("18,14", "#FFCD94");
  d.set("19,14", "#000000");
  d.set("20,14", "#FFCD94");
  d.set("21,14", "#FFCD94");
  d.set("22,14", "#000000");
  d.set("10,15", "#000000");
  d.set("11,15", "#8D5524");
  d.set("12,15", "#FFCD94");
  d.set("13,15", "#FFCD94");
  d.set("14,15", "#FFCD94");
  d.set("15,15", "#FFCD94");
  d.set("16,15", "#FFCD94");
  d.set("17,15", "#FFCD94");
  d.set("18,15", "#FFCD94");
  d.set("19,15", "#FFCD94");
  d.set("20,15", "#FFCD94");
  d.set("21,15", "#FFCD94");
  d.set("22,15", "#000000");
  d.set("11,16", "#000000");
  d.set("12,16", "#FFCD94");
  d.set("13,16", "#FFCD94");
  d.set("14,16", "#FFCD94");
  d.set("15,16", "#FFCD94");
  d.set("16,16", "#FFCD94");
  d.set("17,16", "#FFCD94");
  d.set("18,16", "#FFCD94");
  d.set("19,16", "#FFCD94");
  d.set("20,16", "#FFCD94");
  d.set("21,16", "#FFCD94");
  d.set("22,16", "#000000");
  d.set("11,17", "#000000");
  d.set("12,17", "#FFCD94");
  d.set("13,17", "#FFCD94");
  d.set("14,17", "#FFCD94");
  d.set("15,17", "#FFCD94");
  d.set("16,17", "#000000");
  d.set("17,17", "#000000");
  d.set("18,17", "#FFCD94");
  d.set("19,17", "#FFCD94");
  d.set("20,17", "#FFCD94");
  d.set("21,17", "#FFCD94");
  d.set("22,17", "#000000");
  d.set("12,18", "#000000");
  d.set("13,18", "#FFCD94");
  d.set("14,18", "#FFCD94");
  d.set("15,18", "#FFCD94");
  d.set("16,18", "#FFCD94");
  d.set("17,18", "#FFCD94");
  d.set("18,18", "#FFCD94");
  d.set("19,18", "#FFCD94");
  d.set("20,18", "#FFCD94");
  d.set("21,18", "#000000");
  d.set("10,19", "#000000");
  d.set("11,19", "#000000");
  d.set("12,19", "#2196F3");
  d.set("13,19", "#000000");
  d.set("14,19", "#000000");
  d.set("15,19", "#000000");
  d.set("16,19", "#000000");
  d.set("17,19", "#000000");
  d.set("18,19", "#000000");
  d.set("19,19", "#000000");
  d.set("20,19", "#000000");
  d.set("9,20", "#000000");
  d.set("10,20", "#2962FF");
  d.set("11,20", "#2196F3");
  d.set("12,20", "#000000");
  d.set("13,20", "#000000");
  d.set("14,20", "#448AFF");
  d.set("15,20", "#448AFF");
  d.set("16,20", "#FFC42A");
  d.set("17,20", "#FFC42A");
  d.set("18,20", "#448AFF");
  d.set("19,20", "#448AFF");
  d.set("20,20", "#000000");
  d.set("21,20", "#000000");
  d.set("8,21", "#000000");
  d.set("9,21", "#2962FF");
  d.set("10,21", "#448AFF");
  d.set("11,21", "#000000");
  d.set("12,21", "#448AFF");
  d.set("13,21", "#448AFF");
  d.set("14,21", "#FFC42A");
  d.set("15,21", "#FFC42A");
  d.set("16,21", "#FFC42A");
  d.set("17,21", "#FFC42A");
  d.set("18,21", "#FFC42A");
  d.set("19,21", "#FFC42A");
  d.set("20,21", "#448AFF");
  d.set("21,21", "#448AFF");
  d.set("22,21", "#000000");
  d.set("7,22", "#000000");
  d.set("8,22", "#000000");
  d.set("9,22", "#448AFF");
  d.set("10,22", "#448AFF");
  d.set("11,22", "#000000");
  d.set("12,22", "#FFC42A");
  d.set("13,22", "#FFC42A");
  d.set("14,22", "#FFC42A");
  d.set("15,22", "#FFC42A");
  d.set("16,22", "#D50000");
  d.set("17,22", "#FFC42A");
  d.set("18,22", "#FFC42A");
  d.set("19,22", "#FFC42A");
  d.set("20,22", "#000000");
  d.set("21,22", "#FFC42A");
  d.set("22,22", "#000000");
  d.set("7,23", "#000000");
  d.set("8,23", "#448AFF");
  d.set("9,23", "#448AFF");
  d.set("10,23", "#448AFF");
  d.set("11,23", "#000000");
  d.set("12,23", "#FFC42A");
  d.set("13,23", "#000000");
  d.set("14,23", "#FFC42A");
  d.set("15,23", "#FFC42A");
  d.set("16,23", "#FFC42A");
  d.set("17,23", "#D50000");
  d.set("18,23", "#FFC42A");
  d.set("19,23", "#FFC42A");
  d.set("20,23", "#000000");
  d.set("21,23", "#FFC42A");
  d.set("22,23", "#000000");
  d.set("6,24", "#000000");
  d.set("7,24", "#448AFF");
  d.set("8,24", "#448AFF");
  d.set("9,24", "#448AFF");
  d.set("10,24", "#2962FF");
  d.set("11,24", "#000000");
  d.set("12,24", "#FFCD94");
  d.set("13,24", "#000000");
  d.set("14,24", "#FFC42A");
  d.set("15,24", "#FFC42A");
  d.set("16,24", "#FFC42A");
  d.set("17,24", "#FFC42A");
  d.set("18,24", "#FFC42A");
  d.set("19,24", "#FFC42A");
  d.set("20,24", "#000000");
  d.set("21,24", "#FFCD94");
  d.set("22,24", "#000000");
  d.set("6,25", "#000000");
  d.set("7,25", "#448AFF");
  d.set("8,25", "#448AFF");
  d.set("9,25", "#2962FF");
  d.set("10,25", "#2962FF");
  d.set("11,25", "#000000");
  d.set("12,25", "#000000");
  d.set("13,25", "#000000");
  d.set("14,25", "#D50000");
  d.set("15,25", "#D50000");
  d.set("16,25", "#000000");
  d.set("17,25", "#000000");
  d.set("18,25", "#D50000");
  d.set("19,25", "#D50000");
  d.set("20,25", "#000000");
  d.set("21,25", "#000000");
  d.set("22,25", "#000000");
  d.set("5,26", "#000000");
  d.set("6,26", "#448AFF");
  d.set("7,26", "#448AFF");
  d.set("8,26", "#2962FF");
  d.set("9,26", "#2962FF");
  d.set("10,26", "#2962FF");
  d.set("11,26", "#2962FF");
  d.set("12,26", "#000000");
  d.set("13,26", "#000000");
  d.set("14,26", "#FFC42A");
  d.set("15,26", "#FFC42A");
  d.set("16,26", "#FFC42A");
  d.set("17,26", "#FFC42A");
  d.set("18,26", "#FFC42A");
  d.set("19,26", "#FFC42A");
  d.set("20,26", "#000000");
  d.set("5,27", "#000000");
  d.set("6,27", "#000000");
  d.set("7,27", "#000000");
  d.set("8,27", "#000000");
  d.set("9,27", "#000000");
  d.set("10,27", "#000000");
  d.set("11,27", "#000000");
  d.set("13,27", "#000000");
  d.set("14,27", "#FFC42A");
  d.set("15,27", "#FFC42A");
  d.set("16,27", "#448AFF");
  d.set("17,27", "#448AFF");
  d.set("18,27", "#FFC42A");
  d.set("19,27", "#FFC42A");
  d.set("20,27", "#000000");
  d.set("13,28", "#000000");
  d.set("14,28", "#448AFF");
  d.set("15,28", "#448AFF");
  d.set("16,28", "#000000");
  d.set("17,28", "#000000");
  d.set("18,28", "#448AFF");
  d.set("19,28", "#448AFF");
  d.set("20,28", "#000000");
  d.set("13,29", "#000000");
  d.set("14,29", "#000000");
  d.set("15,29", "#000000");
  d.set("18,29", "#000000");
  d.set("19,29", "#000000");
  d.set("20,29", "#000000");
  return d;
}

// Render pixel data to a canvas and return data URL
function pixelDataToDataUrl(data: Map<string, string>, size: number = GRID_SIZE): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  data.forEach((color, key) => {
    if (color === "transparent") return;
    const [x, y] = key.split(",").map(Number);
    if (x >= 0 && x < size && y >= 0 && y < size) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas.toDataURL("image/png");
}

// Render pixel data to SVG for display
function PixelPreview({ data, size = 128 }: { data: Map<string, string>; size?: number }) {
  const cellSize = size / GRID_SIZE;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`} style={{ imageRendering: "pixelated", borderRadius: 8 }}>
      <rect width={GRID_SIZE} height={GRID_SIZE} fill="#f6f6f7" />
      {Array.from(data.entries()).map(([key, color]) => {
        if (color === "transparent") return null;
        const [x, y] = key.split(",").map(Number);
        return <rect key={key} x={x} y={y} width={1} height={1} fill={color} />;
      })}
    </svg>
  );
}

interface PixelArtEditorProps {
  onSave: (dataUrl: string) => void;
  currentAvatarUrl?: string | null;
}

export function PixelArtEditor({ onSave, currentAvatarUrl }: PixelArtEditorProps) {
  const [activeTab, setActiveTab] = useState<"premade" | "builder" | "custom">("premade");
  // Builder state — matches Crofly template
  const [builderSkin, setBuilderSkin] = useState(1);
  const [builderHairColor, setBuilderHairColor] = useState(2);
  const [builderTop, setBuilderTop] = useState(3); // yellow like crofly
  const [builderAccent, setBuilderAccent] = useState(0); // red
  const [builderCape, setBuilderCape] = useState(0); // none
  const [builderHairStyle, setBuilderHairStyle] = useState(0);
  const [builderEyes, setBuilderEyes] = useState(0);
  const [builderMouth, setBuilderMouth] = useState(0);
  const [builderAccessory, setBuilderAccessory] = useState(0);

  const builderPixels = compositeCharacter({
    skin: SKIN_TONES[builderSkin].color,
    hair: HAIR_COLORS[builderHairColor].color,
    top: OUTFIT_COLORS[builderTop].color,
    accent: OUTFIT_COLORS[builderAccent].color,
    capeColor: CAPE_OPTIONS[builderCape].color,
    hairStyleIdx: builderHairStyle,
    eyeStyleIdx: builderEyes,
    mouthStyleIdx: builderMouth,
    accessoryIdx: builderAccessory,
  });

  const handleSaveBuilder = useCallback(() => {
    const dataUrl = pixelDataToDataUrl(builderPixels);
    onSave(dataUrl);
  }, [builderPixels, onSave]);

  const handleLoadBuilderToEditor = useCallback(() => {
    setPixelData(new Map(builderPixels));
    setActiveTab("custom");
  }, [builderPixels]);

  const handleRandomize = useCallback(() => {
    setBuilderSkin(Math.floor(Math.random() * SKIN_TONES.length));
    setBuilderHairColor(Math.floor(Math.random() * HAIR_COLORS.length));
    setBuilderTop(Math.floor(Math.random() * OUTFIT_COLORS.length));
    setBuilderAccent(Math.floor(Math.random() * OUTFIT_COLORS.length));
    setBuilderCape(Math.floor(Math.random() * CAPE_OPTIONS.length));
    setBuilderHairStyle(Math.floor(Math.random() * HAIR_STYLES.length));
    setBuilderEyes(Math.floor(Math.random() * EYE_STYLES.length));
    setBuilderMouth(Math.floor(Math.random() * MOUTH_STYLES.length));
    setBuilderAccessory(Math.floor(Math.random() * ACCESSORIES.length));
  }, []);
  const [selectedColor, setSelectedColor] = useState("#2C6ECB");
  const [tool, setTool] = useState<"pencil" | "eraser">("pencil");
  const [pixelData, setPixelData] = useState<Map<string, string>>(() => new Map());
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedPremade, setSelectedPremade] = useState<number | null>(null);

  const handleCellInteract = useCallback((x: number, y: number) => {
    setPixelData((prev) => {
      const next = new Map(prev);
      if (tool === "eraser") {
        next.delete(`${x},${y}`);
      } else {
        next.set(`${x},${y}`, selectedColor);
      }
      return next;
    });
  }, [selectedColor, tool]);

  const handleMouseDown = useCallback((x: number, y: number) => {
    setIsDrawing(true);
    handleCellInteract(x, y);
  }, [handleCellInteract]);

  const handleMouseEnter = useCallback((x: number, y: number) => {
    if (isDrawing) handleCellInteract(x, y);
  }, [isDrawing, handleCellInteract]);

  const handleMouseUp = useCallback(() => setIsDrawing(false), []);

  const handleSavePremade = useCallback(() => {
    if (selectedPremade === null) return;
    const avatar = PREMADE_AVATARS[selectedPremade];
    const dataUrl = pixelDataToDataUrl(avatar.data);
    onSave(dataUrl);
  }, [selectedPremade, onSave]);

  const handleSaveCustom = useCallback(() => {
    if (pixelData.size === 0) return;
    const dataUrl = pixelDataToDataUrl(pixelData);
    onSave(dataUrl);
  }, [pixelData, onSave]);

  const handleClear = useCallback(() => {
    setPixelData(new Map());
  }, []);

  const handleLoadPremadeToEditor = useCallback((index: number) => {
    setPixelData(new Map(PREMADE_AVATARS[index].data));
    setActiveTab("custom");
  }, []);

  return (
    <BlockStack gap="400">
      {/* Tab switcher */}
      <div style={{ display: "flex", borderBottom: "1px solid #e4e5e7" }}>
        {([["premade", "Pre-made"], ["builder", "Builder"], ["custom", "Free Draw"]] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              flex: 1, padding: "10px 16px", background: "none", border: "none",
              borderBottom: activeTab === tab ? "2px solid #2c6ecb" : "2px solid transparent",
              cursor: "pointer", fontSize: 14, fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? "#202223" : "#6d7175",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "premade" && (
        <BlockStack gap="300">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {PREMADE_AVATARS.map((avatar, i) => (
              <div
                key={avatar.name}
                onClick={() => setSelectedPremade(i)}
                style={{
                  cursor: "pointer", borderRadius: 8, padding: 8, textAlign: "center",
                  border: selectedPremade === i ? "2px solid #2c6ecb" : "2px solid transparent",
                  background: selectedPremade === i ? "#f0f5ff" : "transparent",
                  transition: "all 0.15s",
                }}
              >
                <PixelPreview data={avatar.data} size={80} />
                <Text as="p" variant="bodySm" tone="subdued">{avatar.name}</Text>
              </div>
            ))}
          </div>
          <InlineStack gap="200">
            <Button variant="primary" onClick={handleSavePremade} disabled={selectedPremade === null}>
              Use this avatar
            </Button>
            {selectedPremade !== null && (
              <Button onClick={() => handleLoadPremadeToEditor(selectedPremade)}>
                Edit this character
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      )}

      {activeTab === "builder" && (() => {
        const categories = [
          { label: "Skin", options: SKIN_TONES, value: builderSkin, set: setBuilderSkin, type: "color" as const },
          { label: "Hair Color", options: HAIR_COLORS, value: builderHairColor, set: setBuilderHairColor, type: "color" as const },
          { label: "Shirt Color", options: OUTFIT_COLORS, value: builderTop, set: setBuilderTop, type: "color" as const },
          { label: "Accent Color", options: OUTFIT_COLORS, value: builderAccent, set: setBuilderAccent, type: "color" as const },
          { label: "Cape", options: CAPE_OPTIONS.map(c => ({ name: c.name, color: c.color || "#F6F6F7" })), value: builderCape, set: setBuilderCape, type: "color" as const },
          { label: "Hair Style", options: HAIR_STYLES, value: builderHairStyle, set: setBuilderHairStyle, type: "part" as const },
          { label: "Eyes", options: EYE_STYLES, value: builderEyes, set: setBuilderEyes, type: "part" as const },
          { label: "Mouth", options: MOUTH_STYLES, value: builderMouth, set: setBuilderMouth, type: "part" as const },
          { label: "Accessory", options: ACCESSORIES, value: builderAccessory, set: setBuilderAccessory, type: "part" as const },
        ];
        return (
          <div style={{ display: "flex", gap: 24 }}>
            {/* Preview */}
            <div style={{ flexShrink: 0, textAlign: "center" }}>
              <PixelPreview data={builderPixels} size={192} />
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <Button variant="primary" onClick={handleSaveBuilder}>Use this avatar</Button>
                <Button onClick={handleLoadBuilderToEditor}>Edit in Free Draw</Button>
                <Button onClick={handleRandomize}>Randomize</Button>
              </div>
            </div>

            {/* Parts panel */}
            <div style={{ flex: 1, maxHeight: 420, overflowY: "auto" }}>
              <BlockStack gap="300">
                {categories.map((cat) => (
                  <div key={cat.label}>
                    <Text as="p" variant="bodySm" fontWeight="semibold">{cat.label}</Text>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {cat.type === "color"
                        ? (cat.options as Array<{ name: string; color: string }>).map((opt, i) => (
                            <button
                              key={opt.name}
                              onClick={() => cat.set(i)}
                              title={opt.name}
                              style={{
                                width: 28, height: 28, borderRadius: 6, cursor: "pointer",
                                backgroundColor: opt.color,
                                border: cat.value === i ? "2px solid #2c6ecb" : "1px solid #d0d0d0",
                              }}
                            />
                          ))
                        : (cat.options as Array<{ name: string; icon: string }>).map((opt, i) => (
                            <button
                              key={opt.name}
                              onClick={() => cat.set(i)}
                              title={opt.name}
                              style={{
                                padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13,
                                border: cat.value === i ? "2px solid #2c6ecb" : "1px solid #d0d0d0",
                                background: cat.value === i ? "#f0f5ff" : "white",
                                fontWeight: cat.value === i ? 600 : 400,
                              }}
                            >
                              {opt.icon} {opt.name}
                            </button>
                          ))
                      }
                    </div>
                  </div>
                ))}
              </BlockStack>
            </div>
          </div>
        );
      })()}

      {activeTab === "custom" && (
        <div style={{ display: "flex", gap: 16 }}>
          {/* Canvas */}
          <div>
            <div
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_PX}px)`,
                gridTemplateRows: `repeat(${GRID_SIZE}, ${CELL_PX}px)`,
                border: "1px solid #e4e5e7",
                borderRadius: 4,
                cursor: tool === "eraser" ? "crosshair" : "cell",
                userSelect: "none",
              }}
            >
              {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
                const x = i % GRID_SIZE;
                const y = Math.floor(i / GRID_SIZE);
                const color = pixelData.get(`${x},${y}`);
                return (
                  <div
                    key={i}
                    onMouseDown={() => handleMouseDown(x, y)}
                    onMouseEnter={() => handleMouseEnter(x, y)}
                    style={{
                      width: CELL_PX, height: CELL_PX,
                      backgroundColor: color || ((x + y) % 2 === 0 ? "#fafafa" : "#f0f0f0"),
                      borderRight: x < GRID_SIZE - 1 ? "1px solid #f0f0f0" : "none",
                      borderBottom: y < GRID_SIZE - 1 ? "1px solid #f0f0f0" : "none",
                    }}
                  />
                );
              })}
            </div>
            <div style={{ marginTop: 8 }}>
              <InlineStack gap="200">
                <Button size="slim" onClick={handleClear}>Clear</Button>
                <Button size="slim" variant="primary" onClick={handleSaveCustom} disabled={pixelData.size === 0}>
                  Save avatar
                </Button>
              </InlineStack>
            </div>
          </div>

          {/* Tools + Palette */}
          <BlockStack gap="300">
            {/* Preview */}
            <div style={{ textAlign: "center" }}>
              <Text as="p" variant="bodySm" tone="subdued">Preview</Text>
              <PixelPreview data={pixelData} size={96} />
            </div>

            {/* Tools */}
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">Tools</Text>
              <InlineStack gap="200">
                <button
                  onClick={() => setTool("pencil")}
                  style={{
                    padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                    border: tool === "pencil" ? "2px solid #2c6ecb" : "1px solid #e4e5e7",
                    background: tool === "pencil" ? "#f0f5ff" : "white",
                    fontSize: 13, fontWeight: tool === "pencil" ? 600 : 400,
                  }}
                >
                  Pencil
                </button>
                <button
                  onClick={() => setTool("eraser")}
                  style={{
                    padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                    border: tool === "eraser" ? "2px solid #2c6ecb" : "1px solid #e4e5e7",
                    background: tool === "eraser" ? "#f0f5ff" : "white",
                    fontSize: 13, fontWeight: tool === "eraser" ? 600 : 400,
                  }}
                >
                  Eraser
                </button>
              </InlineStack>
            </BlockStack>

            {/* Color palette */}
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">Colors</Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3, maxWidth: 220 }}>
                {PALETTE.map((color, idx) => (
                  <button
                    key={`${color}-${idx}`}
                    onClick={() => { setSelectedColor(color); setTool("pencil"); }}
                    style={{
                      width: 20, height: 20, borderRadius: 4, cursor: "pointer",
                      backgroundColor: color === "transparent" ? "#fff" : color,
                      border: selectedColor === color ? "2px solid #2c6ecb" : "1px solid #d0d0d0",
                      backgroundImage: color === "transparent" ? "linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)" : "none",
                      backgroundSize: color === "transparent" ? "8px 8px" : "auto",
                      backgroundPosition: color === "transparent" ? "0 0, 4px 4px" : "auto",
                    }}
                    title={color}
                  />
                ))}
              </div>
            </BlockStack>
          </BlockStack>
        </div>
      )}
    </BlockStack>
  );
}
