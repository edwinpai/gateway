import { describe, expect, it } from "vitest";
import { isDirectMemoryReadAllowed, resolveMemoryCapabilityTier } from "./access-policy.js";

describe("memory access policy", () => {
  it("derives search-only capability for attach-on-demand subagents", () => {
    expect(
      resolveMemoryCapabilityTier({
        actorType: "subagent",
        runtimeAttachmentPolicy: "attach-on-demand",
      }),
    ).toBe("search-only");
    expect(
      isDirectMemoryReadAllowed({
        agentId: "main",
        actorType: "subagent",
        runtimeAttachmentPolicy: "attach-on-demand",
      }),
    ).toBe(false);
  });

  it("keeps search-and-read capability for mounted-only subagents and main sessions", () => {
    expect(
      resolveMemoryCapabilityTier({
        actorType: "subagent",
        runtimeAttachmentPolicy: "mounted-only",
      }),
    ).toBe("search-and-read");
    expect(
      resolveMemoryCapabilityTier({
        actorType: "main",
      }),
    ).toBe("search-and-read");
    expect(
      isDirectMemoryReadAllowed({
        agentId: "main",
        actorType: "subagent",
        runtimeAttachmentPolicy: "mounted-only",
      }),
    ).toBe(true);
  });
});
