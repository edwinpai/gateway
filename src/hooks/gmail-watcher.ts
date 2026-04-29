/**
 * Gmail Watcher Service
 *
 * Automatically starts `gws gmail +watch` when the gateway starts,
 * if hooks.gmail is configured with an account.
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { EdwinPAIConfig } from "../config/config.js";
import { hasBinary } from "../agents/skills.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { ensureTailscaleEndpoint } from "./gmail-setup-utils.js";
import {
  buildGwsWatchServeArgs,
  buildGwsWatchStartArgs,
  type GmailHookRuntimeConfig,
  resolveGmailHookRuntimeConfig,
} from "./gmail.js";

const log = createSubsystemLogger("gmail-watcher");

const ADDRESS_IN_USE_RE = /address already in use|EADDRINUSE/i;

export function isAddressInUseError(line: string): boolean {
  return ADDRESS_IN_USE_RE.test(line);
}

let watcherProcess: ChildProcess | null = null;
let renewInterval: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;
let currentConfig: GmailHookRuntimeConfig | null = null;

/**
 * Check if gws binary is available
 */
function isGwsAvailable(): boolean {
  return hasBinary("gws");
}

/**
 * Start the Gmail watch (registers with Gmail API)
 */
async function startGmailWatch(
  cfg: Pick<GmailHookRuntimeConfig, "account" | "label" | "topic">,
): Promise<boolean> {
  const args = ["gws", ...buildGwsWatchStartArgs(cfg)];
  try {
    const result = await runCommandWithTimeout(args, { timeoutMs: 120_000 });
    if (result.code !== 0) {
      const message = result.stderr || result.stdout || "gws watch start failed";
      log.error(`watch start failed: ${message}`);
      return false;
    }
    log.info(`watch started for ${cfg.account}`);
    return true;
  } catch (err) {
    log.error(`watch start error: ${String(err)}`);
    return false;
  }
}

/**
 * Spawn the gws gmail +watch process
 */
function spawnGwsServe(cfg: GmailHookRuntimeConfig): ChildProcess {
  const args = buildGwsWatchServeArgs(cfg);
  log.info(`starting gws ${args.join(" ")}`);
  let addressInUse = false;

  const child = spawn("gws", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  child.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      log.info(`[gws] ${line}`);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (!line) {
      return;
    }
    if (isAddressInUseError(line)) {
      addressInUse = true;
    }
    log.warn(`[gws] ${line}`);
  });

  child.on("error", (err) => {
    log.error(`gws process error: ${String(err)}`);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    if (addressInUse) {
      log.warn(
        "gws serve failed to bind (address already in use); stopping restarts. " +
          "Another watcher is likely running. Set EDWINPAI_SKIP_GMAIL_WATCHER=1 or stop the other process.",
      );
      watcherProcess = null;
      return;
    }
    log.warn(`gws exited (code=${code}, signal=${signal}); restarting in 5s`);
    watcherProcess = null;
    setTimeout(() => {
      if (shuttingDown || !currentConfig) {
        return;
      }
      watcherProcess = spawnGwsServe(currentConfig);
    }, 5000);
  });

  return child;
}

export type GmailWatcherStartResult = {
  started: boolean;
  reason?: string;
};

/**
 * Start the Gmail watcher service.
 * Called automatically by the gateway if hooks.gmail is configured.
 */
export async function startGmailWatcher(cfg: EdwinPAIConfig): Promise<GmailWatcherStartResult> {
  // Check if gmail hooks are configured
  if (!cfg.hooks?.enabled) {
    return { started: false, reason: "hooks not enabled" };
  }

  if (!cfg.hooks?.gmail?.account) {
    return { started: false, reason: "no gmail account configured" };
  }

  // Check if gws is available
  const gwsAvailable = isGwsAvailable();
  if (!gwsAvailable) {
    return { started: false, reason: "gws binary not found" };
  }

  // Resolve the full runtime config
  const resolved = resolveGmailHookRuntimeConfig(cfg, {});
  if (!resolved.ok) {
    return { started: false, reason: resolved.error };
  }

  const runtimeConfig = resolved.value;
  currentConfig = runtimeConfig;

  // Set up Tailscale endpoint if needed
  if (runtimeConfig.tailscale.mode !== "off") {
    try {
      await ensureTailscaleEndpoint({
        mode: runtimeConfig.tailscale.mode,
        path: runtimeConfig.tailscale.path,
        port: runtimeConfig.serve.port,
        target: runtimeConfig.tailscale.target,
      });
      log.info(
        `tailscale ${runtimeConfig.tailscale.mode} configured for port ${runtimeConfig.serve.port}`,
      );
    } catch (err) {
      log.error(`tailscale setup failed: ${String(err)}`);
      return {
        started: false,
        reason: `tailscale setup failed: ${String(err)}`,
      };
    }
  }

  // Start the Gmail watch (register with Gmail API)
  const watchStarted = await startGmailWatch(runtimeConfig);
  if (!watchStarted) {
    log.warn("gmail watch start failed, but continuing with serve");
  }

  // Spawn the gws serve process
  shuttingDown = false;
  watcherProcess = spawnGwsServe(runtimeConfig);

  // Set up renewal interval
  const renewMs = runtimeConfig.renewEveryMinutes * 60_000;
  renewInterval = setInterval(() => {
    if (shuttingDown) {
      return;
    }
    void startGmailWatch(runtimeConfig);
  }, renewMs);

  log.info(
    `gmail watcher started for ${runtimeConfig.account} (renew every ${runtimeConfig.renewEveryMinutes}m)`,
  );

  return { started: true };
}

/**
 * Stop the Gmail watcher service.
 */
export async function stopGmailWatcher(): Promise<void> {
  shuttingDown = true;

  if (renewInterval) {
    clearInterval(renewInterval);
    renewInterval = null;
  }

  if (watcherProcess) {
    log.info("stopping gmail watcher");
    watcherProcess.kill("SIGTERM");

    // Wait a bit for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (watcherProcess) {
          watcherProcess.kill("SIGKILL");
        }
        resolve();
      }, 3000);

      watcherProcess?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    watcherProcess = null;
  }

  currentConfig = null;
  log.info("gmail watcher stopped");
}

/**
 * Check if the Gmail watcher is running.
 */
export function isGmailWatcherRunning(): boolean {
  return watcherProcess !== null && !shuttingDown;
}
