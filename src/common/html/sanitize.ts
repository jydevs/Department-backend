import sanitizeHtml from "sanitize-html";

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "ul", "ol", "li", "h2", "h3", "h4", "a", "img"],
  allowedAttributes: { a: ["href", "rel"], img: ["src", "alt"] },
  allowedSchemes: [],
  allowedSchemesByTag: { a: ["https", "mailto", "tel"], img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true) },
};

/**
 * Single whitelist sanitiser for every rich-text field (product / collection description, CSV `Body (HTML)`):
 * scripts, styles, event handlers and non-https links/images are dropped.
 */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS).trim();
}
