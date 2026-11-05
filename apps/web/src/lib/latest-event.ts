export function latestByType<T extends { type: string }>(events: readonly T[], type: T["type"]): T | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) return events[i];
  }
  return undefined;
}
