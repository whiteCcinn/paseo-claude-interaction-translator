import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createTranslationScreen, Drafts } from "./client/translation-screen";
import { SettingsScreen } from "./client/settings-screen";
import { createResponseRenderer } from "./client/response";
import { responseDisplaySchema } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const drafts = new Drafts();
  const TranslationScreen = createTranslationScreen(drafts);
  const scope = `${Date.now()}-${Math.random()}`;
  const cleanups = [
    client.addScreen({ id: "translator", title: "翻译输入", Component: TranslationScreen }),
    client.addSettingsScreen({ id: "translation", title: "翻译设置", icon: "Languages", Component: SettingsScreen }),
    client.addCommandCenterItem({
      id: "translate-input", title: "翻译输入", icon: "Languages", keywords: ["translate", "翻译"], context: "agent",
      onSelect({ agent, openScreen }) { openScreen({ screenId: "translator", params: { agentId: agent.id } }); },
    }),
    client.addSlashCommand({
      name: "translate", description: "打开输入翻译面板", argumentHint: "[待翻译文字]", context: "agent",
      onSubmit({ args, agent, openScreen }) {
        if (args) drafts.get(agent.id).edit(args);
        openScreen({ screenId: "translator", params: { agentId: agent.id } });
      },
    }),
    client.addTimelineTransformer({
      id: "translated-response", query: { itemType: "assistant_message" },
      transform({ item, phase }) {
        if (!item.messageId || !item.text || item.text.length > 64000) return undefined;
        return { items: [{ type: "plugin", kind: "translated-response", version: 1, data: { messageId: item.messageId, text: item.text, phase } }] };
      },
    }),
    client.addTimelineRenderer({ kind: "translated-response", version: 1, schema: responseDisplaySchema, Component: createResponseRenderer(scope) }),
  ];
  return () => { for (const cleanup of cleanups.reverse()) cleanup(); drafts.dispose(); };
}
