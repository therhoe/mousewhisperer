import { catalog } from "./catalog";
export const zhCN: Record<string, string> = Object.fromEntries(
  Object.entries(catalog).map(([key, values]) => [key, values[1]]),
);
