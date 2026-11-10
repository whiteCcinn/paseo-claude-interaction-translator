import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useSettings, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown, StreamedText } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { responsesRpc, retryResponseRpc, responseDisplaySchema } from "../shared/contracts";
import { preferences } from "../shared/settings";

type Snapshot = z.infer<typeof responsesRpc.output>;
export function createResponseRenderer(scope: string) {
  return function Response({ agentId, item, host, theme }: PluginTimelineItemProps<z.infer<typeof responseDisplaySchema>>) {
    const settings = useSettings(preferences);
    const read = useRpc(responsesRpc);
    const retry = useRpc(retryResponseRpc);
    const cache = useQueryClient();
    const [original, setOriginal] = useState(false);
    const [retrying, setRetrying] = useState(false);
    const key = ["paseo-interaction-translator", scope, host.id, agentId, settings.status === "ready" ? settings.revision : "unavailable"];
    const enabled = item.data.phase === "complete" && settings.status === "ready" && settings.values.enabled;
    const query = useQuery({
      queryKey: key,
      enabled,
      queryFn: async (): Promise<Snapshot> => {
        const previous = cache.getQueryData<Snapshot>(key);
        const result = await read({ agentId, revision: previous?.revision });
        return result.entries === undefined && previous ? previous : result;
      },
      refetchInterval: 1500, refetchIntervalInBackground: false, retry: false, gcTime: 30000,
    });
    const state = enabled && !query.isError
      ? query.data?.entries?.find(entry => entry.messageId === item.data.messageId && entry.text === item.data.text)?.state
      : undefined;
    const text = state?.status === "ready" && !original ? state.text : item.data.text;
    const color = theme.colors.foreground;
    if (item.data.phase === "streaming") return <StreamedText text={item.data.text} phase="streaming" style={{ color }} />;
    return <View style={{ gap: 8 }}>
      <Markdown>{text}</Markdown>
      {state?.status === "translating" && <Text style={{ color: theme.colors.foregroundMuted }}>正在翻译最终答复…</Text>}
      {state?.status === "ready" && <Pressable accessibilityRole="button" onPress={() => setOriginal(value => !value)}>
        <Text style={{ color: theme.colors.accent }}>{original ? "显示译文" : "查看原文"}</Text>
      </Pressable>}
      {state?.status === "error" && <View style={{ gap: 6 }}>
        <Text style={{ color: theme.colors.statusWarning }}>{state.message}</Text>
        <Pressable accessibilityRole="button" disabled={retrying} onPress={async () => {
          setRetrying(true);
          try { await retry({ agentId, messageId: item.data.messageId, text: item.data.text }); await query.refetch(); }
          catch { /* Source and existing error remain visible. */ }
          finally { setRetrying(false); }
        }}><Text style={{ color: theme.colors.accent }}>{retrying ? "重试中…" : "重试翻译"}</Text></Pressable>
      </View>}
    </View>;
  };
}
