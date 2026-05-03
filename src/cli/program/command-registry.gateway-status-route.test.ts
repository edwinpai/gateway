import { describe, expect, it, vi } from "vitest";

const runDaemonStatus = vi.fn(async () => undefined);

vi.mock("../../cli/daemon-cli/status.js", () => ({
  runDaemonStatus,
}));

describe("gateway status route", () => {
  it("routes gateway status without loading the heavy gateway CLI", async () => {
    const { findRoutedCommand } = await import("./command-registry.js");

    const route = findRoutedCommand(["gateway", "status"]);

    expect(route).not.toBeNull();
    await expect(
      route?.run([
        "node",
        "edwinpai",
        "gateway",
        "status",
        "--no-probe",
        "--json",
        "--timeout",
        "1234",
      ]),
    ).resolves.toBe(true);
    expect(runDaemonStatus).toHaveBeenCalledWith({
      rpc: {
        timeout: "1234",
        json: true,
      },
      probe: false,
      deep: false,
      json: true,
    });
  });
});
