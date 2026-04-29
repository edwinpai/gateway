import chalk from "chalk";
import type { loadConfig } from "../config/config.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { resolveConfiguredModelRef } from "../agents/model-selection.js";
import { getResolvedLoggerSettings } from "../logging.js";

export function logGatewayStartup(params: {
  cfg: ReturnType<typeof loadConfig>;
  bindHost: string;
  bindHosts?: string[];
  port: number;
  tlsEnabled?: boolean;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void };
  isNixMode: boolean;
}) {
  const { provider: agentProvider, model: agentModel } = resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const modelRef = `${agentProvider}/${agentModel}`;
  params.log.info(`agent model: ${modelRef}`, {
    consoleMessage: `agent model: ${chalk.whiteBright(modelRef)}`,
  });
  const scheme = params.tlsEnabled ? "wss" : "ws";
  const formatHost = (host: string) => (host.includes(":") ? `[${host}]` : host);
  const hosts =
    params.bindHosts && params.bindHosts.length > 0 ? params.bindHosts : [params.bindHost];
  const primaryHost = hosts[0] ?? params.bindHost;
  params.log.info(
    `listening on ${scheme}://${formatHost(primaryHost)}:${params.port} (PID ${process.pid})`,
  );
  for (const host of hosts.slice(1)) {
    params.log.info(`listening on ${scheme}://${formatHost(host)}:${params.port}`);
  }
  params.log.info(`log file: ${getResolvedLoggerSettings().file}`);
  if (params.isNixMode) {
    params.log.info("gateway: running in Nix mode (config managed externally)");
  }

  // Warn if voice-capable channels are enabled but STT isn't configured
  const hasVoiceChannel =
    params.cfg.channels?.whatsapp ||
    params.cfg.channels?.matrix?.enabled ||
    params.cfg.channels?.telegram;
  const hasAudioConfig =
    params.cfg.tools?.media?.audio?.enabled !== false &&
    Array.isArray(params.cfg.tools?.media?.audio?.models) &&
    params.cfg.tools?.media?.audio?.models.length > 0;
  if (hasVoiceChannel && !hasAudioConfig) {
    params.log.info(
      "WARNING: voice-capable channels are enabled but audio transcription (STT) is not configured. " +
        "Add tools.media.audio.models to edwinpai.json to enable voice note transcription. " +
        'Example: { "provider": "openai", "model": "gpt-4o-mini-transcribe" }',
      {
        consoleMessage: chalk.yellow(
          "⚠ Voice channels enabled but STT not configured — voice notes won't be transcribed. " +
            "Add tools.media.audio to config.",
        ),
      },
    );
  }
}
