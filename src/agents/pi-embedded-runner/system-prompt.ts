// Public export runtime shim.
// Full prompt/memory composition internals are protected and excluded from this repo.
export function buildEmbeddedSystemPrompt(params: { extraSystemPrompt?: string } = {}): string {
  return params.extraSystemPrompt?.trim() ?? "";
}

export function createSystemPromptOverride(systemPrompt: string): (defaultPrompt?: string) => string {
  const override = systemPrompt.trim();
  return (_defaultPrompt?: string) => override;
}

export function applySystemPromptOverrideToSession(
  session: { agent?: { state?: { systemPrompt?: string } }; _baseSystemPrompt?: string; _rebuildSystemPrompt?: () => string },
  override: string | ((defaultPrompt?: string) => string),
) {
  const prompt = typeof override === "function" ? override() : override.trim();
  if (session.agent?.state) {
    session.agent.state.systemPrompt = prompt;
  }
  session._baseSystemPrompt = prompt;
  session._rebuildSystemPrompt = () => prompt;
}
