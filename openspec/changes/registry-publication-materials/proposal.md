## Why
The registry review for getpaseo/plugins#2258 found no code blockers, but requires an English default overview with translation-backend disclosure and a real interface image before publication.

## What Changes
- Publish English OVERVIEW.md and a complete Simplified Chinese OVERVIEW.zh-CN.md translation.
- Explain the text sent to the chosen Codex CLI or configured API, including automatic final-reply translation and the CLI's model-service access.
- Add an actual plugin interface screenshot using non-private sample data, declare it as media, and include localized overviews and assets in the package.

## Impact
Publication documentation, package files and media metadata only; runtime translation behavior stays unchanged.
