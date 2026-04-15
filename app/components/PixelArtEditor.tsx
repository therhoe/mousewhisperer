import { useState, useCallback } from "react";
import { Text, Button, InlineStack, BlockStack } from "@shopify/polaris";
import {
  SKIN_TONES, HAIR_COLORS, OUTFIT_COLORS,
  HEAD_PARTS, HAIR_PARTS, EYE_PARTS, MOUTH_PARTS,
  BODY_PARTS, LEG_PARTS, SHOE_PARTS, ACCESSORY_PARTS,
  compositeCharacter,
} from "./AvatarParts";

const GRID_SIZE = 32;
const CELL_PX = 12;
const BLK = "#000000";

const PALETTE = [
  // Skin tones
  "#FFDBB4", "#E8B887", "#C8956C", "#8D5524", "#5C3310",
  // Hair
  "#2C1810", "#4A3728", "#8B6914", "#C4A35A", "#E8D5B7", "#D94000", "#B8860B",
  // Eyes
  "#1A1A2E", "#2C6ECB", "#29845A", "#8B4513",
  // Clothing
  "#DC143C", "#2C6ECB", "#29845A", "#F59E0B", "#8B5CF6", "#FF6B9D", "#1A1A2E", "#FFFFFF",
  // Accessories
  "#FFD700", "#C0C0C0", "#CD7F32",
  // Background/misc
  "#F6F6F7", "#E4E5E7", "#94A3B8", "#000000", "transparent",
];

const PREMADE_AVATARS = [
  { name: "Hero", data: generateNewHero() },
  { name: "Crofly", data: generateNewCrofly() },
  { name: "Knight", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#2C1810", hairStyle: "short", top: "#94A3B8", bottom: "#4A3728", accent: "#FFD700" }) },
  { name: "Mage", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#E8D5B7", hairStyle: "short", top: "#8B5CF6", bottom: "#4A3728", accent: "#FFD700" }) },
  { name: "Ranger", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#8B6914", hairStyle: "messy", top: "#29845A", bottom: "#4A3728", accent: "#C4A35A" }) },
  { name: "Healer", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#D94000", hairStyle: "long", top: "#FFFFFF", bottom: "#F0F0F0", accent: "#DC143C" }) },
  { name: "Rogue", data: generateOutlinedCharacter({ skin: "#C8956C", hair: "#1A1A2E", hairStyle: "short", top: "#1A1A2E", bottom: "#1A1A2E", accent: "#4A3728" }) },
  { name: "Viking", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#B8860B", hairStyle: "messy", top: "#8B4513", bottom: "#4A3728", accent: "#94A3B8" }) },
  { name: "Pirate", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#2C1810", hairStyle: "short", top: "#DC143C", bottom: "#1A1A2E", accent: "#FFD700" }) },
  { name: "Wizard", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#E8E8E8", hairStyle: "long", top: "#2C6ECB", bottom: "#2C6ECB", accent: "#FFD700" }) },
  { name: "Warrior", data: generateOutlinedCharacter({ skin: "#8D5524", hair: "#2C1810", hairStyle: "short", top: "#DC143C", bottom: "#4A3728", accent: "#94A3B8" }) },
  { name: "Bard", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#D94000", hairStyle: "messy", top: "#29845A", bottom: "#8B4513", accent: "#FFD700" }) },
  { name: "Executive", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#3D2314", hairStyle: "short", top: "#1E3A5F", bottom: "#1A1A2E", accent: "#FFFFFF" }) },
  { name: "Casual", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#8B4513", hairStyle: "messy", top: "#5B9BD5", bottom: "#8B6914", accent: "#FFFFFF" }) },
  { name: "Medic", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#8B4513", hairStyle: "short", top: "#FFC42A", bottom: "#2C6ECB", accent: "#DC143C" }) },
  { name: "Student", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#8B4513", hairStyle: "short", top: "#5B9BD5", bottom: "#B0BEC5", accent: "#FFFFFF" }) },
  { name: "Elder", data: generateOutlinedCharacter({ skin: "#E8B887", hair: "#94A3B8", hairStyle: "short", top: "#F5F5F5", bottom: "#F5F5F5", accent: "#8B4513" }) },
  { name: "Chill", data: generateOutlinedCharacter({ skin: "#FFDBB4", hair: "#5C2E00", hairStyle: "messy", top: "#E8963A", bottom: "#5B6BC0", accent: "#FFC42A" }) },
  { name: "Super", data: generateOutlinedCharacter({ skin: "#FFCD94", hair: "#1A1A2E", hairStyle: "short", top: "#2C6ECB", bottom: "#DC143C", accent: "#FFD700" }) },
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

// Body outline (same across all characters) — arms, torso sides, legs
function drawBodyOutline(d: Map<string, string>) {
  // Torso top outline
  for (let x = 13; x <= 20; x++) d.set(`${x},19`, BLK);
  d.set("12,18", BLK); d.set("21,18", BLK);
  d.set("10,19", BLK); d.set("11,19", BLK);
  // Left arm outline going down
  d.set("9,20", BLK); d.set("12,20", BLK); d.set("13,20", BLK);
  d.set("8,21", BLK); d.set("11,21", BLK);
  d.set("7,22", BLK); d.set("8,22", BLK); d.set("11,22", BLK);
  d.set("7,23", BLK); d.set("11,23", BLK);
  d.set("6,24", BLK); d.set("11,24", BLK);
  d.set("6,25", BLK); d.set("11,25", BLK); d.set("12,25", BLK); d.set("13,25", BLK);
  d.set("5,26", BLK); d.set("12,26", BLK); d.set("13,26", BLK);
  for (let x = 5; x <= 11; x++) d.set(`${x},27`, BLK);
  d.set("13,27", BLK);
  // Right arm outline
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
  hairStyle: "short" | "messy" | "long" | "bald";
  top: string;   // shirt/main color
  bottom: string; // pants/secondary color
  accent: string; // highlight (boots, emblem, etc.)
};

// Generate a character matching the outlined style
function generateOutlinedCharacter(opts: CharOpts): Map<string, string> {
  const d = new Map<string, string>();
  const { skin, hair, hairStyle, top, bottom, accent } = opts;

  // ── HEAD OUTLINE (matches newhero shape) ──
  // Top curve
  d.set("14,5", BLK); d.set("15,5", BLK); d.set("16,5", BLK); d.set("17,5", BLK);
  d.set("12,6", BLK); d.set("13,6", BLK); d.set("18,6", BLK); d.set("19,6", BLK);
  d.set("11,7", BLK); d.set("20,7", BLK);
  d.set("11,8", BLK); d.set("20,8", BLK);
  d.set("11,9", BLK); d.set("21,9", BLK);
  d.set("11,10", BLK); d.set("21,10", BLK);
  d.set("11,11", BLK); d.set("21,11", BLK);
  d.set("11,12", BLK); d.set("21,12", BLK);
  d.set("11,13", BLK); d.set("21,13", BLK);
  d.set("11,14", BLK); d.set("21,14", BLK);
  d.set("11,15", BLK); d.set("21,15", BLK);
  d.set("12,16", BLK); d.set("20,16", BLK);
  d.set("12,17", BLK); d.set("20,17", BLK);
  d.set("13,18", BLK); d.set("14,18", BLK); d.set("17,18", BLK); d.set("18,18", BLK); d.set("19,18", BLK);
  // Neck outline
  d.set("15,18", BLK); d.set("16,18", BLK);

  // ── FACE FILL (skin) ──
  for (let y = 7; y <= 17; y++) {
    for (let x = 12; x <= 20; x++) {
      if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, skin);
    }
  }
  // Fill corner areas missed
  d.set("12,7", skin); d.set("19,7", skin); d.set("20,7", skin);
  d.set("12,8", skin); d.set("19,8", skin);

  // ── HAIR ──
  if (hairStyle !== "bald") {
    // Top of head hair
    for (let x = 14; x <= 17; x++) {
      d.set(`${x},6`, hair);
      d.set(`${x},7`, hair);
    }
    d.set("13,7", hair); d.set("18,7", hair);
    // Forehead
    for (let x = 12; x <= 19; x++) d.set(`${x},8`, hair);
    d.set("11,8", BLK); // keep left outline
    d.set("20,8", BLK); // keep right outline

    if (hairStyle === "messy") {
      // Side fringe
      d.set("12,9", hair); d.set("19,9", hair);
    }
    if (hairStyle === "long") {
      // Side hair down to cheeks
      d.set("12,9", hair); d.set("19,9", hair);
      d.set("12,10", hair); d.set("20,10", hair);
      d.set("12,11", hair); d.set("20,11", hair);
      d.set("12,12", hair); d.set("20,12", hair);
    }
  }

  // ── EYES (2x2 blocks) ──
  d.set("14,11", BLK); d.set("15,11", BLK);
  d.set("14,12", BLK); d.set("15,12", BLK);
  d.set("17,11", BLK); d.set("18,11", BLK);
  d.set("17,12", BLK); d.set("18,12", BLK);

  // ── MOUTH ──
  d.set("15,15", BLK); d.set("16,15", BLK);

  // ── BODY OUTLINE ──
  drawBodyOutline(d);

  // ── TORSO FILL (top color) ──
  for (let y = 20; y <= 21; y++) {
    for (let x = 12; x <= 19; x++) {
      if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, top);
    }
  }
  for (let y = 22; y <= 24; y++) {
    for (let x = 12; x <= 19; x++) {
      if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, top);
    }
  }
  // Arms fill
  for (let y = 20; y <= 26; y++) {
    for (let x = 6; x <= 10; x++) {
      if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, top);
    }
  }
  // Hands (skin peek at bottom of arms)
  d.set("12,24", skin); d.set("21,24", skin);

  // ── BOTTOM / LEGS FILL (bottom color) ──
  for (let y = 25; y <= 26; y++) {
    for (let x = 14; x <= 19; x++) {
      if (!d.has(`${x},${y}`)) d.set(`${x},${y}`, bottom);
    }
  }
  // Leg fills
  d.set("14,27", bottom); d.set("15,27", bottom);
  d.set("18,27", bottom); d.set("19,27", bottom);
  d.set("14,28", bottom); d.set("15,28", bottom);
  d.set("18,28", bottom); d.set("19,28", bottom);

  // ── BOOTS (accent) ──
  d.set("14,29", accent); d.set("15,29", accent);
  d.set("18,29", accent); d.set("19,29", accent);
  // Accent on belt
  d.set("13,24", accent); d.set("20,24", accent);

  return d;
}

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
  // Builder state
  const [builderSkin, setBuilderSkin] = useState(0);
  const [builderHairColor, setBuilderHairColor] = useState(2);
  const [builderOutfitColor, setBuilderOutfitColor] = useState(1);
  const [builderHead, setBuilderHead] = useState(0);
  const [builderHair, setBuilderHair] = useState(0);
  const [builderEyes, setBuilderEyes] = useState(0);
  const [builderMouth, setBuilderMouth] = useState(1);
  const [builderBody, setBuilderBody] = useState(0);
  const [builderLegs, setBuilderLegs] = useState(0);
  const [builderShoes, setBuilderShoes] = useState(0);
  const [builderAccessory, setBuilderAccessory] = useState(0);

  const builderPixels = compositeCharacter(
    SKIN_TONES[builderSkin].color,
    HAIR_COLORS[builderHairColor].color,
    OUTFIT_COLORS[builderOutfitColor].color,
    builderHead, builderHair, builderEyes, builderMouth,
    builderBody, builderLegs, builderShoes, builderAccessory,
  );

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
    setBuilderOutfitColor(Math.floor(Math.random() * OUTFIT_COLORS.length));
    setBuilderHead(Math.floor(Math.random() * HEAD_PARTS.length));
    setBuilderHair(Math.floor(Math.random() * HAIR_PARTS.length));
    setBuilderEyes(Math.floor(Math.random() * EYE_PARTS.length));
    setBuilderMouth(Math.floor(Math.random() * MOUTH_PARTS.length));
    setBuilderBody(Math.floor(Math.random() * BODY_PARTS.length));
    setBuilderLegs(Math.floor(Math.random() * LEG_PARTS.length));
    setBuilderShoes(Math.floor(Math.random() * SHOE_PARTS.length));
    setBuilderAccessory(Math.floor(Math.random() * ACCESSORY_PARTS.length));
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
          { label: "Outfit Color", options: OUTFIT_COLORS, value: builderOutfitColor, set: setBuilderOutfitColor, type: "color" as const },
          { label: "Head", options: HEAD_PARTS, value: builderHead, set: setBuilderHead, type: "part" as const },
          { label: "Hair", options: HAIR_PARTS, value: builderHair, set: setBuilderHair, type: "part" as const },
          { label: "Eyes", options: EYE_PARTS, value: builderEyes, set: setBuilderEyes, type: "part" as const },
          { label: "Mouth", options: MOUTH_PARTS, value: builderMouth, set: setBuilderMouth, type: "part" as const },
          { label: "Body", options: BODY_PARTS, value: builderBody, set: setBuilderBody, type: "part" as const },
          { label: "Legs", options: LEG_PARTS, value: builderLegs, set: setBuilderLegs, type: "part" as const },
          { label: "Shoes", options: SHOE_PARTS, value: builderShoes, set: setBuilderShoes, type: "part" as const },
          { label: "Accessory", options: ACCESSORY_PARTS, value: builderAccessory, set: setBuilderAccessory, type: "part" as const },
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 180 }}>
                {PALETTE.map((color) => (
                  <button
                    key={color}
                    onClick={() => { setSelectedColor(color); setTool("pencil"); }}
                    style={{
                      width: 24, height: 24, borderRadius: 4, cursor: "pointer",
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
