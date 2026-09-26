import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "tiptap-markdown";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { assetUrl, assetUrlToPath, backend } from "../lib/backend";
import { useUi } from "../store/ui";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

/**
 * Images are stored with dungeon-root-relative paths (`assets/x.png`) but the
 * webview needs asset-protocol URLs to display them. The node keeps the
 * relative path; only the rendered DOM uses the resolved URL.
 */
const DungeonImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const src = el.getAttribute("src");
          const dir = useUi.getState().dungeonDir;
          return src && dir ? (assetUrlToPath(dir, src) ?? src) : src;
        },
        renderHTML: (attrs: { src?: string | null }) => {
          const dir = useUi.getState().dungeonDir;
          return { src: attrs.src && dir ? assetUrl(dir, attrs.src) : attrs.src };
        },
      },
    };
  },
}).configure({ inline: true });

function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
}

function isExternalUrl(href: string) {
  return /^(https?:|mailto:)/i.test(href);
}

interface Props {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Extra class for sizing (e.g. "tall"). */
  className?: string;
  autoFocus?: boolean;
}

export function MarkdownEditor({ value, onChange, placeholder, className, autoFocus }: Props) {
  const lastEmitted = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      DungeonImage,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      Markdown.configure({ html: false, linkify: true, transformPastedText: true, breaks: false }),
    ],
    content: value,
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor }) => {
      const md = getMarkdown(editor);
      if (md === lastEmitted.current) return;
      lastEmitted.current = md;
      onChangeRef.current(md);
    },
    editorProps: {
      handleDOMEvents: {
        click: (_view, event) => {
          const a = (event.target as HTMLElement).closest("a");
          const href = a?.getAttribute("href");
          if (!href) return false;
          event.preventDefault();
          if ((event.metaKey || event.ctrlKey) && isExternalUrl(href)) void openUrl(href);
          return true;
        },
      },
    },
  });

  // External changes (undo/redo, switching rooms) replace the content.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={`md-editor ${className ?? ""}`}>
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="md-content" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
    }),
  });

  const insertImage = async () => {
    const dir = useUi.getState().dungeonDir;
    if (!dir) return;
    const picked = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
    });
    if (typeof picked !== "string") return;
    try {
      const rel = await backend.importAsset(dir, picked);
      const alt = rel.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
      editor.chain().focus().setImage({ src: rel, alt }).run();
    } catch (e) {
      useUi.getState().showToast(`Could not add image: ${e}`);
    }
  };

  const applyLink = (url: string) => {
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url.trim() === "") chain.unsetLink().run();
    else chain.setLink({ href: url.trim() }).run();
    setLinkInput(null);
  };

  const btn = (label: string, title: string, active: boolean, run: () => void) => (
    <button
      type="button"
      className={`md-btn ${active ? "active" : ""}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );

  return (
    <div className="md-toolbar">
      {btn("B", "Bold (⌘B)", state.bold, () => editor.chain().focus().toggleBold().run())}
      {btn("I", "Italic (⌘I)", state.italic, () => editor.chain().focus().toggleItalic().run())}
      {btn("S", "Strikethrough", state.strike, () => editor.chain().focus().toggleStrike().run())}
      <span className="md-sep" />
      {btn("H1", "Heading 1", state.h1, () => editor.chain().focus().toggleHeading({ level: 1 }).run())}
      {btn("H2", "Heading 2", state.h2, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      {btn("H3", "Heading 3", state.h3, () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
      <span className="md-sep" />
      {btn("•", "Bullet list", state.bullet, () => editor.chain().focus().toggleBulletList().run())}
      {btn("1.", "Numbered list", state.ordered, () => editor.chain().focus().toggleOrderedList().run())}
      {btn("❝", "Quote", state.quote, () => editor.chain().focus().toggleBlockquote().run())}
      {btn("—", "Horizontal rule", false, () => editor.chain().focus().setHorizontalRule().run())}
      <span className="md-sep" />
      {btn("🔗", "Link (⌘-click a link to open it in the browser)", state.link, () =>
        setLinkInput((editor.getAttributes("link").href as string | undefined) ?? "https://"),
      )}
      {btn("🖼", "Insert image", false, () => void insertImage())}
      {linkInput !== null && (
        <form
          className="md-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink(linkInput);
          }}
        >
          <input
            autoFocus
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinkInput(null)}
            placeholder="https://… (empty removes the link)"
          />
          <button type="submit">Set</button>
        </form>
      )}
    </div>
  );
}
