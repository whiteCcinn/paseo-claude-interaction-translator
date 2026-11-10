export interface DraftState { source: string; translated?: string; error?: string; busy: boolean; sending: boolean }
export class DraftTranslation {
  private state: DraftState = { source: "", busy: false, sending: false };
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private disposed = false;
  private messageId = "";
  private configuration: string | undefined;
  snapshot = (): DraftState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  configure(revision: string): void {
    if (this.disposed || revision === this.configuration) return;
    const changed = this.configuration !== undefined;
    this.configuration = revision;
    if (changed) {
      this.revision++; this.messageId = "";
      this.update({ ...this.state, translated: undefined, error: undefined });
    } else this.update({ ...this.state });
  }
  configured(revision: string): boolean { return this.configuration === revision; }
  edit(source: string): void {
    if (this.disposed || this.state.sending || source === this.state.source) return;
    this.revision++; this.messageId = "";
    this.update({ source, busy: this.state.busy, sending: false });
  }
  async translate(translate: (text: string) => Promise<string>): Promise<void> {
    if (this.disposed || this.state.busy || this.state.sending || !this.state.source.trim()) return;
    const revision = this.revision;
    const source = this.state.source;
    this.update({ ...this.state, busy: true, translated: undefined, error: undefined });
    try {
      const text = await translate(source);
      if (this.disposed) return;
      if (revision !== this.revision) {
        this.update({ ...this.state, busy: false, error: "输入已修改，旧译文未采用。请重新翻译。" }); return;
      }
      if (!text.trim() || text.length > 64000) throw new Error("Invalid translation");
      this.messageId = `translation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      this.update({ source, translated: text, busy: false, sending: false });
    } catch {
      if (!this.disposed) this.update({ ...this.state, busy: false, error: "翻译失败，已保留输入。请检查翻译设置后重试。" });
    }
  }
  async send(send: (text: string, messageId: string) => Promise<void>): Promise<void> {
    if (this.disposed || this.state.busy || this.state.sending || !this.state.translated) return;
    this.update({ ...this.state, sending: true, error: undefined });
    try {
      await send(this.state.translated!, this.messageId);
      // Editing is locked during send. A settings change may revoke the prepared
      // translation, but must never strand the send lock after acknowledgement.
      if (!this.disposed) {
        this.revision++; this.messageId = ""; this.update({ source: "", busy: false, sending: false });
      }
    } catch {
      if (!this.disposed) this.update({ ...this.state, sending: false, error: "发送结果未确认，译文已保留。可在会话中核对后重试。" });
    }
  }
  dispose(): void { this.disposed = true; this.listeners.clear(); }
  private update(state: DraftState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
