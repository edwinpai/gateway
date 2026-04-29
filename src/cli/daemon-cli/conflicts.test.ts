import { describe, expect, it } from "vitest";
import {
  collectDescendantPids,
  parsePsOutput,
  parseWindowsProcessListJson,
  selectConflictingGatewayProcesses,
  type PsProcess,
} from "./conflicts.js";

describe("daemon conflict helpers", () => {
  it("parses ps output", () => {
    const parsed = parsePsOutput(
      [
        "58970 1 /bin/zsh -c edwinpai gateway status",
        "58972 58970 edwinpai-gateway",
        "86245 1 edwinpai-gateway",
        "86301 44513 edwinpai-tui",
        "",
      ].join("\n"),
    );

    expect(parsed).toEqual<PsProcess[]>([
      { pid: 58970, ppid: 1, command: "/bin/zsh -c edwinpai gateway status" },
      { pid: 58972, ppid: 58970, command: "edwinpai-gateway" },
      { pid: 86245, ppid: 1, command: "edwinpai-gateway" },
      { pid: 86301, ppid: 44513, command: "edwinpai-tui" },
    ]);
  });

  it("parses Windows process JSON", () => {
    const parsed = parseWindowsProcessListJson(
      JSON.stringify([
        {
          ProcessId: 100,
          ParentProcessId: 1,
          CommandLine: 'C:\\Windows\\System32\\cmd.exe /d /s /c "edwinpai gateway status"',
          Name: "cmd.exe",
        },
        {
          ProcessId: 101,
          ParentProcessId: 100,
          CommandLine: null,
          Name: "edwinpai-gateway.exe",
        },
      ]),
    );

    expect(parsed).toEqual<PsProcess[]>([
      {
        pid: 100,
        ppid: 1,
        command: 'C:\\Windows\\System32\\cmd.exe /d /s /c "edwinpai gateway status"',
      },
      { pid: 101, ppid: 100, command: "edwinpai-gateway.exe" },
    ]);
  });

  it("collects descendants recursively", () => {
    const processes: PsProcess[] = [
      { pid: 10, ppid: 1, command: "root" },
      { pid: 11, ppid: 10, command: "child" },
      { pid: 12, ppid: 11, command: "grandchild" },
    ];
    expect(collectDescendantPids(processes, 10)).toEqual([10, 11, 12]);
  });

  it("selects stale gateway status chains and extra gateway processes", () => {
    const processes: PsProcess[] = [
      { pid: 58970, ppid: 1, command: "/bin/zsh -c edwinpai gateway status" },
      { pid: 71959, ppid: 1, command: "/bin/zsh -c edwinpai gateway status 2>&1" },
      { pid: 71961, ppid: 71959, command: "edwinpai" },
      { pid: 58972, ppid: 58970, command: "edwinpai-gateway" },
      { pid: 71962, ppid: 71961, command: "edwinpai-gateway" },
      { pid: 86245, ppid: 1, command: "edwinpai-gateway" },
      { pid: 86301, ppid: 44513, command: "edwinpai-tui" },
    ];

    const selected = selectConflictingGatewayProcesses(processes, { activeGatewayPid: 86245 });
    expect(selected.map((proc) => proc.pid)).toEqual([58970, 58972, 71959, 71961, 71962]);
  });

  it("selects Windows status wrappers and extra gateways while preserving the active one", () => {
    const processes: PsProcess[] = [
      {
        pid: 100,
        ppid: 1,
        command: 'C:\\Windows\\System32\\cmd.exe /d /s /c "edwinpai gateway status"',
      },
      { pid: 101, ppid: 100, command: "edwinpai.cmd gateway status" },
      { pid: 102, ppid: 101, command: "edwinpai-gateway.exe" },
      { pid: 200, ppid: 1, command: "edwinpai-gateway.exe" },
      { pid: 300, ppid: 1, command: "other.exe" },
    ];

    const selected = selectConflictingGatewayProcesses(processes, { activeGatewayPid: 200 });
    expect(selected.map((proc) => proc.pid)).toEqual([100, 101, 102]);
  });
});
