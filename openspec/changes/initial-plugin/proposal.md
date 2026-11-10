## Why
Paseo users need Chinese input and readable Chinese final responses while their coding agent receives English instructions and keeps original response history. The native plugin API can change a draft but cannot intercept every send operation.

## What Changes
- Add a `/translate` client command and a translation screen with separate translate, confirm-send and copy actions. Translation operates on a snapshot and adopts it only if the draft still matches. Translation itself never sends a message.
- Automatically translate the final assistant message after a successful live main turn; preserve intermediate output, failed/canceled turns and restored history.
- Render translations through a client timeline renderer with original/translation toggle and retry.
- Support daemon-side Codex CLI and OpenAI-compatible translation API with bounded concurrency, timeouts and text limits.
- Provide persisted non-secret settings, Chinese installation instructions, TDD coverage and isolated Paseo 0.14.0 / 0.15.4 load verification.

## Released API Decision
The npm 0.15.4 package does not export the main-branch documentation's `useComposer`/`setPrompt` or plugin subscriptions. The implementation therefore uses a dedicated text-only translation screen and per-agent revisioned read-only RPC polling. It never patches private host modules. The latest published SDK's lifecycle compatibility APIs (`on`/`before`) provide the required events. Native composer rewriting awaits a compatible published API.

## Impact
A new independent plugin repository, no changes to the existing Claude Code plugin or the user's running Paseo configuration.
