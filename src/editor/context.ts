/**
 * What an editor instance needs from the rest of the app: how to resolve
 * images and links, and what to do when they are clicked. Provided per
 * editor through a facet so widgets and handlers can reach it.
 */
import { Facet, type EditorState } from "@codemirror/state";

export interface ResolvedImage {
  url: string;
  /** Dungeon-root-relative path (for showing the image to the players). */
  path: string | null;
}

export interface LinkCompletion {
  /** Text inserted between [[ and ]]. */
  label: string;
  /** Shown next to the label (e.g. folder). */
  detail?: string;
}

export interface EditorContext {
  /** Standard markdown image `![alt](src)`. */
  resolveImage: (src: string) => ResolvedImage | null;
  /** Wiki embed `![[name]]`. */
  resolveEmbed: (target: string) => ResolvedImage | null;
  /** Whether a wiki link target exists (unresolved links are styled differently). */
  linkExists: (target: string) => boolean;
  /** Follow a wiki link. `newTab` for ⌘-click. */
  openWikiLink: (target: string, heading: string | null, opts: { newTab: boolean }) => void;
  openUrl: (href: string) => void;
  openTag: (tag: string) => void;
  /** Stores a pasted/dropped image; returns the markdown to insert. */
  saveImage: (file: File) => Promise<string>;
  /** Picks an image file from disk; returns the markdown to insert (or null). */
  pickImage: () => Promise<string | null>;
  showHandout: ((path: string) => void) | null;
  linkCompletions: () => LinkCompletion[];
  headingCompletions: (target: string) => LinkCompletion[];
}

export const noopContext: EditorContext = {
  resolveImage: (src) => ({ url: src, path: null }),
  resolveEmbed: () => null,
  linkExists: () => false,
  openWikiLink: () => {},
  openUrl: () => {},
  openTag: () => {},
  saveImage: async () => "",
  pickImage: async () => null,
  showHandout: null,
  linkCompletions: () => [],
  headingCompletions: () => [],
};

export const editorContext = Facet.define<EditorContext, EditorContext>({
  combine: (values) => values[values.length - 1] ?? noopContext,
});

export function getContext(state: EditorState): EditorContext {
  return state.facet(editorContext);
}

/**
 * Display depth of a markdown heading at `pos`. Level documents nest user
 * headings under their fixed sections by returning an offset > 0.
 */
export const headingOffset = Facet.define<(state: EditorState, pos: number) => number, (state: EditorState, pos: number) => number>({
  combine: (values) => values[values.length - 1] ?? (() => 0),
});
