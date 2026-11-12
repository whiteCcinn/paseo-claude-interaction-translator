## ADDED Requirements

### Requirement: Publish localized overviews with backend disclosure
The package SHALL contain an English OVERVIEW.md and a complete Simplified Chinese OVERVIEW.zh-CN.md. Both SHALL explain that each explicitly translated draft and each automatically translated final reply is sent to the selected backend, defaulting to the local Codex CLI or the configured OpenAI-compatible API URL. They SHALL state that a local CLI can forward text to its configured model service.

#### Scenario: Reviewer inspects the distributed package
- **WHEN** the reviewer reads the default and Chinese overviews from the package
- **THEN** both explain translation behavior, setup, data destinations and limitations without requiring a runtime-code audit

### Requirement: Provide a real interface image
The plugin SHALL ship a screenshot of its actual current interface with non-private sample data. Its declared media path SHALL exist in the package, and a public HTTPS image URL SHALL end with a supported image extension and return matching image content type.

#### Scenario: Registry fetches the interface image
- **WHEN** the registry fetches the provided public JPEG URL
- **THEN** it returns HTTP 200 with image/jpeg and shows the translation panel or a translated session reply
