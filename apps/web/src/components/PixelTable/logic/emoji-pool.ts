export type EmojiKind = "fold" | "call" | "check" | "raise" | "all-in" | "win" | "bad-beat" | "idle" | "none";

const POOLS: Record<Exclude<EmojiKind, "none">, string[]> = {
  fold:    ["😅", "🙄", "😴", "🤷", "💤", "😮‍💨"],
  call:    ["🤔", "😏", "👀", "🧐", "😶", "🤨"],
  check:   ["😎", "🙂", "👌", "✋"],
  raise:   ["🔥", "💪", "⚡", "😤", "🎯"],
  "all-in":["💀", "⚡", "🔥", "🎲", "🚀"],
  win:     ["🎉", "💰", "😎", "👑", "🏆"],
  "bad-beat": ["😱", "🤯", "💀", "😭", "🥲"],
  idle:    ["😏", "😴", "🤔", "👀", "😎", "🙂", "😅"],
};

const IDLE_PROB = 0.3;

export function pickEmoji(kind: EmojiKind, recent: string[]): string | null {
  if (kind === "none") return null;
  if (kind === "idle" && Math.random() >= IDLE_PROB) return null;

  const pool = POOLS[kind];
  const candidates = pool.filter((e) => !recent.includes(e));
  const finalPool = candidates.length > 0 ? candidates : pool;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}