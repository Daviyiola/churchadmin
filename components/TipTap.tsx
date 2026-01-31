"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
} from "react";
import { EditorContent, useEditor, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";

import { TextStyle } from "@tiptap/extension-text-style";

import { Extension, type CommandProps } from "@tiptap/core";
import { NodeSelection } from "prosemirror-state";
import type { Mark } from "prosemirror-model";

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

type ImageAlign = "left" | "center" | "right";

export type TipTapHandle = {
  getHtml: () => string;
  setHtml: (html: string) => void;
  focus: () => void;

  insertImage: (opts: {
    src: string;
    alt?: string;
    uploadId?: string;
    align?: ImageAlign;
  }) => void;

  removeImagesByUploadId: (uploadId: string) => void;
  setImageAlignByUploadId: (uploadId: string, align: ImageAlign) => void;

  // Align selected image OR paragraph text
  setAlign: (align: ImageAlign) => void;
};

type Props = {
  valueHtml: string;
  onChangeHtml: (html: string) => void;
  minHeight?: number;
  maxHeight?: number;
};

/* ------------------------------------------------------------------ */
/* Module augmentation: make custom commands TS-aware (no “does not exist”) */
/* ------------------------------------------------------------------ */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

/* ------------------------------------------------------------------ */
/* Utils */
/* ------------------------------------------------------------------ */

function clampHeightStyle(minHeight?: number, maxHeight?: number) {
  return {
    minHeight: minHeight ? `${minHeight}px` : undefined,
    maxHeight: maxHeight ? `${maxHeight}px` : undefined,
  } as React.CSSProperties;
}

function alignToStyle(align: ImageAlign): string {
  if (align === "left") return "display:block;margin:0 auto 0 0;";
  if (align === "right") return "display:block;margin:0 0 0 auto;";
  return "display:block;margin:0 auto;";
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function getStringAttr(
  attrs: Record<string, unknown>,
  key: string,
): string | null {
  const v = attrs[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/* ------------------------------------------------------------------ */
/* Custom Image (uploadId + align) */
/* ------------------------------------------------------------------ */

const CustomImage = Image.extend({
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),

      uploadId: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-upload-id"),
        renderHTML: (attrs: { uploadId?: string | null }) =>
          attrs.uploadId ? { "data-upload-id": attrs.uploadId } : {},
      },

      align: {
        default: "center" as ImageAlign,
        parseHTML: (el: HTMLElement) =>
          (el.getAttribute("data-align") as ImageAlign | null) ?? "center",
        renderHTML: (attrs: { align?: ImageAlign }) => ({
          "data-align": attrs.align ?? "center",
          style: alignToStyle(attrs.align ?? "center"),
        }),
      },
    };
  },
});

/* ------------------------------------------------------------------ */
/* FontSize extension (strict TS) */
/* ------------------------------------------------------------------ */

const FontSize = Extension.create({
  name: "fontSize",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontSize || null,
            renderHTML: (attrs: { fontSize?: string | null }) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize: (fontSize: string) => (props: CommandProps) =>
        props.chain().setMark("textStyle", { fontSize }).run(),

      unsetFontSize: () => (props: CommandProps) =>
        props.chain().setMark("textStyle", { fontSize: null }).run(),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Indent extension for paragraphs (lists handled via sink/liftListItem) */
/* ------------------------------------------------------------------ */

const INDENT_STEP_PX = 24;
const INDENT_MAX_LEVEL = 6;

const Indent = Extension.create({
  name: "indent",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => {
              const raw = el.getAttribute("data-indent");
              const n = raw ? Number(raw) : 0;
              return Number.isFinite(n) && n >= 0 ? n : 0;
            },
            renderHTML: (attrs: { indent?: number }) => {
              const lvl = typeof attrs.indent === "number" ? attrs.indent : 0;
              if (!lvl) return {};
              return {
                "data-indent": String(lvl),
                style: `margin-left: ${lvl * INDENT_STEP_PX}px;`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const clamp = (n: number) => Math.max(0, Math.min(INDENT_MAX_LEVEL, n));

    return {
      indent: () => (props: CommandProps) => {
        const { state } = props;
        const parent = state.selection.$from.parent;
        if (parent.type.name !== "paragraph") return false;

        const cur =
          typeof parent.attrs.indent === "number" ? parent.attrs.indent : 0;
        const next = clamp(cur + 1);

        return props.chain().setNode("paragraph", { indent: next }).run();
      },

      outdent: () => (props: CommandProps) => {
        const { state } = props;
        const parent = state.selection.$from.parent;
        if (parent.type.name !== "paragraph") return false;

        const cur =
          typeof parent.attrs.indent === "number" ? parent.attrs.indent : 0;
        const next = clamp(cur - 1);

        return props.chain().setNode("paragraph", { indent: next }).run();
      },
    };
  },
});

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export const TipTap = forwardRef<TipTapHandle, Props>(function TipTap(
  { valueHtml, onChangeHtml, minHeight = 200, maxHeight = 500 },
  ref,
) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({ underline: false, link: false }),
      Underline,

      // Text styling
      TextStyle,
      FontFamily,
      FontSize,
      Color,

      // Links
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),

      // Paragraph indent (non-list)
      Indent,

      // Align paragraphs
      TextAlign.configure({ types: ["paragraph"] }),

      // Images
      CustomImage.configure({ inline: false, allowBase64: true }),
    ],
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: valueHtml || "<p></p>",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none px-4 py-3 " +
          "prose-ul:list-disc prose-ol:list-decimal " +
          "prose-ul:pl-6 prose-ol:pl-6 " +
          "prose-li:my-1" +
          "prose-a:text-blue-600 prose-a:underline prose-a:underline-offset-2",
      },
    },
    onUpdate({ editor }) {
      onChangeHtml(editor.getHTML());
    },
  });

  // Sync external html -> editor
  useEffect(() => {
    if (!editor) return;
    const cur = editor.getHTML();
    if (cur !== valueHtml) {
      editor.commands.setContent(valueHtml || "<p></p>", { emitUpdate: false });
    }
  }, [editor, valueHtml]);

  useImperativeHandle(ref, () => ({
    getHtml: () => editor?.getHTML() ?? "",

    setHtml: (html) =>
      editor?.commands.setContent(html || "<p></p>", { emitUpdate: false }),

    focus: () => editor?.commands.focus(),

    insertImage: ({ src, alt, uploadId, align }) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: {
            src,
            alt: alt ?? "",
            uploadId: uploadId ?? null,
            align: align ?? "center",
          },
        })
        .run();
    },

    removeImagesByUploadId: (uploadId: string) => {
      if (!editor) return;

      const { state, view } = editor;
      const { tr } = state;

      const positions: Array<{ pos: number; size: number }> = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && node.attrs.uploadId === uploadId) {
          positions.push({ pos, size: node.nodeSize });
        }
        return true;
      });

      for (let i = positions.length - 1; i >= 0; i--) {
        const { pos, size } = positions[i];
        tr.delete(pos, pos + size);
      }

      if (tr.docChanged) view.dispatch(tr);
    },

    setImageAlignByUploadId: (uploadId: string, align: ImageAlign) => {
      if (!editor) return;

      const { state, view } = editor;
      const { tr } = state;

      state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && node.attrs.uploadId === uploadId) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
        }
        return true;
      });

      if (tr.docChanged) view.dispatch(tr);
    },

    setAlign: (align: ImageAlign) => {
      if (!editor) return;

      const sel = editor.state.selection;
      if (sel instanceof NodeSelection && sel.node.type.name === "image") {
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.setNodeMarkup(sel.from, undefined, {
              ...sel.node.attrs,
              align,
            });
            return true;
          })
          .run();
        return;
      }

      editor.chain().focus().setTextAlign(align).run();
    },
  }));

  if (!editor) {
    return (
      <div className="rounded-2xl border bg-white px-4 py-3 text-sm text-slate-600">
        Loading editor…
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white overflow-hidden">
      {/* Selected node highlight (click image -> highlight) */}
      <style jsx global>{`
        .ProseMirror-selectednode {
          outline: 2px solid rgba(59, 130, 246, 0.8);
          border-radius: 12px;
        }
      `}</style>

      <style jsx global>{`
        .ProseMirror {
          max-width: 600px;
          margin: 0 auto;
        }

        .ProseMirror ul {
          list-style-type: disc !important;
          padding-left: 1.5rem !important;
          margin: 0.5rem 0 !important;
        }
        .ProseMirror ol {
          list-style-type: decimal !important;
          padding-left: 1.5rem !important;
          margin: 0.5rem 0 !important;
        }
        .ProseMirror li {
          margin: 0.25rem 0 !important;
        }
        .ProseMirror a {
          color: #2563eb !important; /* blue-600 */
          text-decoration: underline !important;
          text-underline-offset: 2px !important;
        }
      `}</style>

      <Toolbar editor={editor} />

      <div
        className="overflow-auto"
        style={clampHeightStyle(minHeight, maxHeight)}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Toolbar */
/* ------------------------------------------------------------------ */

function Toolbar({ editor }: { editor: Editor }) {
  const fonts = [
    { key: "arial", label: "Arial", css: "Arial, sans-serif" },
    {
      key: "helvetica",
      label: "Helvetica",
      css: "Helvetica, Arial, sans-serif",
    },
    { key: "georgia", label: "Georgia", css: "Georgia, serif" },
    {
      key: "times",
      label: "Times New Roman",
      css: '"Times New Roman", Times, serif',
    },
    {
      key: "courier",
      label: "Courier New",
      css: '"Courier New", Courier, monospace',
    },
  ] as const;

  type FontKey = (typeof fonts)[number]["key"];
  type SizeValue =
    | "12px"
    | "14px"
    | "16px"
    | "18px"
    | "20px"
    | "24px"
    | "28px"
    | "32px";

  const sizes: readonly SizeValue[] = [
    "12px",
    "14px",
    "16px",
    "18px",
    "20px",
    "24px",
    "28px",
    "32px",
  ];

  function collectMarkValues<T>(get: (m: Mark) => T | null): Set<T> {
    const set = new Set<T>();
    const { from, to, empty } = editor.state.selection;
    if (empty) return set;

    editor.state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;
      node.marks.forEach((m) => {
        const v = get(m);
        if (v !== null) set.add(v);
      });
    });

    return set;
  }

  // Cursor-only fallback: textStyle attrs at selection
  const textStyleAttrs = editor.getAttributes("textStyle") as Record<
    string,
    unknown
  >;
  const linkAttrs = editor.getAttributes("link") as Record<string, unknown>;

  // Font (mixed-aware)
  const fontSet = collectMarkValues<string>((m) => {
    if (m.type.name !== "textStyle") return null;
    const ff = getStringAttr(m.attrs as Record<string, unknown>, "fontFamily");
    return ff ? normalize(ff) : null;
  });

  const currentFont: FontKey | "mixed" =
    fontSet.size === 1
      ? (fonts.find((f) => normalize(f.css) === [...fontSet][0])?.key ??
        "arial")
      : fontSet.size > 1
        ? "mixed"
        : (() => {
            const ff = getStringAttr(textStyleAttrs, "fontFamily");
            if (!ff) return "arial";
            return (
              fonts.find((f) => normalize(f.css) === normalize(ff))?.key ??
              "arial"
            );
          })();

  // Size (mixed-aware)
  const sizeSet = collectMarkValues<string>((m) => {
    if (m.type.name !== "textStyle") return null;
    const fs = getStringAttr(m.attrs as Record<string, unknown>, "fontSize");
    return fs ? normalize(fs) : null;
  });

  const currentSize: SizeValue | "mixed" =
    sizeSet.size === 1
      ? (sizes.find((s) => normalize(s) === [...sizeSet][0]) ?? "16px")
      : sizeSet.size > 1
        ? "mixed"
        : (() => {
            const fs = getStringAttr(textStyleAttrs, "fontSize");
            if (!fs) return "16px";
            return sizes.find((s) => normalize(s) === normalize(fs)) ?? "16px";
          })();

  // Color (mixed-aware)
  const colorSet = collectMarkValues<string>((m) => {
    if (m.type.name !== "textStyle") return null;
    const c = getStringAttr(m.attrs as Record<string, unknown>, "color");
    return c ? normalize(c) : null;
  });

  const currentColor: string | "mixed" =
    colorSet.size === 1
      ? [...colorSet][0]
      : colorSet.size > 1
        ? "mixed"
        : (() =>
            normalize(getStringAttr(textStyleAttrs, "color") ?? "#000000"))();

  // Align text OR selected image
  function getSelectedImageAlign(): ImageAlign | null {
    const sel = editor.state.selection;
    if (sel instanceof NodeSelection && sel.node.type.name === "image") {
      const a = sel.node.attrs.align;
      return a === "left" || a === "center" || a === "right"
        ? (a as ImageAlign)
        : "center";
    }
    return null;
  }

  function setAlign(align: ImageAlign) {
    const sel = editor.state.selection;
    if (sel instanceof NodeSelection && sel.node.type.name === "image") {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, align });
          return true;
        })
        .run();
      return;
    }
    editor.chain().focus().setTextAlign(align).run();
  }

  function isAlignActive(align: ImageAlign) {
    const imgAlign = getSelectedImageAlign();
    if (imgAlign) return imgAlign === align;
    return editor.isActive({ textAlign: align });
  }

  // Indent/outdent
  function indent() {
    if (editor.isActive("listItem")) {
      editor.chain().focus().sinkListItem("listItem").run();
      return;
    }
    editor.chain().focus().indent().run();
  }

  function outdent() {
    if (editor.isActive("listItem")) {
      editor.chain().focus().liftListItem("listItem").run();
      return;
    }
    editor.chain().focus().outdent().run();
  }

  // Links
  const activeLink = editor.isActive("link");
  const currentHref = getStringAttr(linkAttrs, "href") ?? "";

  function setOrEditLink() {
    // If selection is empty and not in a link, we can still allow adding by using extendMarkRange("link")
    const initial = currentHref || "https://";
    const entered = window.prompt("Enter link URL", initial);
    if (entered === null) return;

    const href = entered.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  }

  const colorValueForPicker =
    currentColor === "mixed" ? "#000000" : currentColor;

  return (
    <div className="border-b bg-slate-50 px-3 py-2 flex flex-wrap gap-2 items-center">
      {/* Font family */}
      <select
        className="rounded-xl border bg-white px-2 py-1 text-sm"
        value={currentFont}
        onChange={(e) => {
          const v = e.target.value as FontKey | "mixed";
          if (v === "mixed") return;
          const f = fonts.find((x) => x.key === v);
          if (!f) return;
          editor.chain().focus().setFontFamily(f.css).run();
        }}
      >
        {currentFont === "mixed" ? <option value="mixed">Mixed</option> : null}
        {fonts.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>

      {/* Font size */}
      <select
        className="rounded-xl border bg-white px-2 py-1 text-sm"
        value={currentSize}
        onChange={(e) => {
          const v = e.target.value as SizeValue | "mixed";
          if (v === "mixed") return;
          editor.chain().focus().setFontSize(v).run();
        }}
      >
        {currentSize === "mixed" ? <option value="mixed">Mixed</option> : null}
        {sizes.map((s) => (
          <option key={s} value={s}>
            {s.replace("px", "")}
          </option>
        ))}
      </select>

      {/* Text color */}
      <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-2 py-1 text-sm">
        <span className="text-slate-700">
          {currentColor === "mixed" ? "Color: Mixed" : "Color"}
        </span>
        <input
          aria-label="Text color"
          type="color"
          value={colorValueForPicker}
          onChange={(e) =>
            editor.chain().focus().setColor(e.target.value).run()
          }
          className="h-6 w-8 border-0 bg-transparent p-0"
        />
        <button
          type="button"
          className="rounded-lg border px-2 py-0.5 text-xs hover:bg-slate-50"
          onClick={() => editor.chain().focus().unsetColor().run()}
          title="Reset color"
        >
          Reset
        </button>
      </label>

      <div className="h-6 w-px bg-slate-200 mx-1" />

      {/* Inline styles */}
      <button
        type="button"
        className={btn(editor.isActive("bold"))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        Bold
      </button>
      <button
        type="button"
        className={btn(editor.isActive("italic"))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        Italic
      </button>
      <button
        type="button"
        className={btn(editor.isActive("underline"))}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        Underline
      </button>

      <div className="h-6 w-px bg-slate-200 mx-1" />

      {/* Lists */}
      <button
        type="button"
        className={btn(editor.isActive("bulletList"))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        Bullets
      </button>
      <button
        type="button"
        className={btn(editor.isActive("orderedList"))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        Numbering
      </button>

      {/* Indent / Outdent */}
      <button type="button" className={btn(false)} onClick={outdent}>
        Outdent
      </button>
      <button type="button" className={btn(false)} onClick={indent}>
        Indent
      </button>

      <div className="h-6 w-px bg-slate-200 mx-1" />

      {/* Links */}
      <button
        type="button"
        className={btn(activeLink)}
        onClick={setOrEditLink}
        title={activeLink ? `Edit link (${currentHref})` : "Add link"}
      >
        Link
      </button>
      <button
        type="button"
        className={btn(false)}
        onClick={removeLink}
        disabled={!activeLink}
        title="Remove link"
      >
        Unlink
      </button>

      <div className="h-6 w-px bg-slate-200 mx-1" />

      {/* Align */}
      <button
        type="button"
        className={btn(isAlignActive("left"))}
        onClick={() => setAlign("left")}
      >
        Left
      </button>
      <button
        type="button"
        className={btn(isAlignActive("center"))}
        onClick={() => setAlign("center")}
      >
        Center
      </button>
      <button
        type="button"
        className={btn(isAlignActive("right"))}
        onClick={() => setAlign("right")}
      >
        Right
      </button>
    </div>
  );
}

function btn(active: boolean) {
  return `rounded-xl border px-3 py-1 text-sm ${
    active ? "bg-white shadow-sm" : "bg-transparent hover:bg-white"
  }`;
}
