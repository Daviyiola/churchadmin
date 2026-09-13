import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["childNode"];
export const EMAIL_BODY_STYLE = "box-sizing:border-box;width:100%;max-width:600px;margin:0 auto;padding:16px;background-color:#ffffff;color:#171717;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;overflow-wrap:break-word;text-align:left";
const styles: Record<string, string> = {
  p: "margin:0;line-height:1.5;min-height:1.5em",
  ul: "list-style-type:disc;padding-left:24px;margin:8px 0",
  ol: "list-style-type:decimal;padding-left:24px;margin:8px 0",
  li: "margin:4px 0",
  a: "color:#2563eb;text-decoration:underline",
  strong: "font-weight:700", b: "font-weight:700", em: "font-style:italic", i: "font-style:italic",
  u: "text-decoration:underline", s: "text-decoration:line-through", strike: "text-decoration:line-through",
  h1: "font-size:32px;font-weight:700;line-height:1.25;margin:16px 0 8px",
  h2: "font-size:24px;font-weight:700;line-height:1.25;margin:16px 0 8px",
  h3: "font-size:20px;font-weight:700;line-height:1.25;margin:16px 0 8px",
  blockquote: "border-left:3px solid #cbd5e1;margin:12px 0;padding-left:16px",
  pre: "white-space:pre-wrap;font-family:monospace;background-color:#f1f5f9;padding:12px;margin:12px 0",
  code: "font-family:monospace",
  hr: "border:0;border-top:1px solid #cbd5e1;margin:16px 0",
  img: "display:block;max-width:100%;height:auto;border:0;margin:0 auto",
};

/** The editable canvas and outbound HTML share these exact defaults. */
export const EMAIL_EDITOR_CSS = `.email-editor{${EMAIL_BODY_STYLE};white-space:pre-wrap;outline:none}` +
  Object.entries(styles).map(([tag, style]) => `.email-editor ${tag}{${style}}`).join("");

export function escapeEmailHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const allowedTags = new Set([...Object.keys(styles), "span", "div", "br"]);
const dropTags = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "head", "template"]);
const allowedStyles = new Set(["color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "margin-left", "margin-right", "margin", "width", "height"]);
function inlineStyles(value: string) {
  return value.split(";").flatMap(part => {
    const colon = part.indexOf(":");
    const property = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim();
    if (colon < 0 || !allowedStyles.has(property) || !val || /url\s*\(|expression|var\s*\(|[<>\\{}@!]/i.test(val)) return [];
    return [`${property}:${val}`];
  }).join(";");
}

export type InlineEmailImage = { id: string; inline_cid: string | null; upload_mode: string | null; preview_url?: string | null; path?: string };

/** Parse HTML rather than matching attribute order; signed URLs never enter sent inline images. */
export function renderEmailBody(html: string, images: InlineEmailImage[] = []) {
  const fragment = parseFragment(html);
  function render(node: Node, preserveWhitespace = false): string {
    if (node.nodeName === "#text") {
      const raw = (node as DefaultTreeAdapterMap["textNode"]).value;
      if (preserveWhitespace) return escapeEmailHtml(raw);
      const value = /[\r\n\t]/.test(raw) ? raw.replace(/\s+/g, " ") : raw;
      return escapeEmailHtml(value).replace(/ {2,}/g, spaces => "&nbsp;".repeat(spaces.length));
    }
    if (!("tagName" in node)) return "";
    const tag = node.tagName;
    if (dropTags.has(tag)) return "";
    const children = node.childNodes.map(child => render(child, preserveWhitespace || tag === "pre")).join("");
    if (!allowedTags.has(tag)) return children;
    const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
    // Do not wrap a previously rendered message twice when retrying old campaigns.
    if (attrs["data-email-body"] === "true") return children;
    let attributes = "";
    let style = [styles[tag], inlineStyles(attrs.style ?? "")].filter(Boolean).join(";");
    if (tag === "img") {
      const upload = images.find(image => image.upload_mode === "inline" && image.inline_cid && (
        attrs["data-upload-id"] === image.id || attrs.src === image.preview_url ||
        (image.path && (attrs.src ?? "").split("?")[0].endsWith(`/${image.path}`))
      ));
      const src = upload ? `cid:${upload.inline_cid}` : attrs.src ?? "";
      if (!/^(https?:\/\/|cid:)/i.test(src)) return "";
      attributes += ` src="${escapeEmailHtml(src)}" alt="${escapeEmailHtml(attrs.alt ?? "")}"`;
      if (attrs["data-upload-id"]) attributes += ` data-upload-id="${escapeEmailHtml(attrs["data-upload-id"])}"`;
      const align = attrs["data-align"];
      if (["left", "center", "right"].includes(align)) {
        attributes += ` align="${align}" data-align="${align}"`;
        style += `;margin:${align === "left" ? "0 auto 0 0" : align === "right" ? "0 0 0 auto" : "0 auto"}`;
      }
    }
    if (tag === "a" && /^(https?:\/\/|mailto:|tel:)/i.test(attrs.href ?? "")) attributes += ` href="${escapeEmailHtml(attrs.href)}"`;
    if (tag === "ol" && /^\d+$/.test(attrs.start ?? "")) attributes += ` start="${attrs.start}"`;
    if (style) attributes += ` style="${escapeEmailHtml(style)}"`;
    if (["img", "br", "hr"].includes(tag)) return `<${tag}${attributes}>`;
    // Empty TipTap paragraphs occupy a line; HTML email clients otherwise collapse them.
    const content = tag === "p" && !children.trim() ? "&nbsp;"
      : tag === "p" && /<br>\s*$/.test(children) ? `${children}&nbsp;` : children;
    return `<${tag}${attributes}>${content}</${tag}>`;
  }
  return `<div data-email-body="true" style="${EMAIL_BODY_STYLE}">${fragment.childNodes.map(child => render(child)).join("")}</div>`;
}

export function renderEmailDocument(html: string, images: InlineEmailImage[] = []) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background-color:#ffffff;color:#171717">${renderEmailBody(html, images)}</body></html>`;
}
