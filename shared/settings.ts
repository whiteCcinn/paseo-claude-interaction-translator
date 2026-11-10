import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const languageSchema = z.enum(["en", "zh-CN", "ja", "fr"]);
export type Language = z.infer<typeof languageSchema>;
export const settingsSchema = z.object({
  enabled: z.boolean().default(true),
  backend: z.enum(["codex-cli", "api"]).default("codex-cli"),
  promptLanguage: languageSchema.default("en"),
  outputLanguage: languageSchema.default("zh-CN"),
  requestReplyLanguage: z.boolean().default(true),
  autoFinal: z.boolean().default(true),
  apiUrl: z.string().max(2048).default("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"),
  apiModel: z.string().max(200).default("glm-5.3-flash"),
  apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("TRANSLATOR_API_KEY"),
  codexPath: z.string().max(2048).default("codex"),
  codexModel: z.string().max(200).default(""),
  codexReasoning: z.enum(["default", "low", "medium", "high", "xhigh", "max"]).default("default"),
  timeoutMs: z.number().int().min(1000).max(120000).default(120000),
});
export type TranslationSettings = z.infer<typeof settingsSchema>;
export const preferences = defineSettings({
  id: "translation", scope: "host", version: 1, schema: settingsSchema,
});
export const languageOptions = [
  { value: "en", label: "English" }, { value: "zh-CN", label: "简体中文" },
  { value: "ja", label: "日本語" }, { value: "fr", label: "Français" },
];
