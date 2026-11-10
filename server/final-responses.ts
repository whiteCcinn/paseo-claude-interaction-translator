import type { Language, TranslationSettings } from "../shared/settings";
import type { ResponseIdentity, ResponseState } from "../shared/contracts";
import { MAX_TEXT_CHARS } from "../shared/contracts";
import { randomUUID } from "node:crypto";
export interface Cursor { epoch: string; seq: number }
export interface HistoryPage {
  entries: { turnId?: string; item: { type: string; text?: string; messageId?: string } }[];
  hasOlder: boolean;
  startCursor?: Cursor | null;
  error?: string | null;
  staleCursor?: boolean;
}
export interface Turn { agentId: string; turnId: string | null; parentAgentId?: string | null }
export interface Dependencies {
  settings(): Promise<TranslationSettings>;
  translate(text: string, target: Language, settings: TranslationSettings, signal: AbortSignal): Promise<string>;
  maxEntries?: number;
  maxBytes?: number;
}
export class FinalResponses {
  private readonly turns = new Map<string, { id: string; ended: boolean; abort: AbortController }>();
  private readonly entries = new Map<string, ResponseIdentity & { state: ResponseState; abort: AbortController; bytes: number }>();
  private readonly instance = randomUUID();
  private revision = 0;
  private bytes = 0;
  private disposed = false;
  constructor(private readonly dependencies: Dependencies) {}

  start(turn: Turn): void {
    if (this.disposed || turn.parentAgentId || !turn.turnId) return;
    if (this.turns.get(turn.agentId)?.id === turn.turnId) return;
    this.close(turn.agentId);
    this.turns.set(turn.agentId, { id: turn.turnId, ended: false, abort: new AbortController() });
    if (this.turns.size > 128) {
      const oldest = this.turns.keys().next().value;
      if (oldest !== undefined) this.close(oldest);
    }
  }

  async complete(turn: Turn, outcome: string, load: (cursor?: Cursor) => Promise<HistoryPage>): Promise<void> {
    const owner = this.turns.get(turn.agentId);
    if (this.disposed || turn.parentAgentId || !turn.turnId || !owner || owner.id !== turn.turnId || owner.ended) return;
    owner.ended = true; // Claim synchronously before any await, including settings/history reads.
    if (outcome !== "completed") return;
    const current = () => !this.disposed && this.turns.get(turn.agentId) === owner && !owner.abort.signal.aborted;
    try {
      const settings = await this.dependencies.settings();
      if (!settings.enabled || !settings.autoFinal || !current()) return;
      const seen = new Set<string>();
      let cursor: Cursor | undefined;
      for (let pageNumber = 0; pageNumber < 8 && current(); pageNumber++) {
        const page = await load(cursor);
        if (!current() || page.error || page.staleCursor) return;
        // Projected entries are chronologically ordered. Never identify a response by text.
        const last = [...page.entries].reverse().find(entry => entry.turnId === turn.turnId && entry.item.type === "assistant_message");
        if (last) {
          const { text, messageId } = last.item;
          if (!text?.trim() || !messageId || messageId.length > 512 || text.length > MAX_TEXT_CHARS) return;
          const entry = { agentId: turn.agentId, messageId, text, state: { status: "translating" } as ResponseState, abort: owner.abort, bytes: 0 };
          if (this.put(entry)) await this.translate(entry, settings);
          return;
        }
        if (!page.hasOlder || !page.startCursor) return;
        const next = JSON.stringify(page.startCursor);
        if (seen.has(next)) return;
        seen.add(next); cursor = page.startCursor;
      }
    } catch {
      // History and settings errors leave canonical source visible; no guessed candidate.
    }
  }

  get(identity: ResponseIdentity): ResponseState {
    const entry = this.entries.get(this.key(identity));
    return entry?.text === identity.text ? entry.state : { status: "original" };
  }

  async retry(identity: ResponseIdentity): Promise<boolean> {
    const entry = this.entries.get(this.key(identity));
    if (this.disposed || entry?.text !== identity.text || entry.state.status !== "error") return false;
    const admission = this.turns.get(identity.agentId);
    if (!admission || admission.abort.signal.aborted) return false;
    const settings = await this.dependencies.settings();
    if (this.disposed || !settings.enabled || this.turns.get(identity.agentId) !== admission || admission.abort.signal.aborted || this.entries.get(this.key(identity)) !== entry || entry.state.status !== "error") return false;
    entry.abort = new AbortController(); entry.state = { status: "translating" };
    if (!this.put(entry)) return false;
    await this.translate(entry, settings); return true;
  }

  snapshot(agentId: string, revision?: string): { revision: string; entries?: (ResponseIdentity & { state: ResponseState })[] } {
    const current = `${this.instance}:${this.revision}`;
    if (current === revision) return { revision: current };
    return { revision: current, entries: [...this.entries.values()].filter(entry => entry.agentId === agentId)
      .map(({ agentId, messageId, text, state }) => ({ agentId, messageId, text, state })) };
  }

  close(agentId: string): void {
    this.turns.get(agentId)?.abort.abort(); this.turns.delete(agentId);
    for (const [key, entry] of this.entries) if (entry.agentId === agentId && entry.state.status === "translating") {
      entry.abort.abort(); this.remove(key);
    }
  }
  reset(): void {
    for (const agentId of this.turns.keys()) this.close(agentId);
    for (const entry of this.entries.values()) entry.abort.abort();
    this.entries.clear(); this.bytes = 0; this.revision++;
  }
  dispose(): void { this.disposed = true; this.reset(); }

  private key(identity: Pick<ResponseIdentity, "agentId" | "messageId">): string {
    return JSON.stringify([identity.agentId, identity.messageId]);
  }
  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes; this.entries.delete(key); this.revision++;
  }
  private put(entry: ResponseIdentity & { state: ResponseState; abort: AbortController; bytes: number }): boolean {
    const key = this.key(entry);
    this.remove(key);
    entry.bytes = Buffer.byteLength(JSON.stringify({ text: entry.text, state: entry.state }), "utf8");
    this.entries.set(key, entry); this.bytes += entry.bytes; this.revision++;
    while (this.entries.size > (this.dependencies.maxEntries ?? 128) || this.bytes > (this.dependencies.maxBytes ?? 2 * 1024 * 1024)) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.get(oldest)?.abort.abort(); this.remove(oldest);
    }
    return this.entries.get(key) === entry;
  }
  private async translate(entry: ResponseIdentity & { state: ResponseState; abort: AbortController; bytes: number }, settings: TranslationSettings): Promise<void> {
    const abort = entry.abort;
    const current = () => !this.disposed && !abort.signal.aborted && this.entries.get(this.key(entry)) === entry;
    try {
      const text = await this.dependencies.translate(entry.text, settings.outputLanguage, settings, abort.signal);
      if (!current()) return;
      if (!text.trim() || text.length > MAX_TEXT_CHARS) throw new Error("Invalid translation");
      entry.state = { status: "ready", text }; this.put(entry);
    } catch {
      if (!current()) return;
      entry.state = { status: "error", message: "翻译失败，已保留原文。检查翻译配置后可重试。" }; this.put(entry);
    }
  }
}
