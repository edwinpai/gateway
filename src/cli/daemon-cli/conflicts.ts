import { execFileSync } from "node:child_process";

export type PsProcess = {
  pid: number;
  ppid: number;
  command: string;
};

function normalizeWindowsCommand(command: string, fallbackName: string): string {
  const trimmed = command.trim();
  if (trimmed) {
    return trimmed;
  }
  return fallbackName.trim();
}

export function parsePsOutput(output: string): PsProcess[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      const pid = Number.parseInt(match[1] ?? "", 10);
      const ppid = Number.parseInt(match[2] ?? "", 10);
      const command = (match[3] ?? "").trim();
      if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !command) {
        return null;
      }
      return { pid, ppid, command } satisfies PsProcess;
    })
    .filter((entry): entry is PsProcess => Boolean(entry));
}

export function parseWindowsProcessListJson(output: string): PsProcess[] {
  const parsed = JSON.parse(output) as
    | {
        ProcessId?: number;
        ParentProcessId?: number;
        CommandLine?: string | null;
        Name?: string | null;
      }
    | Array<{
        ProcessId?: number;
        ParentProcessId?: number;
        CommandLine?: string | null;
        Name?: string | null;
      }>;

  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return rows
    .map((row) => {
      const pid = Number(row.ProcessId ?? Number.NaN);
      const ppid = Number(row.ParentProcessId ?? 0);
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
        return null;
      }
      return {
        pid,
        ppid,
        command: normalizeWindowsCommand(String(row.CommandLine ?? ""), String(row.Name ?? "")),
      } satisfies PsProcess;
    })
    .filter((entry): entry is PsProcess => Boolean(entry));
}

export function collectDescendantPids(processes: PsProcess[], rootPid: number): number[] {
  const byParent = new Map<number, number[]>();
  for (const proc of processes) {
    const list = byParent.get(proc.ppid) ?? [];
    list.push(proc.pid);
    byParent.set(proc.ppid, list);
  }

  const seen = new Set<number>();
  const out: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    out.push(current);
    for (const child of byParent.get(current) ?? []) {
      queue.push(child);
    }
  }
  return out;
}

function isStatusCommand(command: string): boolean {
  return /edwinpai(?:\.cmd|\.exe)?\s+gateway\s+status/i.test(command);
}

function isGatewayCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized === "edwinpai-gateway" || normalized.endsWith("edwinpai-gateway.exe");
}

export function selectConflictingGatewayProcesses(
  processes: PsProcess[],
  options: { activeGatewayPid?: number | null } = {},
): PsProcess[] {
  const activeGatewayPid = options.activeGatewayPid ?? null;
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]));
  const selected = new Set<number>();

  for (const proc of processes) {
    if (isStatusCommand(proc.command)) {
      for (const pid of collectDescendantPids(processes, proc.pid)) {
        selected.add(pid);
      }
    }
  }

  for (const proc of processes) {
    if (isGatewayCommand(proc.command) && proc.pid !== activeGatewayPid) {
      selected.add(proc.pid);
    }
  }

  if (activeGatewayPid != null) {
    selected.delete(activeGatewayPid);
  }

  return [...selected]
    .map((pid) => byPid.get(pid))
    .filter((entry): entry is PsProcess => Boolean(entry))
    .sort((a, b) => a.pid - b.pid);
}

export function listUnixProcesses(): PsProcess[] {
  const out = execFileSync("ps", ["-Ao", "pid=,ppid=,command="], { encoding: "utf-8" });
  return parsePsOutput(out);
}

export function listWindowsProcesses(): PsProcess[] {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine, Name",
    "$procs | ConvertTo-Json -Compress",
  ].join("; ");
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf-8",
  });
  return parseWindowsProcessListJson(out);
}

export function listProcesses(): PsProcess[] {
  if (process.platform === "win32") {
    return listWindowsProcesses();
  }
  return listUnixProcesses();
}

function terminatePid(proc: PsProcess, force: boolean) {
  if (process.platform === "win32") {
    const args = ["/PID", String(proc.pid), "/T"];
    if (force) {
      args.push("/F");
    }
    try {
      execFileSync("taskkill.exe", args, { stdio: "ignore" });
    } catch {
      // best effort
    }
    return;
  }

  try {
    process.kill(proc.pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // best effort
  }
}

export async function killConflictingGatewayProcesses(
  options: {
    activeGatewayPid?: number | null;
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<{ killed: PsProcess[]; escalated: PsProcess[] }> {
  const timeoutMs = Math.max(options.timeoutMs ?? 1200, 0);
  const intervalMs = Math.max(options.intervalMs ?? 100, 1);

  const initial = selectConflictingGatewayProcesses(listProcesses(), {
    activeGatewayPid: options.activeGatewayPid,
  });
  if (initial.length === 0) {
    return { killed: [], escalated: [] };
  }

  for (const proc of initial) {
    terminatePid(proc, false);
  }

  let waitedMs = 0;
  while (waitedMs < timeoutMs) {
    const remaining = selectConflictingGatewayProcesses(listProcesses(), {
      activeGatewayPid: options.activeGatewayPid,
    });
    if (remaining.length === 0) {
      return { killed: initial, escalated: [] };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    waitedMs += intervalMs;
  }

  const escalated = selectConflictingGatewayProcesses(listProcesses(), {
    activeGatewayPid: options.activeGatewayPid,
  });
  for (const proc of escalated) {
    terminatePid(proc, true);
  }

  return { killed: initial, escalated };
}
