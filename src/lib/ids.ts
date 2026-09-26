const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newId(prefix: string): string {
  let s = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${s}`;
}

/** Lowest positive integer not present in `taken`. */
export function lowestFreeNumber(taken: Iterable<number>): number {
  const set = new Set(taken);
  let n = 1;
  while (set.has(n)) n++;
  return n;
}
