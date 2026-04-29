import fs from "node:fs/promises";
import path from "node:path";
import { formatCliCommand } from "../cli/command-format.js";
import { resolveStateDir } from "../config/paths.js";

export type RestartSentinelLog = {
  stdoutTail?: string | null;
  stderrTail?: string | null;
  exitCode?: number | null;
};

export type RestartSentinelStep = {
  name: string;
  command: string;
  cwd?: string | null;
  durationMs?: number | null;
  log?: RestartSentinelLog | null;
};

export type RestartSentinelStats = {
  mode?: string;
  root?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  steps?: RestartSentinelStep[];
  reason?: string | null;
  durationMs?: number | null;
};

export type RestartSentinelPayload = {
  kind: "config-apply" | "update" | "restart";
  status: "ok" | "error" | "skipped";
  ts: number;
  sessionKey?: string;
  /** Delivery context captured at restart time to ensure channel routing survives restart. */
  deliveryContext?: {
    channel?: string;
    to?: string;
    accountId?: string;
  };
  /** Thread ID for reply threading (e.g., Slack thread_ts). */
  threadId?: string;
  message?: string | null;
  doctorHint?: string | null;
  stats?: RestartSentinelStats | null;
};

export type RestartSentinel = {
  version: 1;
  payload: RestartSentinelPayload;
};

const SENTINEL_FILENAME = "restart-sentinel.json";

export function formatDoctorNonInteractiveHint(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  return `Run: ${formatCliCommand("edwinpai doctor --non-interactive", env)}`;
}

export function resolveRestartSentinelPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), SENTINEL_FILENAME);
}

export async function writeRestartSentinel(
  payload: RestartSentinelPayload,
  env: NodeJS.ProcessEnv = process.env,
) {
  const filePath = resolveRestartSentinelPath(env);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const data: RestartSentinel = { version: 1, payload };
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  return filePath;
}

export async function readRestartSentinel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RestartSentinel | null> {
  const filePath = resolveRestartSentinelPath(env);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    let parsed: RestartSentinel | undefined;
    try {
      parsed = JSON.parse(raw) as RestartSentinel | undefined;
    } catch {
      await fs.unlink(filePath).catch(() => {});
      return null;
    }
    if (!parsed || parsed.version !== 1 || !parsed.payload) {
      await fs.unlink(filePath).catch(() => {});
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function consumeRestartSentinel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RestartSentinel | null> {
  const filePath = resolveRestartSentinelPath(env);
  const parsed = await readRestartSentinel(env);
  if (!parsed) {
    return null;
  }
  await fs.unlink(filePath).catch(() => {});
  return parsed;
}

export function formatRestartSentinelMessage(payload: RestartSentinelPayload): string {
  // Compact summary for context injection — full details stay on disk in the sentinel file.
  const lines: string[] = [];
  const { kind, status, stats, message, doctorHint } = payload;
  const mode = stats?.mode ? ` (${stats.mode})` : "";
  lines.push(`GatewayRestart: ${kind} ${status}${mode}`);

  if (stats?.before || stats?.after) {
    const before = stats.before as { sha?: string; version?: string } | null;
    const after = stats.after as { sha?: string; version?: string } | null;
    const bSha = before?.sha?.slice(0, 10) ?? "?";
    const aSha = after?.sha?.slice(0, 10) ?? "?";
    const changed = bSha !== aSha;
    lines.push(
      changed
        ? `Version: ${before?.version ?? "?"} (${bSha}) → ${after?.version ?? "?"} (${aSha})`
        : `Version: ${before?.version ?? "?"} (${bSha}) (no change)`,
    );
  }

  if (stats?.reason) {
    lines.push(`Reason: ${stats.reason}`);
  }
  if (stats?.durationMs != null) {
    lines.push(`Duration: ${(stats.durationMs / 1000).toFixed(1)}s`);
  }

  // Summarize steps: just name + pass/fail + duration. Include stderr snippet only for failures.
  if (stats?.steps?.length) {
    const stepSummaries: string[] = [];
    for (const step of stats.steps) {
      const ok = step.log?.exitCode === 0;
      const dur = step.durationMs != null ? ` (${(step.durationMs / 1000).toFixed(1)}s)` : "";
      if (ok) {
        stepSummaries.push(`  ✅ ${step.name}${dur}`);
      } else {
        const errSnippet = (step.log?.stderrTail ?? step.log?.stdoutTail ?? "")
          .split("\n")
          .filter(Boolean)
          .slice(-3)
          .join(" | ");
        const snippet = errSnippet ? `: ${errSnippet.slice(0, 200)}` : "";
        stepSummaries.push(`  ❌ ${step.name}${dur}${snippet}`);
      }
    }
    lines.push("Steps:", ...stepSummaries);
  }

  if (message) {
    lines.push(`Message: ${message}`);
  }
  if (doctorHint) {
    lines.push(doctorHint);
  }

  return lines.join("\n");
}

export function summarizeRestartSentinel(payload: RestartSentinelPayload): string {
  const kind = payload.kind;
  const status = payload.status;
  const mode = payload.stats?.mode ? ` (${payload.stats.mode})` : "";
  return `Gateway restart ${kind} ${status}${mode}`.trim();
}

export function trimLogTail(input?: string | null, maxChars = 8000) {
  if (!input) {
    return null;
  }
  const text = input.trimEnd();
  if (text.length <= maxChars) {
    return text;
  }
  return `…${text.slice(text.length - maxChars)}`;
}
