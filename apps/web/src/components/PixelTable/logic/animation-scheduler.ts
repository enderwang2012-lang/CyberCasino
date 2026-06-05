type Emit = (playerId: string, emoji: string) => void;

interface PlayerSlot {
  lastEmitAt: number;
  pendingEmoji: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createBubbleScheduler(guardMs: number, emit: Emit) {
  const slots = new Map<string, PlayerSlot>();

  function request(playerId: string, emoji: string) {
    const now = Date.now();
    let slot = slots.get(playerId);
    if (!slot) {
      slot = { lastEmitAt: 0, pendingEmoji: null, timer: null };
      slots.set(playerId, slot);
    }
    const wait = slot.lastEmitAt + guardMs - now;
    if (wait <= 0) {
      slot.lastEmitAt = now;
      slot.pendingEmoji = null;
      emit(playerId, emoji);
    } else {
      slot.pendingEmoji = emoji;
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = setTimeout(() => {
        const cur = slots.get(playerId);
        if (!cur || cur.pendingEmoji == null) return;
        const e = cur.pendingEmoji;
        cur.pendingEmoji = null;
        cur.timer = null;
        cur.lastEmitAt = Date.now();
        emit(playerId, e);
      }, wait);
    }
  }

  function dispose() {
    slots.forEach((s) => s.timer && clearTimeout(s.timer));
    slots.clear();
  }

  return { request, dispose };
}