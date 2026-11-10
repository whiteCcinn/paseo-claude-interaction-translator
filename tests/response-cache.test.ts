import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { settingsSchema } from "../shared/settings.ts";

test("a rendered reply never reuses a previous settings revision's translated query cache", async t => {
  const root = new URL("../", import.meta.url).pathname;
  await mkdir(join(root, ".local"), { recursive: true });
  const directory = await mkdtemp(join(root, ".local", "response-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = join(directory, "response.mjs");
  await build({ entryPoints: [join(root, "client/response.tsx")], outfile, bundle: true, format: "esm", platform: "node",
    external: ["react", "react/jsx-runtime", "@tanstack/react-query", "@getpaseo/plugin"],
    plugins: [{ name: "paseo-host-test", setup(builder) {
      builder.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(?:\/ui)?)$/ }, args => ({ path: args.path, namespace: "fake-host" }));
      builder.onLoad({ filter: /.*/, namespace: "fake-host" }, args => ({ contents: args.path === "@getpaseo/plugin/client"
        ? "export function useSettings(){return globalThis.__paseoTranslationTestSettings} export function useRpc(){return async()=>({revision:'new',entries:[]})}"
        : args.path.endsWith("/ui")
          ? "import{createElement}from'react';export function Markdown({children}){return createElement('p',null,children)} export function StreamedText({text}){return createElement('p',null,text)}"
          : "import{createElement}from'react';export function View({children}){return createElement('div',null,children)} export const Text=View;export const Pressable=View;",
        loader: "js" }));
    } }],
  });
  const module = await import(pathToFileURL(outfile).href);
  const require = createRequire(import.meta.url);
  const { renderToStaticMarkup } = require("react-dom/server") as { renderToStaticMarkup(node: ReactNode): string };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__paseoTranslationTestSettings = { status: "ready", revision: "new-settings", values: settingsSchema.parse({}) };
  t.after(() => { delete globals.__paseoTranslationTestSettings; });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => cache.clear());
  const stale = { revision: "server-old", entries: [{ messageId: "message", text: "Original answer", state: { status: "ready", text: "OLD-LANGUAGE-TRANSLATION" } }] };
  // Seed both the original pre-fix key and the old settings-scoped key.
  cache.setQueryData(["paseo-interaction-translator", "scope", "host", "agent"], stale);
  cache.setQueryData(["paseo-interaction-translator", "scope", "host", "agent", "old-settings"], stale);
  const Response = module.createResponseRenderer("scope");
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: cache }, createElement(Response, {
    agentId: "agent", item: { data: { messageId: "message", text: "Original answer", phase: "complete" } },
    host: { id: "host" }, theme: { colors: { foreground: "black", accent: "blue" } },
  })));
  assert.ok(markup.includes("Original answer"));
  assert.ok(!markup.includes("OLD-LANGUAGE-TRANSLATION"));
});
