/**
 * Markdown in memory references local files relative to the dungeon root
 * (`assets/x.png`). On disk each markdown file references them relative to
 * its own location (`../../assets/x.png`) so the files render correctly in
 * any markdown viewer. These helpers convert between the two.
 */

const LINK_TARGET = /(!?\[[^\]]*\]\()(<[^>]*>|[^)\s]+)/g;

function isExternal(target: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(target);
}

/** Resolves `.` and `..` segments. Returns null if the path escapes the root. */
export function normalizePath(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join("/");
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i === -1 ? "" : filePath.slice(0, i);
}

function mapTargets(md: string, fn: (target: string) => string): string {
  return md.replace(LINK_TARGET, (_all, prefix: string, rawTarget: string) => {
    const bracketed = rawTarget.startsWith("<") && rawTarget.endsWith(">");
    const target = bracketed ? rawTarget.slice(1, -1) : rawTarget;
    if (isExternal(target)) return prefix + rawTarget;
    const mapped = fn(target);
    return prefix + (bracketed ? `<${mapped}>` : mapped);
  });
}

/** Root-relative (memory) -> relative to the markdown file at `filePath`. */
export function toFileRelative(md: string, filePath: string): string {
  const depth = dirOf(filePath).split("/").filter(Boolean).length;
  if (depth === 0) return md;
  const up = "../".repeat(depth);
  return mapTargets(md, (t) => up + t);
}

/** Relative to the markdown file at `filePath` -> root-relative (memory). */
export function toRootRelative(md: string, filePath: string): string {
  const dir = dirOf(filePath);
  if (!dir) return md;
  return mapTargets(md, (t) => normalizePath(`${dir}/${t}`) ?? t);
}
