import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { usePaseo, useRpc, useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Markdown, TextInput, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { DraftTranslation } from "./draft";
import { translateDraftRpc } from "../shared/contracts";
import { preferences } from "../shared/settings";

/** Drafts are client memory only: prompt text never travels in navigation URLs. */
export class Drafts {
  private readonly drafts = new Map<string, DraftTranslation>();
  get(agentId: string): DraftTranslation {
    let draft = this.drafts.get(agentId);
    if (draft) return draft;
    draft = new DraftTranslation(); this.drafts.set(agentId, draft);
    if (this.drafts.size > 16) {
      const oldest = this.drafts.keys().next().value;
      if (oldest !== undefined) { this.drafts.get(oldest)?.dispose(); this.drafts.delete(oldest); }
    }
    return draft;
  }
  dispose(): void { for (const draft of this.drafts.values()) draft.dispose(); this.drafts.clear(); }
}

export function createTranslationScreen(drafts: Drafts) {
  return function TranslationScreen({ params, theme, navigation }: PluginScreenProps) {
    const agentId = params.agentId ?? "";
    const draft = useMemo(() => drafts.get(agentId), [agentId]);
    const state = useSyncExternalStore(draft.subscribe, draft.snapshot, draft.snapshot);
    const translate = useRpc(translateDraftRpc);
    const paseo = usePaseo();
    const settings = useSettings(preferences);
    const toast = useToast();
    useEffect(() => { if (settings.status === "ready") draft.configure(settings.revision); }, [draft, settings]);
    const enabled = settings.status === "ready" && settings.values.enabled && draft.configured(settings.revision);
    const buttonStyle = { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.colors.surface2 };
    if (!agentId) return <Text style={{ color: theme.colors.foreground }}>请从目标会话输入 /translate 打开翻译面板。</Text>;
    return <View style={{ padding: 16, gap: 14 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>输入中文，点击翻译，确认译文后发送。此面板仅发送文字；原生输入框中的草稿和附件保持原样。</Text>
      <TextInput accessibilityLabel="待翻译输入" multiline value={state.source} maxLength={64000}
        editable={!state.sending} onChangeText={value => draft.edit(value)} placeholder="在这里输入中文…"
        style={{ minHeight: 140, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, color: theme.colors.foreground, backgroundColor: theme.colors.surface1 }} />
      <Pressable accessibilityRole="button" style={buttonStyle} disabled={!enabled || state.busy || state.sending || !state.source.trim()}
        onPress={() => draft.translate(async text => (await translate({ text })).text)}>
        <Text style={{ color: theme.colors.accent }}>{state.busy ? "正在翻译…" : "翻译输入"}</Text>
      </Pressable>
      {state.error && <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>{state.error}</Text>}
      {!enabled && <Text style={{ color: theme.colors.foregroundMuted }}>请先在插件设置中启用交互翻译。</Text>}
      {state.translated !== undefined && <View style={{ gap: 12 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>确认以下正文后再发送：</Text>
        <Markdown>{state.translated}</Markdown>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <Pressable accessibilityRole="button" style={buttonStyle} disabled={!enabled || state.sending || state.busy}
            onPress={() => draft.send(async (text, messageId) => {
              // Explicit text-only send; active-turn handling remains the provider's responsibility.
              await paseo.agents.ref(agentId).send(text, { messageId, activeTurnBehavior: "steer" });
              toast.show("译文已发送"); navigation?.openAgent({ agentId });
            })}><Text style={{ color: theme.colors.accent }}>{state.sending ? "正在发送…" : "确认发送译文"}</Text></Pressable>
          <Pressable accessibilityRole="button" style={buttonStyle} onPress={async () => {
            try { await copyText(state.translated ?? ""); toast.show("译文已复制"); }
            catch { toast.error("复制失败，可长按选择译文。"); }
          }}><Text style={{ color: theme.colors.foreground }}>复制译文</Text></Pressable>
        </View>
      </View>}
    </View>;
  };
}
