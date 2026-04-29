import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EdwinPAIConfig } from "../config/config.js";
import { discordPlugin } from "../../extensions/discord/src/channel.js";
import { setDiscordRuntime } from "../../extensions/discord/src/runtime.js";
import { telegramPlugin } from "../../extensions/telegram/src/channel.js";
import { setTelegramRuntime } from "../../extensions/telegram/src/runtime.js";
import { whatsappPlugin } from "../../extensions/whatsapp/src/channel.js";
import { setWhatsAppRuntime } from "../../extensions/whatsapp/src/runtime.js";
import * as replyModule from "../auto-reply/reply.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createPluginRuntime } from "../plugins/runtime/index.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";

// Avoid pulling optional runtime deps during isolated runs.
vi.mock("jiti", () => ({ createJiti: () => () => ({}) }));

beforeEach(() => {
  const runtime = createPluginRuntime();
  setDiscordRuntime(runtime);
  setTelegramRuntime(runtime);
  setWhatsAppRuntime(runtime);
  setActivePluginRegistry(
    createTestRegistry([
      { pluginId: "discord", plugin: discordPlugin, source: "test" },
      { pluginId: "whatsapp", plugin: whatsappPlugin, source: "test" },
      { pluginId: "telegram", plugin: telegramPlugin, source: "test" },
    ]),
  );
});

describe("runHeartbeatOnce", () => {
  it("uses the delivery target as sender when lastTo differs", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-hb-"));
    const storePath = path.join(tmpDir, "sessions.json");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      const cfg: EdwinPAIConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: {
              every: "5m",
              target: "discord",
              to: "987654321012345678",
            },
          },
        },
        session: { store: storePath },
      };
      const sessionKey = resolveMainSessionKey(cfg);

      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [sessionKey]: {
              sessionId: "sid",
              updatedAt: Date.now(),
              lastChannel: "telegram",
              lastProvider: "telegram",
              lastTo: "1644620762",
            },
          },
          null,
          2,
        ),
      );

      replySpy.mockImplementation(async (ctx) => {
        expect(ctx.To).toBe("987654321012345678");
        expect(ctx.From).toBe("987654321012345678");
        return { text: "ok" };
      });

      const sendDiscord = vi.fn().mockResolvedValue({
        messageId: "m1",
        channelId: "987654321012345678",
      });

      await runHeartbeatOnce({
        cfg,
        deps: {
          sendDiscord,
          getQueueSize: () => 0,
          nowMs: () => 0,
        },
      });

      expect(sendDiscord).toHaveBeenCalled();
    } finally {
      replySpy.mockRestore();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
