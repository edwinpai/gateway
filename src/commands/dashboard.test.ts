import { describe, expect, it, vi } from "vitest";
import { dashboardCommand } from "./dashboard.js";

const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

describe("dashboardCommand", () => {
  it("points users to the Desktop app now that the legacy browser dashboard is removed", async () => {
    runtime.log.mockClear();

    await dashboardCommand(runtime);

    expect(runtime.log).toHaveBeenCalledWith(
      "Legacy browser dashboard has been removed. Use the Edwin Desktop app as the sole UI.",
    );
  });
});
