import { useState, useCallback, useRef } from "react";
import { Text, Button, InlineStack, BlockStack } from "@shopify/polaris";

const GRID_SIZE = 32;
const CELL_PX = 12;

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
  // Each is a 32x32 pixel art stored as a sparse map: "x,y" -> color
  // Generated programmatically as simple RPG-style characters
  { name: "Knight", data: generateKnight() },
  { name: "Mage", data: generateMage() },
  { name: "Archer", data: generateArcher() },
  { name: "Merchant", data: generateMerchant() },
  { name: "Healer", data: generateHealer() },
  { name: "Rogue", data: generateRogue() },
  { name: "Viking", data: generateViking() },
  { name: "Ninja", data: generateNinja() },
  { name: "Pirate", data: generatePirate() },
  { name: "Wizard", data: generateWizard() },
  { name: "Warrior", data: generateWarrior() },
  { name: "Bard", data: generateBard() },
  { name: "Hero", data: generateHeroOutline() },
];

// Simple character generator helpers
function drawRect(data: Map<string, string>, x: number, y: number, w: number, h: number, color: string) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      data.set(`${x + dx},${y + dy}`, color);
    }
  }
}

function generateCharacter(skinColor: string, hairColor: string, shirtColor: string, pantsColor: string, extras?: (data: Map<string, string>) => void): Map<string, string> {
  const d = new Map<string, string>();
  // Hair (top of head)
  drawRect(d, 12, 4, 8, 3, hairColor);
  drawRect(d, 11, 5, 10, 2, hairColor);
  // Head
  drawRect(d, 12, 7, 8, 7, skinColor);
  // Eyes
  d.set("14,10", "#1A1A2E"); d.set("15,10", "#1A1A2E");
  d.set("17,10", "#1A1A2E"); d.set("18,10", "#1A1A2E");
  // Mouth
  d.set("15,12", "#C8956C"); d.set("16,12", "#C8956C");
  // Neck
  drawRect(d, 14, 14, 4, 1, skinColor);
  // Body/shirt
  drawRect(d, 10, 15, 12, 7, shirtColor);
  // Arms
  drawRect(d, 8, 15, 2, 6, shirtColor);
  drawRect(d, 22, 15, 2, 6, shirtColor);
  // Hands
  drawRect(d, 8, 21, 2, 2, skinColor);
  drawRect(d, 22, 21, 2, 2, skinColor);
  // Pants
  drawRect(d, 11, 22, 4, 5, pantsColor);
  drawRect(d, 17, 22, 4, 5, pantsColor);
  // Shoes
  drawRect(d, 10, 27, 5, 2, "#2C1810");
  drawRect(d, 17, 27, 5, 2, "#2C1810");
  if (extras) extras(d);
  return d;
}

function generateKnight(): Map<string, string> {
  return generateCharacter("#FFDBB4", "#4A3728", "#94A3B8", "#1A1A2E", (d) => {
    // Helmet visor
    drawRect(d, 11, 4, 10, 2, "#94A3B8");
    drawRect(d, 13, 6, 6, 1, "#94A3B8");
    // Shield
    drawRect(d, 5, 16, 3, 5, "#2C6ECB");
    drawRect(d, 6, 17, 1, 3, "#FFD700");
    // Sword
    drawRect(d, 24, 14, 1, 8, "#C0C0C0");
    drawRect(d, 23, 13, 3, 1, "#FFD700");
  });
}

function generateMage(): Map<string, string> {
  return generateCharacter("#FFDBB4", "#E8D5B7", "#8B5CF6", "#4A3728", (d) => {
    // Wizard hat
    drawRect(d, 13, 1, 6, 1, "#8B5CF6");
    drawRect(d, 14, 2, 4, 1, "#8B5CF6");
    drawRect(d, 15, 3, 2, 1, "#8B5CF6");
    drawRect(d, 10, 4, 12, 2, "#8B5CF6");
    // Star on hat
    d.set("16,2", "#FFD700");
    // Staff
    drawRect(d, 25, 10, 1, 14, "#8B4513");
    drawRect(d, 24, 9, 3, 2, "#8B5CF6");
    d.set("25,8", "#FFD700");
  });
}

function generateArcher(): Map<string, string> {
  return generateCharacter("#E8B887", "#8B6914", "#29845A", "#4A3728", (d) => {
    // Hood
    drawRect(d, 11, 3, 10, 3, "#29845A");
    // Bow
    drawRect(d, 6, 13, 1, 10, "#8B4513");
    d.set("5,15", "#8B4513"); d.set("5,21", "#8B4513");
    // Arrow
    drawRect(d, 7, 17, 4, 1, "#8B4513");
    d.set("7,17", "#C0C0C0");
    // Quiver
    drawRect(d, 23, 15, 2, 5, "#8B4513");
  });
}

function generateMerchant(): Map<string, string> {
  return generateCharacter("#FFDBB4", "#C4A35A", "#DC143C", "#2C1810", (d) => {
    // Top hat
    drawRect(d, 12, 1, 8, 3, "#1A1A2E");
    drawRect(d, 10, 4, 12, 1, "#1A1A2E");
    // Gold coins
    d.set("6,19", "#FFD700"); d.set("7,18", "#FFD700");
    d.set("25,19", "#FFD700"); d.set("24,18", "#FFD700");
    // Bowtie
    drawRect(d, 14, 15, 4, 1, "#FFD700");
  });
}

function generateHealer(): Map<string, string> {
  return generateCharacter("#FFDBB4", "#D94000", "#FFFFFF", "#29845A", (d) => {
    // Cross on shirt
    drawRect(d, 15, 16, 2, 5, "#DC143C");
    drawRect(d, 13, 18, 6, 1, "#DC143C");
    // Halo
    drawRect(d, 13, 3, 6, 1, "#FFD700");
    d.set("12,4", "#FFD700"); d.set("19,4", "#FFD700");
  });
}

function generateRogue(): Map<string, string> {
  return generateCharacter("#C8956C", "#2C1810", "#1A1A2E", "#1A1A2E", (d) => {
    // Mask
    drawRect(d, 12, 9, 8, 2, "#1A1A2E");
    d.set("14,10", "#FFFFFF"); d.set("18,10", "#FFFFFF");
    // Daggers
    drawRect(d, 6, 18, 1, 5, "#C0C0C0");
    drawRect(d, 25, 18, 1, 5, "#C0C0C0");
    // Cape
    drawRect(d, 9, 16, 1, 8, "#4A3728");
    drawRect(d, 22, 16, 1, 8, "#4A3728");
  });
}

function generateViking(): Map<string, string> {
  return generateCharacter("#FFDBB4", "#B8860B", "#8B4513", "#4A3728", (d) => {
    // Viking helmet with horns
    drawRect(d, 11, 4, 10, 2, "#94A3B8");
    drawRect(d, 9, 3, 2, 3, "#E8D5B7"); // left horn
    drawRect(d, 21, 3, 2, 3, "#E8D5B7"); // right horn
    // Beard
    drawRect(d, 12, 13, 8, 3, "#B8860B");
    // Axe
    drawRect(d, 25, 13, 1, 9, "#8B4513");
    drawRect(d, 26, 14, 2, 3, "#94A3B8");
  });
}

function generateNinja(): Map<string, string> {
  return generateCharacter("#E8B887", "#1A1A2E", "#1A1A2E", "#1A1A2E", (d) => {
    // Face wrap - only eyes visible
    drawRect(d, 12, 7, 8, 2, "#1A1A2E");
    drawRect(d, 12, 11, 8, 3, "#1A1A2E");
    d.set("14,10", "#E8B887"); d.set("18,10", "#E8B887");
    // Headband
    drawRect(d, 11, 8, 10, 1, "#DC143C");
    // Shuriken
    d.set("6,17", "#C0C0C0"); d.set("7,16", "#C0C0C0");
    d.set("7,18", "#C0C0C0"); d.set("8,17", "#C0C0C0");
  });
}

function generatePirate(): Map<string, string> {
  return generateCharacter("#E8B887", "#2C1810", "#DC143C", "#1A1A2E", (d) => {
    // Pirate hat
    drawRect(d, 10, 2, 12, 3, "#1A1A2E");
    drawRect(d, 12, 1, 8, 1, "#1A1A2E");
    // Skull on hat
    d.set("15,3", "#FFFFFF"); d.set("16,3", "#FFFFFF");
    // Eye patch
    drawRect(d, 17, 9, 3, 2, "#1A1A2E");
    // Hook hand
    drawRect(d, 22, 21, 2, 1, "#FFD700");
    d.set("24, 22", "#FFD700");
  });
}

function generateWizard(): Map<string, string> {
  return generateCharacter("#FFDBB4", "#E8D5B7", "#2C6ECB", "#2C6ECB", (d) => {
    // Tall wizard hat
    drawRect(d, 14, 0, 4, 1, "#2C6ECB");
    drawRect(d, 13, 1, 6, 1, "#2C6ECB");
    drawRect(d, 12, 2, 8, 1, "#2C6ECB");
    drawRect(d, 11, 3, 10, 2, "#2C6ECB");
    // Stars on robe
    d.set("13,18", "#FFD700"); d.set("18,20", "#FFD700");
    // Long beard
    drawRect(d, 14, 13, 4, 4, "#E8D5B7");
    drawRect(d, 15, 17, 2, 2, "#E8D5B7");
    // Staff with orb
    drawRect(d, 25, 10, 1, 14, "#8B4513");
    drawRect(d, 24, 8, 3, 3, "#29845A");
  });
}

function generateWarrior(): Map<string, string> {
  return generateCharacter("#8D5524", "#2C1810", "#DC143C", "#4A3728", (d) => {
    // Headband
    drawRect(d, 11, 6, 10, 1, "#DC143C");
    // Shoulder pads
    drawRect(d, 8, 15, 2, 2, "#94A3B8");
    drawRect(d, 22, 15, 2, 2, "#94A3B8");
    // Sword
    drawRect(d, 25, 12, 1, 10, "#C0C0C0");
    drawRect(d, 24, 11, 3, 2, "#FFD700");
    // Shield
    drawRect(d, 5, 16, 3, 4, "#DC143C");
    d.set("6,17", "#FFD700"); d.set("6,18", "#FFD700");
  });
}

function generateBard(): Map<string, string> {
  return generateCharacter("#FFDBB4", "#D94000", "#29845A", "#8B4513", (d) => {
    // Feathered hat
    drawRect(d, 11, 3, 10, 3, "#29845A");
    drawRect(d, 20, 1, 2, 4, "#DC143C"); // feather
    // Lute
    drawRect(d, 5, 18, 3, 4, "#8B4513");
    drawRect(d, 6, 16, 1, 2, "#8B4513");
    drawRect(d, 8, 19, 2, 1, "#8B4513");
    // Music notes
    d.set("4,15", "#FFD700"); d.set("3,14", "#FFD700");
  });
}

function generateHeroOutline(): Map<string, string> {
  const d = new Map<string, string>();
  // Head outline
  [[10,5],[11,5],[12,5],[13,5],[14,5],[15,5],[16,5],[17,5],
   [9,6],[18,6],[8,7],[19,7],[8,8],[19,8],[8,9],[19,9],
   [7,10],[20,10],[7,11],[20,11],[8,12],[19,12],[8,13],[19,13],
   [9,14],[18,14]].forEach(([x,y]) => d.set(`${x},${y}`, "#000000"));
  // Body outline
  [[10,15],[11,15],[12,15],[13,15],[14,15],[15,15],[16,15],[17,15],
   [9,16],[18,16],[8,17],[19,17],
   [8,18],[10,18],[17,18],[19,18],
   [8,19],[10,19],[17,19],[19,19],
   [8,20],[10,20],[17,20],[19,20],
   [8,21],[9,21],[10,21],[17,21],[18,21],[19,21],
   [10,22],[17,22],[10,23],[17,23],
   [10,24],[13,24],[14,24],[17,24],
   [10,25],[11,25],[12,25],[15,25],[16,25],[17,25]].forEach(([x,y]) => d.set(`${x},${y}`, "#000000"));
  // Fill head with skin
  drawRect(d, 11, 6, 7, 1, "#FFDBB4");
  drawRect(d, 9, 7, 10, 6, "#FFDBB4");
  drawRect(d, 8, 10, 1, 2, "#FFDBB4");
  drawRect(d, 10, 14, 8, 1, "#FFDBB4");
  // Eyes
  d.set("11,9", "#1A1A2E"); d.set("12,9", "#1A1A2E");
  d.set("15,9", "#1A1A2E"); d.set("16,9", "#1A1A2E");
  // Mouth
  d.set("13,12", "#C8956C"); d.set("14,12", "#C8956C");
  // Hair
  drawRect(d, 10, 5, 8, 2, "#4A3728");
  // Body fill - shirt
  drawRect(d, 10, 16, 8, 1, "#DC143C");
  drawRect(d, 9, 17, 10, 1, "#DC143C");
  // Arms
  drawRect(d, 9, 18, 1, 4, "#DC143C");
  drawRect(d, 18, 18, 1, 4, "#DC143C");
  // Torso
  drawRect(d, 11, 18, 6, 4, "#DC143C");
  // Pants
  drawRect(d, 11, 22, 6, 2, "#2C6ECB");
  // Legs
  drawRect(d, 11, 24, 2, 2, "#2C6ECB");
  drawRect(d, 15, 24, 2, 2, "#2C6ECB");
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
  const [activeTab, setActiveTab] = useState<"premade" | "custom">("premade");
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
        {(["premade", "custom"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: "10px 16px", background: "none", border: "none",
              borderBottom: activeTab === tab ? "2px solid #2c6ecb" : "2px solid transparent",
              cursor: "pointer", fontSize: 14, fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? "#202223" : "#6d7175",
            }}
          >
            {tab === "premade" ? "Pre-made Characters" : "Custom Editor"}
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
