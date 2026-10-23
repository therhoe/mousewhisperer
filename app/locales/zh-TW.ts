import { catalog } from "./catalog";
export const zhTW: Record<string, string> = Object.fromEntries(
  Object.entries(catalog).map(([key, values]) => [key, values[2]]),
);
