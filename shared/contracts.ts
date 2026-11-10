import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_TEXT_CHARS = 64000;
export const responseIdentitySchema = z.object({
  agentId: z.string().min(1).max(256),
  messageId: z.string().min(1).max(512),
  text: z.string().min(1).max(MAX_TEXT_CHARS),
});
export type ResponseIdentity = z.infer<typeof responseIdentitySchema>;
export const responseStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("original") }),
  z.object({ status: z.literal("translating") }),
  z.object({ status: z.literal("ready"), text: z.string().max(MAX_TEXT_CHARS) }),
  z.object({ status: z.literal("error"), message: z.string().max(300) }),
]);
export type ResponseState = z.infer<typeof responseStateSchema>;
export const translateDraftRpc = defineRpc({
  name: "translation.draft",
  input: z.object({ text: z.string().min(1).max(MAX_TEXT_CHARS) }),
  output: z.object({ text: z.string().max(MAX_TEXT_CHARS) }),
});
export const responsesRpc = defineRpc({
  name: "translation.responses",
  input: z.object({ agentId: z.string().min(1).max(256), revision: z.string().max(100).optional() }),
  output: z.object({
    revision: z.string(),
    entries: z.array(z.object({ messageId: z.string(), text: z.string(), state: responseStateSchema })).optional(),
  }),
});
export const retryResponseRpc = defineRpc({
  name: "translation.retry", input: responseIdentitySchema,
  output: z.object({ accepted: z.boolean() }),
});
export const responseDisplaySchema = z.object({
  messageId: z.string(), text: z.string(), phase: z.enum(["streaming", "complete"]),
});
