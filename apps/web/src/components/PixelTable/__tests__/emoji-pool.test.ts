import { describe, it, expect } from "vitest";
import { pickEmoji, type EmojiKind } from "../logic/emoji-pool";

describe("pickEmoji", () => {
  it("returns null when kind is none", () => {
    expect(pickEmoji("none", [])).toBe(null);
  });

  it("returns an emoji from FOLD pool for fold", () => {
    const e = pickEmoji("fold", []);
    expect(["😅", "🙄", "😴", "🤷", "💤", "😮‍💨"]).toContain(e);
  });

  it("avoids the most recent emoji for the same player", () => {
    const last = ["🔥"];
    for (let i = 0; i < 50; i++) {
      const e = pickEmoji("raise", last);
      expect(e).not.toBe("🔥");
    }
  });

  it("returns idle emoji ~30% of the time when kind is idle", () => {
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickEmoji("idle", []) !== null) hits++;
    }
    expect(hits).toBeGreaterThan(200);
    expect(hits).toBeLessThan(400);
  });
});