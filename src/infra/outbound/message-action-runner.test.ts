import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPlugin } from "../../channels/plugins/types.js";
import type { EdwinPAIConfig } from "../../config/config.js";
import { discordPlugin } from "../../../extensions/discord/src/channel.js";
import { telegramPlugin } from "../../../extensions/telegram/src/channel.js";
import { whatsappPlugin } from "../../../extensions/whatsapp/src/channel.js";
import { jsonResult } from "../../agents/tools/common.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";
import { loadWebMedia } from "../../web/media.js";
import { runMessageAction } from "./message-action-runner.js";

vi.mock("../../web/media.js", async () => {
  const actual = await vi.importActual<typeof import("../../web/media.js")>("../../web/media.js");
  return {
    ...actual,
    loadWebMedia: vi.fn(actual.loadWebMedia),
  };
});

const discordConfig = {
  channels: {
    discord: {
      token: "discord-bot-token-test",
    },
  },
} as EdwinPAIConfig;

const whatsappConfig = {
  channels: {
    whatsapp: {
      allowFrom: ["*"],
    },
  },
} as EdwinPAIConfig;

describe("runMessageAction context isolation", () => {
  beforeEach(async () => {
    const { createPluginRuntime } = await import("../../plugins/runtime/index.js");
    const { setDiscordRuntime } = await import("../../../extensions/discord/src/runtime.js");
    const { setTelegramRuntime } = await import("../../../extensions/telegram/src/runtime.js");
    const { setWhatsAppRuntime } = await import("../../../extensions/whatsapp/src/runtime.js");
    const runtime = createPluginRuntime();
    setDiscordRuntime(runtime);
    setTelegramRuntime(runtime);
    setWhatsAppRuntime(runtime);
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "discord",
          source: "test",
          plugin: discordPlugin,
        },
        {
          pluginId: "whatsapp",
          source: "test",
          plugin: whatsappPlugin,
        },
        {
          pluginId: "telegram",
          source: "test",
          plugin: telegramPlugin,
        },
      ]),
    );
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
  });

  it("allows send when target matches current channel", async () => {
    const result = await runMessageAction({
      cfg: discordConfig,
      action: "send",
      params: {
        channel: "discord",
        target: "#C12345678",
        message: "hi",
      },
      toolContext: { currentChannelId: "C12345678" },
      dryRun: true,
    });

    expect(result.kind).toBe("send");
  });

  it("accepts legacy to parameter for send", async () => {
    const result = await runMessageAction({
      cfg: discordConfig,
      action: "send",
      params: {
        channel: "discord",
        to: "#C12345678",
        message: "hi",
      },
      dryRun: true,
    });

    expect(result.kind).toBe("send");
  });

  it("defaults to current channel when target is omitted", async () => {
    const result = await runMessageAction({
      cfg: discordConfig,
      action: "send",
      params: {
        channel: "discord",
        message: "hi",
      },
      toolContext: { currentChannelId: "C12345678" },
      dryRun: true,
    });

    expect(result.kind).toBe("send");
  });

  it("allows media-only send when target matches current channel", async () => {
    const result = await runMessageAction({
      cfg: discordConfig,
      action: "send",
      params: {
        channel: "discord",
        target: "#C12345678",
        media: "https://example.com/note.ogg",
      },
      toolContext: { currentChannelId: "C12345678" },
      dryRun: true,
    });

    expect(result.kind).toBe("send");
  });

  it("requires message when no media hint is provided", async () => {
    await expect(
      runMessageAction({
        cfg: discordConfig,
        action: "send",
        params: {
          channel: "discord",
          target: "#C12345678",
        },
        toolContext: { currentChannelId: "C12345678" },
        dryRun: true,
      }),
    ).rejects.toThrow(/message required/i);
  });

  it("blocks send when target differs from current channel", async () => {
    const result = await runMessageAction({
      cfg: discordConfig,
      action: "send",
      params: {
        channel: "discord",
        target: "channel:C99999999",
        message: "hi",
      },
      toolContext: { currentChannelId: "C12345678", currentChannelProvider: "discord" },
      dryRun: true,
    });

    expect(result.kind).toBe("send");
  });

  it("blocks thread-reply when channelId differs from current channel", async () => {
    const result = await runMessageAction({
      cfg: discordConfig,
      action: "thread-reply",
      params: {
        channel: "discord",
        target: "C99999999",
        message: "hi",
      },
      toolContext: { currentChannelId: "C12345678", currentChannelProvider: "discord" },
      dryRun: true,
    });

    expect(result.kind).toBe("action");
  });

  it("allows WhatsApp send when target matches current chat", async () => {
    const result = await runMessageAction({
      cfg: whatsappConfig,
      action: "send",
      params: {
        channel: "whatsapp",
        target: "123@g.us",
        message: "hi",
      },
      toolContext: { currentChannelId: "123@g.us" },
      dryRun: true,
    });

    expect(result.kind).toBe("send");
  });

  it("blocks WhatsApp send when target differs from current chat", async () => {
    const result = await runMessageAction({
      cfg: whatsappConfig,
      action: "send",
      params: {
        channel: "whatsapp",
        target: "456@g.us",
        message: "hi",
      },
      toolContext: { currentChannelId: "123@g.us", currentChannelProvider: "whatsapp" },
      dryRun: true,
    });

    expect(result.kind).toBe("send");
  });

  it("infers channel + target from tool context when missing", async () => {
    const multiConfig = {
      channels: {
        discord: {
          token: "discord-bot-token-test",
        },
        telegram: {
          token: "tg-test",
        },
      },
    } as EdwinPAIConfig;

    const result = await runMessageAction({
      cfg: multiConfig,
      action: "send",
      params: {
        message: "hi",
      },
      toolContext: { currentChannelId: "C12345678", currentChannelProvider: "discord" },
      dryRun: true,
    });

    expect(result.kind).toBe("send");
    expect(result.channel).toBe("discord");
  });

  it("blocks cross-provider sends by default", async () => {
    await expect(
      runMessageAction({
        cfg: discordConfig,
        action: "send",
        params: {
          channel: "telegram",
          target: "telegram:@ops",
          message: "hi",
        },
        toolContext: { currentChannelId: "C12345678", currentChannelProvider: "discord" },
        dryRun: true,
      }),
    ).rejects.toThrow(/Cross-context messaging denied/);
  });

  it("blocks same-provider cross-context when disabled", async () => {
    const cfg = {
      ...discordConfig,
      tools: {
        message: {
          crossContext: {
            allowWithinProvider: false,
          },
        },
      },
    } as EdwinPAIConfig;

    await expect(
      runMessageAction({
        cfg,
        action: "send",
        params: {
          channel: "discord",
          target: "channel:C99999999",
          message: "hi",
        },
        toolContext: { currentChannelId: "C12345678", currentChannelProvider: "discord" },
        dryRun: true,
      }),
    ).rejects.toThrow(/Cross-context messaging denied/);
  });

  it("aborts send when abortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runMessageAction({
        cfg: discordConfig,
        action: "send",
        params: {
          channel: "discord",
          target: "#C12345678",
          message: "hi",
        },
        dryRun: true,
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts broadcast when abortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runMessageAction({
        cfg: discordConfig,
        action: "broadcast",
        params: {
          targets: ["channel:C12345678"],
          channel: "discord",
          message: "hi",
        },
        dryRun: true,
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("runMessageAction sendAttachment hydration", () => {
  const attachmentPlugin: ChannelPlugin = {
    id: "test-media",
    meta: {
      id: "test-media",
      label: "TestMedia",
      selectionLabel: "TestMedia",
      docsPath: "/channels/test-media",
      blurb: "Test media plugin.",
    },
    capabilities: { chatTypes: ["direct"], media: true },
    config: {
      listAccountIds: () => ["default"],
      resolveAccount: () => ({ enabled: true }),
      isConfigured: () => true,
    },
    actions: {
      listActions: () => ["sendAttachment"],
      supportsAction: ({ action }) => action === "sendAttachment",
      handleAction: async ({ params }) =>
        jsonResult({
          ok: true,
          buffer: params.buffer,
          filename: params.filename,
          caption: params.caption,
          contentType: params.contentType,
        }),
    },
  };

  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "test-media",
          source: "test",
          plugin: attachmentPlugin,
        },
      ]),
    );
    vi.mocked(loadWebMedia).mockResolvedValue({
      buffer: Buffer.from("hello"),
      contentType: "image/png",
      kind: "image",
      fileName: "pic.png",
    });
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
    vi.clearAllMocks();
  });

  it("hydrates buffer and filename from media for sendAttachment", async () => {
    const cfg = {
      channels: {
        "test-media": {
          enabled: true,
          serverUrl: "http://localhost:1234",
          password: "test-password",
        },
      },
    } as EdwinPAIConfig;

    const result = await runMessageAction({
      cfg,
      action: "sendAttachment",
      params: {
        channel: "test-media",
        target: "+15551234567",
        media: "https://example.com/pic.png",
        message: "caption",
      },
    });

    expect(result.kind).toBe("action");
    expect(result.payload).toMatchObject({
      ok: true,
      filename: "pic.png",
      caption: "caption",
      contentType: "image/png",
    });
    expect((result.payload as { buffer?: string }).buffer).toBe(
      Buffer.from("hello").toString("base64"),
    );
  });
});

describe("runMessageAction accountId defaults", () => {
  const handleAction = vi.fn(async () => jsonResult({ ok: true }));
  const accountPlugin: ChannelPlugin = {
    id: "discord",
    meta: {
      id: "discord",
      label: "Discord",
      selectionLabel: "Discord",
      docsPath: "/channels/discord",
      blurb: "Discord test plugin.",
    },
    capabilities: { chatTypes: ["direct"] },
    config: {
      listAccountIds: () => ["default"],
      resolveAccount: () => ({}),
    },
    actions: {
      listActions: () => ["send"],
      handleAction,
    },
  };

  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "discord",
          source: "test",
          plugin: accountPlugin,
        },
      ]),
    );
    handleAction.mockClear();
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
    vi.clearAllMocks();
  });

  it("propagates defaultAccountId into params", async () => {
    await runMessageAction({
      cfg: {} as EdwinPAIConfig,
      action: "send",
      params: {
        channel: "discord",
        target: "channel:123",
        message: "hi",
      },
      defaultAccountId: "ops",
    });

    expect(handleAction).toHaveBeenCalled();
    const ctx = handleAction.mock.calls[0]?.[0] as {
      accountId?: string | null;
      params: Record<string, unknown>;
    };
    expect(ctx.accountId).toBe("ops");
    expect(ctx.params.accountId).toBe("ops");
  });
});
