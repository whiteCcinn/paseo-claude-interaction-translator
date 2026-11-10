import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { preferences, languageOptions, settingsSchema, type TranslationSettings } from "../shared/settings";

export function SettingsScreen({ theme }: Omit<PluginScreenProps, "params">) {
  const settings = useSettings(preferences);
  const [draft, setDraft] = useState<TranslationSettings>();
  const [revision, setRevision] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (settings.status === "ready" && !draft) { setDraft({ ...settings.values }); setRevision(settings.revision); }
  }, [settings, draft]);
  if (settings.status === "invalid" || settings.status === "error") return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.colors.statusDanger }}>无法读取翻译设置，请重试或重置。</Text>
    <SettingsAction label="重新读取" actionLabel="重试" onPress={() => { void settings.reload(); }} />
    <SettingsAction label="恢复默认设置" actionLabel="重置" onPress={() => { void settings.reset(); }} />
  </View>;
  if (!draft) return <Text style={{ color: theme.colors.foregroundMuted }}>正在读取翻译设置…</Text>;
  const patch = <K extends keyof TranslationSettings>(key: K, value: TranslationSettings[K]) => setDraft({ ...draft, [key]: value });
  return <View style={{ gap: 18 }}>
    <SettingsSection title="翻译行为"><SettingsCard>
      <SettingsSwitch label="启用交互翻译" value={draft.enabled} onValueChange={value => patch("enabled", value)} />
      <SettingsSwitch label="自动翻译最终答复" value={draft.autoFinal} onValueChange={value => patch("autoFinal", value)} />
      <SettingsSelect label="输入译文语言" value={draft.promptLanguage} options={languageOptions} onValueChange={value => patch("promptLanguage", value as TranslationSettings["promptLanguage"])} />
      <SettingsSelect label="答复显示语言" value={draft.outputLanguage} options={languageOptions} onValueChange={value => patch("outputLanguage", value as TranslationSettings["outputLanguage"])} />
      <SettingsSwitch label="请求 Agent 使用输入译文语言回复" value={draft.requestReplyLanguage} onValueChange={value => patch("requestReplyLanguage", value)} />
      <SettingsSelect label="翻译后端" value={draft.backend} options={[{ value: "codex-cli", label: "本地 Codex CLI" }, { value: "api", label: "兼容 API" }]} onValueChange={value => patch("backend", value)} />
    </SettingsCard></SettingsSection>
    {draft.backend === "codex-cli" ? <SettingsSection title="Codex CLI"><SettingsCard>
      <SettingsInput label="可执行文件" initialValue={draft.codexPath} onChangeText={value => patch("codexPath", value)} hint="在 daemon 所在机器执行；可填写绝对路径。" />
      <SettingsInput label="翻译模型" initialValue={draft.codexModel} onChangeText={value => patch("codexModel", value)} hint="留空使用本地 Codex 配置。" />
      <SettingsSelect label="推理等级" value={draft.codexReasoning} options={["default", "low", "medium", "high", "xhigh", "max"].map(value => ({ value, label: value === "default" ? "跟随本地配置" : value }))} onValueChange={value => patch("codexReasoning", value as TranslationSettings["codexReasoning"])} />
    </SettingsCard></SettingsSection> : <SettingsSection title="翻译 API"><SettingsCard>
      <SettingsInput label="API URL" initialValue={draft.apiUrl} onChangeText={value => patch("apiUrl", value)} hint="填写完整的 chat/completions 地址。" />
      <SettingsInput label="模型 ID" initialValue={draft.apiModel} onChangeText={value => patch("apiModel", value)} />
      <SettingsInput label="API Key 环境变量名" initialValue={draft.apiKeyEnv} onChangeText={value => patch("apiKeyEnv", value)} hint="只填写变量名。Key 在 daemon 启动环境中配置。" />
    </SettingsCard></SettingsSection>}
    <SettingsAction label="保存设置" actionLabel={settings.saving ? "保存中…" : "保存"} disabled={settings.saving || revision === undefined} onPress={() => {
      const parsed = settingsSchema.safeParse(draft);
      if (!parsed.success || revision === undefined) { setError("设置格式无效，请检查填写内容。"); return; }
      void settings.save(parsed.data, revision).then(saved => { if (saved) { setDraft(undefined); setError(""); } });
    }} />
    {(error || settings.saveError) && <Text style={{ color: theme.colors.statusDanger }}>{error || "保存失败，设置可能已被其他设备修改。重新打开本页后再试。"}</Text>}
    <Text style={{ color: theme.colors.foregroundMuted }}>输入翻译需要手动确认。输出翻译只影响界面；原文可以随时查看。</Text>
  </View>;
}
