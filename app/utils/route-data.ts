import { data } from "react-router";

type Jsonify<T> = T extends { toJSON(): infer R }
  ? R
  : T extends bigint | symbol | ((...args: never[]) => unknown)
    ? never
    : T extends readonly (infer U)[]
      ? Jsonify<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonify<T[K]> }
        : T;

/**
 * Remix-style json() for screen route loaders and actions on React Router 7.
 * The body goes through JSON first, so screens receive exactly what Remix's
 * json() sent (dates as ISO strings, undefined fields dropped); then it is
 * wrapped in React Router's data() so status and headers still apply.
 * API and webhook routes return Response.json() instead. New code should
 * return plain objects or data() directly.
 */
export function json<T>(body: T, init?: number | ResponseInit) {
  const parsed = JSON.parse(JSON.stringify(body) ?? "null") as Jsonify<T>;
  return data(parsed, init);
}
