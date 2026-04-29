import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditGatewayServiceConfig, SERVICE_AUDIT_CODES } from "./service-audit.js";
import { buildMinimalServicePath } from "./service-env.js";

describe("auditGatewayServiceConfig", () => {
  it("flags bun runtime", async () => {
    const audit = await auditGatewayServiceConfig({
      env: { HOME: "/tmp" },
      platform: "darwin",
      command: {
        programArguments: ["/opt/homebrew/bin/bun", "gateway"],
        environment: { PATH: "/usr/bin:/bin" },
      },
    });
    expect(audit.issues.some((issue) => issue.code === SERVICE_AUDIT_CODES.gatewayRuntimeBun)).toBe(
      true,
    );
  });

  it("flags version-managed node paths", async () => {
    const audit = await auditGatewayServiceConfig({
      env: { HOME: "/tmp" },
      platform: "darwin",
      command: {
        programArguments: ["/Users/test/.nvm/versions/node/v22.0.0/bin/node", "gateway"],
        environment: {
          PATH: "/usr/bin:/bin:/Users/test/.nvm/versions/node/v22.0.0/bin",
        },
      },
    });
    expect(
      audit.issues.some(
        (issue) => issue.code === SERVICE_AUDIT_CODES.gatewayRuntimeNodeVersionManager,
      ),
    ).toBe(true);
    expect(
      audit.issues.some((issue) => issue.code === SERVICE_AUDIT_CODES.gatewayPathNonMinimal),
    ).toBe(true);
    expect(
      audit.issues.some((issue) => issue.code === SERVICE_AUDIT_CODES.gatewayPathMissingDirs),
    ).toBe(true);
  });

  it("accepts Linux minimal PATH with user directories", async () => {
    const env = { HOME: "/home/testuser", PNPM_HOME: "/opt/pnpm" };
    const minimalPath = buildMinimalServicePath({ platform: "linux", env });
    const audit = await auditGatewayServiceConfig({
      env,
      platform: "linux",
      command: {
        programArguments: ["/usr/bin/node", "gateway"],
        environment: { PATH: minimalPath },
      },
    });

    expect(
      audit.issues.some((issue) => issue.code === SERVICE_AUDIT_CODES.gatewayPathNonMinimal),
    ).toBe(false);
    expect(
      audit.issues.some((issue) => issue.code === SERVICE_AUDIT_CODES.gatewayPathMissingDirs),
    ).toBe(false);
  });

  it("warns when OPENAI_API_KEY is shell-only for qmd embeddings", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "edwinpai-service-audit-home-"));
    const stateDir = path.join(home, ".edwinpai");
    fs.mkdirSync(stateDir, { recursive: true });

    const env = {
      HOME: home,
      EDWINPAI_STATE_DIR: stateDir,
      OPENAI_API_KEY: "sk-shell-only",
    };
    const minimalPath = buildMinimalServicePath({ platform: "darwin", env });

    const audit = await auditGatewayServiceConfig({
      env,
      platform: "darwin",
      command: {
        programArguments: ["/usr/bin/node", "gateway"],
        environment: { PATH: minimalPath, EDWINPAI_STATE_DIR: stateDir },
      },
      config: {
        memory: {
          backend: "qmd",
        },
      },
    });

    expect(
      audit.issues.some(
        (issue) => issue.code === SERVICE_AUDIT_CODES.gatewayEmbeddingServiceSafeMissing,
      ),
    ).toBe(true);
  });

  it("accepts OPENAI_API_KEY from shared service env file", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "edwinpai-service-audit-home-"));
    const stateDir = path.join(home, ".edwinpai");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, ".env"), "OPENAI_API_KEY=sk-shared\n", "utf8");

    const env = {
      HOME: home,
      EDWINPAI_STATE_DIR: stateDir,
      OPENAI_API_KEY: "sk-shell-only",
    };
    const minimalPath = buildMinimalServicePath({ platform: "darwin", env });

    const audit = await auditGatewayServiceConfig({
      env,
      platform: "darwin",
      command: {
        programArguments: ["/usr/bin/node", "gateway"],
        environment: { PATH: minimalPath, EDWINPAI_STATE_DIR: stateDir },
      },
      config: {
        memory: {
          backend: "qmd",
        },
      },
    });

    expect(
      audit.issues.some(
        (issue) => issue.code === SERVICE_AUDIT_CODES.gatewayEmbeddingServiceSafeMissing,
      ),
    ).toBe(false);
  });
});
