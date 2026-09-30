/**
 * Editor contexts: how images and links behave in dungeon text fields
 * (room/door/object/level descriptions) and in notes.
 */
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { playlistCompletions, playSpotifyLink, spotifyLinkLabel } from "../spotify/music";
import { assetUrl, backend } from "../lib/backend";
import { normalizePath } from "../lib/markdownPaths";
import { useUi } from "../store/ui";
import { useSession } from "../store/session";
import { ATTACHMENTS_FOLDER, addAttachment, dirOf, useNotes } from "../notes/store";
import { headingCompletions, linkCompletions, linkIndex } from "../notes/links";
import { openSearch, openWikiLink, type Origin } from "../notes/nav";
import type { EditorContext, ResolvedImage } from "./context";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
const EXTERNAL = /^([a-z][a-z0-9+.-]*:)/i;

function dir(): string | null {
  return useUi.getState().dungeonDir;
}

function imageAt(path: string | null): ResolvedImage | null {
  const d = dir();
  if (!d || !path) return null;
  return { url: assetUrl(d, path), path };
}

/** `![[name]]`: an attachment in notes/ (by path or file name), else assets/. */
export function resolveEmbed(target: string): ResolvedImage | null {
  const t = target.trim().toLowerCase();
  const atts = useNotes.getState().attachments;
  const hit =
    atts.find((a) => a.toLowerCase() === t) ??
    atts.find((a) => a.toLowerCase().endsWith("/" + t)) ??
    atts.find((a) => a.split("/").pop()?.toLowerCase() === t.split("/").pop());
  if (hit) return imageAt(`notes/${hit}`);
  if (IMAGE_EXTENSIONS.some((e) => t.endsWith("." + e))) return imageAt(normalizePath(`assets/${target}`) ?? null);
  return null;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function pastedName(file: File): string {
  if (file.name && file.name !== "image.png") return file.name;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `Pasted image ${stamp}.${ext}`;
}

async function pickImageFile(): Promise<string | null> {
  const picked = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] });
  return typeof picked === "string" ? picked : null;
}

function common(
  origin: Origin,
): Pick<
  EditorContext,
  "linkExists" | "openWikiLink" | "openUrl" | "openTag" | "showHandout" | "linkCompletions" | "headingCompletions" | "resolveEmbed" | "playSpotify" | "spotifyLabel" | "playlistCompletions"
> {
  return {
    resolveEmbed,
    linkExists: (target) => !!linkIndex().resolve(target),
    openWikiLink: (target, heading, opts) => void openWikiLink(target, heading, { newTab: opts.newTab, origin }),
    openUrl: (href) => {
      if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
    },
    openTag: (tag) => openSearch(`#${tag}`),
    showHandout: (path) => useSession.getState().showHandout(path),
    linkCompletions,
    headingCompletions,
    playSpotify: playSpotifyLink,
    spotifyLabel: spotifyLinkLabel,
    playlistCompletions,
  };
}

/** Dungeon text fields: images are stored in assets/ and referenced root-relative. */
export function fieldContext(origin: Origin): EditorContext {
  return {
    ...common(origin),
    resolveImage: (src) => (EXTERNAL.test(src) ? { url: src, path: null } : imageAt(normalizePath(src))),
    saveImage: async (file) => {
      const d = dir();
      if (!d) return "";
      const rel = await backend.saveAttachment(d, "assets", pastedName(file), await readBase64(file));
      return `![](${rel})`;
    },
    pickImage: async () => {
      const d = dir();
      const file = await pickImageFile();
      if (!d || !file) return null;
      return `![](${await backend.importAsset(d, file)})`;
    },
  };
}

/** Notes: images go to notes/attachments and are embedded Obsidian-style (![[name]]). */
export function noteContext(notePath: string, origin: Origin): EditorContext {
  const store = async (rel: string) => {
    const inNotes = rel.replace(/^notes\//, "");
    addAttachment(inNotes);
    return `![[${inNotes.split("/").pop()}]]`;
  };
  return {
    ...common(origin),
    resolveImage: (src) =>
      EXTERNAL.test(src) ? { url: src, path: null } : imageAt(normalizePath(`notes/${dirOf(notePath)}/${decodeURI(src)}`)),
    saveImage: async (file) => {
      const d = dir();
      if (!d) return "";
      return store(await backend.saveAttachment(d, `notes/${ATTACHMENTS_FOLDER}`, pastedName(file), await readBase64(file)));
    },
    pickImage: async () => {
      const d = dir();
      const file = await pickImageFile();
      if (!d || !file) return null;
      return store(await backend.importAsset(d, file, `notes/${ATTACHMENTS_FOLDER}`));
    },
  };
}
