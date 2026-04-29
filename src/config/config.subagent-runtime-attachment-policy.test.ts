import { describe, expect, it } from "vitest";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";

describe("subagent runtimeAttachmentPolicy config validation", () => {
  it("rejects invalid runtimeAttachmentPolicy values in subagent profiles", () => {
    const result = AgentDefaultsSchema.safeParse({
      subagents: {
        profiles: {
          research: {
            selectedCollections: ["workspace"],
            runtimeAttachmentPolicy: "free-for-all",
          },
        },
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected invalid runtimeAttachmentPolicy to fail schema validation");
    }
    expect(
      result.error.issues.some((issue) => issue.path.join(".").includes("runtimeAttachmentPolicy")),
    ).toBe(true);
  });
});
