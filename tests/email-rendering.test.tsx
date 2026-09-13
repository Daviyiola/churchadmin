// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { renderEmailBody, renderEmailDocument } from "@/lib/email/render";
import EmailPreview from "@/components/EmailPreview";
import { TipTap, type TipTapHandle } from "@/components/TipTap";
import { emailCampaignContent } from "@/lib/email/campaign";
afterEach(cleanup);
it("includes both attachment and inline selections in test campaign content", () => {
  const payload = emailCampaignContent({ organizationId: "org", subject: "[Test] Hello", html: "<p>Hello</p>", uploads: [
    { upload_id: "file", mode: "attachment", inline_cid: "old-inline-id" },
    { upload_id: "image", mode: "inline", inline_cid: "logo" },
  ] });
  expect(JSON.parse(JSON.stringify(payload)).uploads).toEqual([
    { upload_id: "file", upload_mode: "attachment" }, { upload_id: "image", upload_mode: "inline", inline_cid: "logo" },
  ]);
});
const dom = (html: string) => new DOMParser().parseFromString(html, "text/html");
it("preserves paragraph lines, soft breaks, and intentionally empty styled paragraphs", () => {
  const document = dom(renderEmailBody('<p>First<br>Second</p><p></p><p style="text-align:center"><br></p><p>Last</p>'));
  const paragraphs = document.querySelectorAll("p");
  expect(paragraphs).toHaveLength(4);
  expect(paragraphs[0].querySelectorAll("br")).toHaveLength(1);
  expect(paragraphs[1].textContent).toBe("\u00a0"); expect(paragraphs[2].textContent).toBe("\u00a0");
  expect(paragraphs[2].style.textAlign).toBe("center"); expect(paragraphs[0].style.margin).toBe("0px");
});
it("preserves colors, fonts, size, emphasis, list starts and indentation inline", () => {
  const document = dom(renderEmailBody('<p style="margin-left:48px;text-align:right"><span style="font-family:Georgia,serif;font-size:24px;color:#c026d3"><strong><em><u>Chosen</u></em></strong></span></p><ol start="3"><li><p>Third</p></li></ol><a href="https://example.com" style="color:#dc2626">Link</a>'));
  expect(document.querySelector("span")?.style.fontSize).toBe("24px");
  expect(document.querySelector("span")?.style.color).toBe("rgb(192, 38, 211)");
  expect(document.querySelector("p")?.style.marginLeft).toBe("48px");
  expect(document.querySelector("a")?.style.color).toBe("rgb(220, 38, 38)");
  expect(document.querySelector("ol")?.start).toBe(3);
  expect(document.querySelector("strong")?.style.fontWeight).toBe("700");
});
it.each(['src="https://example.com/expired" data-upload-id="image"', 'data-upload-id="image" src="https://example.com/expired"'])("embeds inline images regardless of attribute order: %s", attrs => {
  const document = dom(renderEmailDocument(`<img ${attrs} data-align="right">`, [{ id: "image", inline_cid: "logo", upload_mode: "inline" }]));
  expect(document.querySelector("img")?.getAttribute("src")).toBe("cid:logo");
  expect(document.querySelector("img")?.getAttribute("align")).toBe("right");
  expect(document.querySelector("img")?.style.maxWidth).toBe("100%");
});
it("does not turn a regular attachment into an inline image", () => {
  expect(renderEmailDocument('<p>See attached</p>', [{ id: "image", inline_cid: null, upload_mode: "attachment" }])).not.toContain("cid:");
});
it("keeps a trailing soft break visible and preserves preformatted text", () => {
  const document = dom(renderEmailBody('<p>First<br></p><pre><code>first\n  second</code></pre>'));
  expect(document.querySelector("p")?.innerHTML).toBe("First<br>&nbsp;");
  expect(document.querySelector("code")?.textContent).toBe("first\n  second");
});
it("removes active markup and unsafe links/styles from the preview and delivered body", () => {
  const result = renderEmailDocument('<script>alert(1)</script><p onclick="alert(1)" style="color:red;background-color:url(https://evil)">Hello</p><a href="javascript:alert(1)">Link</a><img src="x" onerror="alert(1)">');
  expect(result).not.toMatch(/<script|onclick|onerror|javascript:|evil/);
  expect(result).toContain("color:red");
});
it("isolates the preview from app CSS using the exact outbound document", () => {
  render(<EmailPreview html="<p>Hello</p>" />);
  const frame = screen.getByTitle("Email message preview");
  expect(frame.getAttribute("srcdoc")).toBe(renderEmailDocument("<p>Hello</p>"));
  expect(frame.getAttribute("sandbox")).toBe("");
});
it("round-trips real editor formatting into the email without adding paragraph gaps", async () => {
  const ref = createRef<TipTapHandle>();
  render(<TipTap ref={ref} valueHtml='<p>First<br>Second</p><p></p><p style="text-align:center"><span style="font-size:24px;color:#ff0000">Third</span></p>' onChangeHtml={vi.fn()} />);
  await waitFor(() => expect(ref.current?.getHtml()).toContain("Third"));
  const document = dom(renderEmailDocument(ref.current!.getHtml()));
  expect(document.querySelectorAll("p")).toHaveLength(3);
  expect(document.querySelectorAll("br")).toHaveLength(1);
  expect(document.querySelector("span")?.style.fontSize).toBe("24px");
  expect(document.querySelectorAll("p")[1].textContent).toBe("\u00a0");
});
