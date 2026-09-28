/** Small pieces shared by the Music view and search. */

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Cover({ src, size = 40 }: { src: string | null | undefined; size?: number }) {
  return src ? (
    <img className="music-cover" src={src} width={size} height={size} alt="" draggable={false} />
  ) : (
    <span className="music-cover empty" style={{ width: size, height: size, fontSize: size * 0.45 }}>
      ♪
    </span>
  );
}
