import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences, type TranslationSettings } from "./shared/settings";
import { responsesRpc, retryResponseRpc, translateDraftRpc } from "./shared/contracts";
import { Translator } from "./server/translator";
import { FinalResponses } from "./server/final-responses";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const translator = new Translator();
  let lifetime = new AbortController();
  const readSettings = async (): Promise<TranslationSettings> => {
    const current = await settings.read();
    if (current.status !== "ready") throw new Error("翻译设置无效，请打开插件设置重新保存。");
    return current.values;
  };
  const responses = new FinalResponses({ settings: readSettings, translate: (text, target, config, signal) =>
    translator.translate(text, target, config, AbortSignal.any([signal, lifetime.signal])) });

  server.handle(translateDraftRpc, async ({ text }) => {
    const admission = lifetime;
    const config = await readSettings();
    if (admission !== lifetime || admission.signal.aborted) throw new Error("翻译设置已变更，请重试。");
    if (!config.enabled) throw new Error("交互翻译已停用。");
    const translated = await translator.translate(text, config.promptLanguage, config, admission.signal);
    if (admission !== lifetime || admission.signal.aborted) throw new Error("翻译设置已变更，请重试。");
    const names = { en: "English", "zh-CN": "Simplified Chinese", ja: "Japanese", fr: "French" };
    const result = config.requestReplyLanguage ? `${translated}\n\nPlease respond in ${names[config.promptLanguage]}.` : translated;
    if (result.length > 64000) throw new Error("译文过长，请缩短输入。");
    return { text: result };
  });
  server.handle(responsesRpc, ({ agentId, revision }) => responses.snapshot(agentId, revision));
  server.handle(retryResponseRpc, async identity => ({ accepted: await responses.retry(identity) }));

  const cleanups = [
    server.on("agent.turn_started", async ({ agent, turnId }) => responses.start({ agentId: agent.id, turnId, parentAgentId: agent.parentAgentId })),
    server.on("agent.turn_ended", async ({ agent, turnId, outcome }, context) => {
      await responses.complete({ agentId: agent.id, turnId, parentAgentId: agent.parentAgentId }, outcome.kind, async cursor =>
        context.paseo.agents.ref(agent.id).timeline.refetch({ direction: cursor ? "before" : "tail", projection: "projected", limit: 100, ...(cursor ? { cursor } : {}) }));
    }),
    server.on("agent.closed", async ({ agent }) => responses.close(agent.id)),
    server.on("agent.archived", async ({ agent }) => responses.close(agent.id)),
    server.before("agent.session_open", async ({ request }) => { if (request.purpose === "interactive") responses.close(request.agentId); }),
    settings.subscribe(() => { lifetime.abort(); lifetime = new AbortController(); responses.reset(); }),
  ];
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
    lifetime.abort(); responses.dispose(); translator.dispose();
  };
}
