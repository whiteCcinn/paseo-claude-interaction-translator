## Why
Paseo users need Chinese input and readable Chinese final responses while their coding agent receives English instructions and keeps original response history. The native plugin API can change a draft but cannot intercept every send operation.

## What Changes
- Add a composer action that translates a snapshot and replaces it only if the draft still matches. It never sends a message.
- Automatically translate the final assistant message after a successful live main turn; preserve intermediate output, failed/canceled turns and restored history.
- Render translations through a client timeline renderer with original/translation toggle and retry.
- Support daemon-side Codex CLI and OpenAI-compatible translation API with bounded concurrency, timeouts and text limits.
- Provide persisted non-secret settings, Chinese installation instructions, TDD coverage and an isolated Paseo load verification.

## Impact
A new independent plugin repository, no changes to the existing Claude Code plugin or the user's running Paseo configuration.
