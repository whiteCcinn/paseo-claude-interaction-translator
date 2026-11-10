## ADDED Requirements

### Requirement: Translate a draft explicitly
The plugin SHALL translate input only on an explicit composer action, preserve code/paths/URLs, and SHALL NOT send a prompt. It SHALL replace only the unchanged draft captured before the request, and SHALL retain the source draft on failure.

#### Scenario: User edits while translating
- **WHEN** the current draft differs from the captured draft when translation finishes
- **THEN** the new draft is preserved and the user is told to retry

### Requirement: Translate a successful final response
The plugin SHALL use live turn lifecycle and exact message identity to select only the last assistant message of a successfully completed main turn. It SHALL skip child agents, history replay, errors, cancellation, ambiguous identity and stale results superseded by a newer turn or session close. A message's complete rendering phase alone SHALL NOT trigger translation.

#### Scenario: Multiple assistant messages
- **WHEN** a live main turn completes after several assistant messages
- **THEN** only its last assistant message is submitted to the translation backend

#### Scenario: New turn while translating
- **WHEN** another turn starts before the translation completes
- **THEN** the stale result is discarded

### Requirement: Preserve model history
The plugin SHALL display translations through client renderers and SHALL NOT edit canonical assistant messages or send translated responses back to the agent. Source text SHALL remain available. Failed output translation SHALL preserve source text and allow retry.

#### Scenario: Display translation
- **WHEN** a final response translation is ready
- **THEN** the client displays it while the provider's original response remains unchanged

### Requirement: Bound translation resources
The plugin SHALL validate settings and RPC data, bound text/output size, limit concurrent translation work and retained state, honor cancellation and timeouts, keep API credentials only on the daemon, and release owned resources on unload. Translation failures SHALL NOT include secrets, backend bodies or raw process stderr.

#### Scenario: Backend fails
- **WHEN** the backend times out, truncates output or loses protected placeholders
- **THEN** the translation fails visibly without replacing the source
