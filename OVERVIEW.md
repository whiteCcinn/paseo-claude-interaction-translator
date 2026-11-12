# Claude Interaction Translator

Translate a draft before sending it to your coding agent, and automatically translate the final assistant reply after a successful main-agent turn. English, Simplified Chinese, Japanese and French are supported.

Open `/translate [text]` in an agent session, or choose the translation action in the Command Center. The translation panel keeps translation and sending separate: review the translated draft, then explicitly send or copy it. It does not intercept the native message composer or include its attachments.

## Where your text goes

Every draft you choose to translate and, when automatic final-reply translation is enabled, the final assistant reply from each successfully completed main-agent turn is sent to your selected translation backend:

- **Local Codex CLI (default):** the plugin passes the text to the Codex executable configured on the daemon host. Codex then uses its configured model service and credentials. Running a local CLI does not mean the text stays on your machine or is processed offline.
- **OpenAI-compatible API:** the plugin sends the text to the API URL in the plugin settings. The default URL is `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions`. The API key comes from the daemon environment variable named in settings, `TRANSLATOR_API_KEY` by default.

Response translations change only the displayed text. The agent's original replies and model history remain unchanged. You can switch back to the original reply; a failed translation keeps the original visible. Intermediate output, tools, reasoning, permission dialogs and restored history do not trigger automatic translation.

## Setup and limitations

Use Paseo `>=0.14.0 <0.16.0`. With the default backend, install and sign in to Codex on the daemon host and set an executable path if it is not on the daemon's `PATH`. For API translation, configure the full chat-completions URL, model ID and key environment variable. Settings let you choose the translation backend, input and output languages, and whether final replies are translated automatically.

Daemon-side operation has been verified on macOS with Paseo 0.14.0 and 0.15.4; Windows process cleanup is not fully verified. Each normally completed turn can trigger its own final-reply translation, so queued follow-ups are not guaranteed to produce only one translation. Translations and panel drafts are held in bounded memory caches and can disappear after eviction or plugin reload.

See the [README](https://github.com/whiteCcinn/paseo-claude-interaction-translator#readme) for setup details and operating limits.
