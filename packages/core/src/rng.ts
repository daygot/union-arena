// Deterministic PRNG (mulberry32). Same seed -> same sequence, so games replay identically.

export function nextRng(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  const nextState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: nextState };
}

/** Fisher-Yates shuffle using the deterministic RNG. Returns new array + advanced state. */
export function shuffle<T>(arr: readonly T[], state: number): { result: T[]; state: number } {
  const result = arr.slice();
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    const r = nextRng(s);
    s = r.state;
    const j = Math.floor(r.value * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return { result, state: s };
}
