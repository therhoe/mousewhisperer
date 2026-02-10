import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "ul", "ol", "li",
  "a", "code", "pre", "blockquote", "h1", "h2", "h3",
];

const ALLOWED_ATTR = ["href", "target", "rel"];

export function sanitizeHTML(dirty: string): string {
  const clean = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });

  // Ensure all links have safe attributes
  return clean.replace(
    /<a\s/g,
    '<a rel="noopener noreferrer" target="_blank" ',
  );
}
