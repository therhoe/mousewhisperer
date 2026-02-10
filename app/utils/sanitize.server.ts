import sanitize from "sanitize-html";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "ul", "ol", "li",
  "a", "code", "pre", "blockquote", "h1", "h2", "h3",
];

export function sanitizeHTML(dirty: string): string {
  return sanitize(dirty, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href"],
    },
    transformTags: {
      a: sanitize.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer",
      }),
    },
  });
}
