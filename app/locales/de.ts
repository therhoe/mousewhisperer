import { catalog } from "./catalog";
export const de: Record<string, string> = Object.fromEntries(
  Object.entries(catalog).map(([key, values]) => [key, values[0]]),
);
