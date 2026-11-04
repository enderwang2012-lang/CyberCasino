import { GameHistoryStore } from "../stores";
import { httpServer, serverReady, tableManager } from "../index";

// Keep production routes and event wiring; only shorten matches and gate storage.
const createMatchedTable = tableManager.createMatchedTable.bind(tableManager);
tableManager.createMatchedTable = (entries) => createMatchedTable(entries, {
  handLimit: 1,
  interHandDelayMs: 0,
  actionDelayMs: 0,
  commentaryMode: "rule",
});

// Hold the exhibition's first hand so the test can queue users before it ends.
const pendingExhibitions = new Map<string, () => void>();
const configuredExhibitions = new Set<string>();
const ensureShowcaseTable = tableManager.ensureShowcaseTable.bind(tableManager);
tableManager.ensureShowcaseTable = () => {
  const table = ensureShowcaseTable();
  if (!table || configuredExhibitions.has(table.id)) return table;
  configuredExhibitions.add(table.id);
  Object.assign(table.config, {
    handLimit: 1, interHandDelayMs: 0, actionDelayMs: 0, commentaryMode: "rule",
  });
  const playHand = (table as any).playHand.bind(table);
  (table as any).playHand = async (...args: unknown[]) => {
    await new Promise<void>((resolve) => {
      pendingExhibitions.set(table.id, resolve);
      process.send?.({ type: "exhibition_waiting", tableId: table.id });
    });
    await playHand(...args);
  };
  return table;
};

const pendingArchives = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
class GatedHistoryStore extends GameHistoryStore {
  override async saveCompletedMatch(
    ...args: Parameters<GameHistoryStore["saveCompletedMatch"]>
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      pendingArchives.set(args[0].id, { resolve, reject });
      process.send?.({ type: "archive_pending", tableId: args[0].id });
    });
    await super.saveCompletedMatch(...args);
    process.send?.({ type: "archive_saved", tableId: args[0].id });
  }
}
tableManager.setHistoryStore(new GatedHistoryStore());

process.on("message", (message: { type: string; tableId?: string; fail?: boolean }) => {
  if (message.type === "release_exhibition" && message.tableId) {
    pendingExhibitions.get(message.tableId)?.();
    pendingExhibitions.delete(message.tableId);
  }
  if (message.type === "release_archive" && message.tableId) {
    const pending = pendingArchives.get(message.tableId);
    pendingArchives.delete(message.tableId);
    if (message.fail) pending?.reject(new Error("Injected archive failure"));
    else pending?.resolve();
  }
});

await serverReady;
const address = httpServer.address();
if (!address || typeof address === "string") throw new Error("Missing test server address");
process.send?.({ type: "ready", port: address.port });
