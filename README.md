# ⚡ EdwinPAI — Personal AI Assistant

<p align="center">
  <a href="https://discord.gg/clawd"><img src="https://img.shields.io/discord/1456350064065904867?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-BSL--1.1-blue.svg?style=for-the-badge" alt="BSL-1.1 License"></a>
</p>

**EdwinPAI** is a _personal AI assistant_ you run on your own devices.
It answers you on the channels you already use (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, WebChat), plus extension channels like BlueBubbles, Matrix, Zalo, and Zalo Personal. It can speak and listen on macOS/iOS/Android, and can render a live Canvas you control. The Gateway is just the control plane — the product is the assistant.

If you want a personal, single-user assistant that feels local, fast, and always-on, this is it.

## Release notes

- See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for the latest release summary, known limitations, and launch checks.

## Security & Data Sovereignty

EdwinPAI's security doesn't depend on the AI model behaving correctly. It's enforced by cryptographic standards on BSV:

- **[BRC-92](https://bsv.brc.dev/tokens/0092)** — Mandala Token Protocol: base token layer for issuance, transfer, and recovery
- **[BRC-107](https://bsv.brc.dev/tokens/0107)** — Enhanced Mandala: cryptographic commitment chains for SPV-verifiable, tamper-proof tokens
- **[BRC-108](https://bsv.brc.dev/tokens/0108)** — Identity-Linked Tokens: KYC/compliance via BRC-52/53 identity certificates with selective field revelation
- **[BRC-115](https://bsv.brc.dev/tokens/0115)** — Deterministic Verification Framework: wallets verify identity-linked tokens without overlay networks

**What this means in practice:**

- Every conversation, memory, and artifact is tokenized on BSV with provable, timestamped ownership
- Your data is cryptographically yours — not "we promise not to look" but mathematically enforced
- Identity verification uses certificates, not model behavior — prompt injection can't bypass math
- The implementation lives in `src/infra/signed-envelope.ts`, `src/infra/desktop-identity.ts`, and `src/infra/authorized-users.ts`

This replaces the "model-as-access-control" approach used by other frameworks (where security depends on the AI following instructions) with deterministic, verifiable cryptography.

[Website](https://edwinpai.com) · [Docs](https://docs.edwinpai.com) · [Getting Started](https://docs.edwinpai.com/start/getting-started) · [Updating](https://docs.edwinpai.com/install/updating) · [Showcase](https://docs.edwinpai.com/start/showcase) · [FAQ](https://docs.edwinpai.com/start/faq) · [Wizard](https://docs.edwinpai.com/start/wizard) · [Docker](https://docs.edwinpai.com/install/docker) · [Discord](https://discord.gg/clawd)

Preferred setup: run the onboarding wizard (`edwin onboard`). It walks through gateway, workspace, channels, and skills. The CLI wizard is the recommended path and works on **macOS, Linux, and Windows (via WSL2; strongly recommended)**.
Works with npm, pnpm, or bun.
New install? Start here: [Getting started](https://docs.edwinpai.com/start/getting-started)

**Subscriptions (OAuth):**

- **[Anthropic](https://www.anthropic.com/)** (Claude Pro/Max)
- **[OpenAI](https://openai.com/)** (ChatGPT/Codex)

Model note: while any model is supported, I strongly recommend **Anthropic Pro/Max (100/200) + Opus 4.6** for long‑context strength and better prompt‑injection resistance. See [Onboarding](https://docs.edwinpai.com/start/onboarding).

## Models (selection + auth)

- Models config + CLI: [Models](https://docs.edwinpai.com/concepts/models)
- Auth profile rotation (OAuth vs API keys) + fallbacks: [Model failover](https://docs.edwinpai.com/concepts/model-failover)

## Install

Runtime: **Node ≥22**.

```bash
git clone https://github.com/jonesj38/edwin.git
cd edwin

# Using pnpm (recommended):
pnpm install && pnpm build && pnpm install -g .

# Using npm:
npm install && npm run build && npm install -g .
```

Then run the onboarding wizard:

```bash
edwin onboard --install-daemon
```

The wizard walks through gateway, workspace, channels, and skills. It installs the Gateway daemon (launchd/systemd user service) so it stays running.

For provider API keys and QMD embeddings, prefer `~/.edwinpai/.env` (or the relevant Edwin config fields) over shell-only exports like `.profile`; the daemon loads `~/.edwinpai/.env` automatically.

## Quick start (TL;DR)

Runtime: **Node ≥22**.

Full beginner guide (auth, pairing, channels): [Getting started](https://docs.edwinpai.com/start/getting-started)

```bash
git clone https://github.com/jonesj38/edwin.git
cd edwin
pnpm install && pnpm build && pnpm install -g .

edwin onboard --install-daemon

edwin gateway --port 18789 --verbose

# Send a message
edwin message send --to +1234567890 --message "Hello from EdwinPAI"

# Talk to the assistant (optionally deliver back to any connected channel: WhatsApp/Telegram/Slack/Discord/Google Chat/Signal/iMessage/BlueBubbles/Microsoft Teams/Matrix/Zalo/Zalo Personal/WebChat)
edwin agent --message "Ship checklist" --thinking high
```

Upgrading? [Updating guide](https://docs.edwinpai.com/install/updating) (and run `edwin doctor`).

## Development channels

- **stable**: tagged releases (`vYYYY.M.D` or `vYYYY.M.D-<patch>`), npm dist-tag `latest`.
- **beta**: prerelease tags (`vYYYY.M.D-beta.N`), npm dist-tag `beta`.
- **dev**: moving head of `main`, npm dist-tag `dev` (when published).

Switch channels (git + npm): `edwin update --channel stable|beta|dev`.
Details: [Development channels](https://docs.edwinpai.com/install/development-channels).

## From source (development)

Prefer `pnpm` for builds from source. Bun is optional for running TypeScript directly.

```bash
git clone https://github.com/jonesj38/edwin.git
cd edwin

pnpm install
pnpm build

pnpm edwin onboard --install-daemon

# Dev loop (auto-reload on TS changes)
pnpm gateway:watch
```

Note: `pnpm edwin ...` runs TypeScript directly (via `tsx`). `pnpm build` produces `dist/` for running via Node / the packaged `edwin` binary.

## Security defaults (DM access)

EdwinPAI connects to real messaging surfaces. Treat inbound DMs as **untrusted input**.

Full security guide: [Security](https://docs.edwinpai.com/gateway/security)

Default behavior on Telegram/WhatsApp/Signal/iMessage/Microsoft Teams/Discord/Google Chat/Slack:

- **DM pairing** (`dmPolicy="pairing"` / `channels.discord.dm.policy="pairing"` / `channels.slack.dm.policy="pairing"`): unknown senders receive a short pairing code and the bot does not process their message.
- Approve with: `edwin pairing approve <channel> <code>` (then the sender is added to a local allowlist store).
- Public inbound DMs require an explicit opt-in: set `dmPolicy="open"` and include `"*"` in the channel allowlist (`allowFrom` / `channels.discord.dm.allowFrom` / `channels.slack.dm.allowFrom`).

Run `edwin doctor` to surface risky/misconfigured DM policies.

## Highlights

- **[Local-first Gateway](https://docs.edwinpai.com/gateway)** — single control plane for sessions, channels, tools, and events.
- **[Multi-channel inbox](https://docs.edwinpai.com/channels)** — WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, BlueBubbles (iMessage), iMessage (legacy), Microsoft Teams, Matrix, Zalo, Zalo Personal, WebChat, macOS, iOS/Android.
- **[Multi-agent routing](https://docs.edwinpai.com/gateway/configuration)** — route inbound channels/accounts/peers to isolated agents (workspaces + per-agent sessions).
- **[Voice Wake](https://docs.edwinpai.com/nodes/voicewake) + [Talk Mode](https://docs.edwinpai.com/nodes/talk)** — always-on speech for macOS/iOS/Android with ElevenLabs.
- **[Live Canvas](https://docs.edwinpai.com/tools/canvas)** — agent-driven visual workspace with [A2UI](https://docs.edwinpai.com/tools/canvas).
- **[First-class tools](https://docs.edwinpai.com/tools)** — browser, canvas, nodes, cron, sessions, and Discord/Slack actions.
- **Companion apps + nodes** — desktop and mobile clients are maintained in dedicated companion repos.
- **[Onboarding](https://docs.edwinpai.com/start/wizard) + [skills](https://docs.edwinpai.com/tools/skills)** — wizard-driven setup with bundled/managed/workspace skills.
- **[Knowledge system](https://docs.edwinpai.com/concepts/knowledge)** — sources, disciplines, and knowledge runs built around Shad/QMD.

## Everything we built so far

### Core platform

- [Gateway WS control plane](https://docs.edwinpai.com/gateway) with sessions, presence, config, cron, webhooks, [Control UI](https://docs.edwinpai.com/web), and [Canvas host](https://docs.edwinpai.com/tools/canvas).
- [CLI surface](https://docs.edwinpai.com/tools/agent-send): gateway, agent, send, [wizard](https://docs.edwinpai.com/start/wizard), and [doctor](https://docs.edwinpai.com/gateway/doctor).
- [Pi agent runtime](https://docs.edwinpai.com/concepts/agent) in RPC mode with tool streaming and block streaming.
- [Session model](https://docs.edwinpai.com/concepts/session): `main` for direct chats, group isolation, activation modes, queue modes, reply-back. Group rules: [Groups](https://docs.edwinpai.com/concepts/groups).
- [Media pipeline](https://docs.edwinpai.com/nodes/images): images/audio/video, transcription hooks, size caps, temp file lifecycle. Audio details: [Audio](https://docs.edwinpai.com/nodes/audio).

### Channels

- [Channels](https://docs.edwinpai.com/channels): [WhatsApp](https://docs.edwinpai.com/channels/whatsapp) (Baileys), [Telegram](https://docs.edwinpai.com/channels/telegram) (grammY), [Slack](https://docs.edwinpai.com/channels/slack) (Bolt), [Discord](https://docs.edwinpai.com/channels/discord) (discord.js), [Google Chat](https://docs.edwinpai.com/channels/googlechat) (Chat API), [Signal](https://docs.edwinpai.com/channels/signal) (signal-cli), [BlueBubbles](https://docs.edwinpai.com/channels/bluebubbles) (iMessage, recommended), [iMessage](https://docs.edwinpai.com/channels/imessage) (legacy imsg), [Microsoft Teams](https://docs.edwinpai.com/channels/msteams) (extension), [Matrix](https://docs.edwinpai.com/channels/matrix) (extension), [Zalo](https://docs.edwinpai.com/channels/zalo) (extension), [Zalo Personal](https://docs.edwinpai.com/channels/zalouser) (extension), [WebChat](https://docs.edwinpai.com/web/webchat).
- [Group routing](https://docs.edwinpai.com/concepts/group-messages): mention gating, reply tags, per-channel chunking and routing. Channel rules: [Channels](https://docs.edwinpai.com/channels).

### Apps + nodes

Companion clients are maintained outside this core repo:

- **Desktop app:** `edwin-desktop`
- **iOS node app:** `edwin-ios`
- **Android node app:** `edwin-android`

Runtime capabilities (Canvas, camera/screen, Voice Wake/Talk Mode, node.invoke actions) remain part of the Edwin Gateway protocol and tooling.

### Tools + automation

- [Browser control](https://docs.edwinpai.com/tools/browser): dedicated edwin Chrome/Chromium, snapshots, actions, uploads, profiles.
- [Canvas](https://docs.edwinpai.com/tools/canvas): [A2UI](https://docs.edwinpai.com/tools/canvas) push/reset, eval, snapshot.
- [Nodes](https://docs.edwinpai.com/nodes): camera snap/clip, screen record, [location.get](https://docs.edwinpai.com/nodes/location-command), notifications.
- [Cron + wakeups](https://docs.edwinpai.com/automation/cron-jobs); [webhooks](https://docs.edwinpai.com/automation/webhook); [Gmail Pub/Sub](https://docs.edwinpai.com/automation/gmail-pubsub).
- [Skills platform](https://docs.edwinpai.com/tools/skills): bundled, managed, and workspace skills with install gating + UI.

### Runtime + safety

- [Channel routing](https://docs.edwinpai.com/concepts/channel-routing), [retry policy](https://docs.edwinpai.com/concepts/retry), and [streaming/chunking](https://docs.edwinpai.com/concepts/streaming).
- [Presence](https://docs.edwinpai.com/concepts/presence), [typing indicators](https://docs.edwinpai.com/concepts/typing-indicators), and [usage tracking](https://docs.edwinpai.com/concepts/usage-tracking).
- [Models](https://docs.edwinpai.com/concepts/models), [model failover](https://docs.edwinpai.com/concepts/model-failover), and [session pruning](https://docs.edwinpai.com/concepts/session-pruning).
- [Security](https://docs.edwinpai.com/gateway/security) and [troubleshooting](https://docs.edwinpai.com/channels/troubleshooting).

### Ops + packaging

- [Control UI](https://docs.edwinpai.com/web) + [WebChat](https://docs.edwinpai.com/web/webchat) served directly from the Gateway.
- [Tailscale Serve/Funnel](https://docs.edwinpai.com/gateway/tailscale) or [SSH tunnels](https://docs.edwinpai.com/gateway/remote) with token/password auth.
- [Nix mode](https://docs.edwinpai.com/install/nix) for declarative config; [Docker](https://docs.edwinpai.com/install/docker)-based installs.
- [Doctor](https://docs.edwinpai.com/gateway/doctor) migrations, [logging](https://docs.edwinpai.com/logging).

## How it works (short)

```
WhatsApp / Telegram / Slack / Discord / Google Chat / Signal / iMessage / BlueBubbles / Microsoft Teams / Matrix / Zalo / Zalo Personal / WebChat
               │
               ▼
┌───────────────────────────────┐
│            Gateway            │
│       (control plane)         │
│     ws://127.0.0.1:18789      │
└──────────────┬────────────────┘
               │
               ├─ Pi agent (RPC)
               ├─ CLI (edwin …)
               ├─ WebChat UI
               ├─ Desktop client(s)
               └─ Mobile node client(s)
```

## Key subsystems

- **[Gateway WebSocket network](https://docs.edwinpai.com/concepts/architecture)** — single WS control plane for clients, tools, and events (plus ops: [Gateway runbook](https://docs.edwinpai.com/gateway)).
- **[Tailscale exposure](https://docs.edwinpai.com/gateway/tailscale)** — Serve/Funnel for the Gateway dashboard + WS (remote access: [Remote](https://docs.edwinpai.com/gateway/remote)).
- **[Browser control](https://docs.edwinpai.com/tools/browser)** — edwin‑managed Chrome/Chromium with CDP control.
- **[Canvas + A2UI](https://docs.edwinpai.com/tools/canvas)** — agent‑driven visual workspace (A2UI host: [Canvas/A2UI](https://docs.edwinpai.com/tools/canvas)).
- **[Voice Wake](https://docs.edwinpai.com/nodes/voicewake) + [Talk Mode](https://docs.edwinpai.com/nodes/talk)** — always‑on speech and continuous conversation.
- **[Nodes](https://docs.edwinpai.com/nodes)** — Canvas, camera snap/clip, screen record, `location.get`, notifications, plus macOS‑only `system.run`/`system.notify`.

## Tailscale access (Gateway dashboard)

EdwinPAI can auto-configure Tailscale **Serve** (tailnet-only) or **Funnel** (public) while the Gateway stays bound to loopback. Configure `gateway.tailscale.mode`:

- `off`: no Tailscale automation (default).
- `serve`: tailnet-only HTTPS via `tailscale serve` (uses Tailscale identity headers by default).
- `funnel`: public HTTPS via `tailscale funnel` (requires shared password auth).

Notes:

- `gateway.bind` must stay `loopback` when Serve/Funnel is enabled (EdwinPAI enforces this).
- Serve can be forced to require a password by setting `gateway.auth.mode: "password"` or `gateway.auth.allowTailscale: false`.
- Funnel refuses to start unless `gateway.auth.mode: "password"` is set.
- Optional: `gateway.tailscale.resetOnExit` to undo Serve/Funnel on shutdown.

Details: [Tailscale guide](https://docs.edwinpai.com/gateway/tailscale) · [Web surfaces](https://docs.edwinpai.com/web)

## Remote Gateway (Linux is great)

It's perfectly fine to run the Gateway on a small Linux instance. Clients (desktop app, CLI, WebChat) can connect over **Tailscale Serve/Funnel** or **SSH tunnels**, and you can still pair device nodes (macOS/iOS/Android) to execute device‑local actions when needed.

- **Gateway host** runs the exec tool and channel connections by default.
- **Device nodes** run device‑local actions (`system.run`, camera, screen recording, notifications) via `node.invoke`.
  In short: exec runs where the Gateway lives; device actions run where the device lives.

Details: [Remote access](https://docs.edwinpai.com/gateway/remote) · [Nodes](https://docs.edwinpai.com/nodes) · [Security](https://docs.edwinpai.com/gateway/security)

## macOS permissions via the Gateway protocol

The macOS node client can run in **node mode** and advertises its capabilities + permission map over the Gateway WebSocket (`node.list` / `node.describe`). Clients can then execute local actions via `node.invoke`:

- `system.run` runs a local command and returns stdout/stderr/exit code; set `needsScreenRecording: true` to require screen-recording permission (otherwise you'll get `PERMISSION_MISSING`).
- `system.notify` posts a user notification and fails if notifications are denied.
- `canvas.*`, `camera.*`, `screen.record`, and `location.get` are also routed via `node.invoke` and follow TCC permission status.

Elevated bash (host permissions) is separate from macOS TCC:

- Use `/elevated on|off` to toggle per‑session elevated access when enabled + allowlisted.
- Gateway persists the per‑session toggle via `sessions.patch` (WS method) alongside `thinkingLevel`, `verboseLevel`, `model`, `sendPolicy`, and `groupActivation`.

Details: [Nodes](https://docs.edwinpai.com/nodes) · [Gateway protocol](https://docs.edwinpai.com/concepts/architecture)

## Agent to Agent (sessions\_\* tools)

- Use these to coordinate work across sessions without jumping between chat surfaces.
- `sessions_list` — discover active sessions (agents) and their metadata.
- `sessions_history` — fetch transcript logs for a session.
- `sessions_send` — message another session; optional reply‑back ping‑pong + announce step (`REPLY_SKIP`, `ANNOUNCE_SKIP`).

Details: [Session tools](https://docs.edwinpai.com/concepts/session-tool)

## Chat commands

Send these in WhatsApp/Telegram/Slack/Google Chat/Microsoft Teams/WebChat (group commands are owner-only):

- `/status` — compact session status (model + tokens, cost when available)
- `/new` or `/reset` — reset the session
- `/compact` — compact session context (summary)
- `/think <level>` — off|minimal|low|medium|high|xhigh (GPT-5.2 + Codex models only)
- `/verbose on|off`
- `/usage off|tokens|full` — per-response usage footer
- `/restart` — restart the gateway (owner-only in groups)
- `/activation mention|always` — group activation toggle (groups only)

## Apps (optional)

The Gateway alone delivers a great experience. All apps are optional and add extra features.

If you plan to build/run companion apps, use the dedicated companion repos and platform runbooks:

- Desktop: [edwin-desktop](https://github.com/jonesj38/edwin-desktop)
- iOS node: `edwin-ios` · [iOS connect](https://docs.edwinpai.com/platforms/ios)
- Android node: `edwin-android` · [Android connect](https://docs.edwinpai.com/platforms/android)

All node capabilities remain controlled via the Gateway (`edwin nodes …`).

## Agent workspace + skills

- Workspace root: `~/.edwinpai/workspace` (configurable via `agents.defaults.workspace`).
- Injected prompt files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`.
- Skills: `~/.edwinpai/workspace/skills/<skill>/SKILL.md`.

## Configuration

Minimal `~/.edwinpai/edwinpai.json` (model + defaults):

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-6",
  },
}
```

[Full configuration reference (all keys + examples).](https://docs.edwinpai.com/gateway/configuration)

## Security model (important)

EdwinPAI's cryptographic security is built on the BRC-92/107/108/115 token standards (see [Security & Data Sovereignty](#security--data-sovereignty) above). At the runtime level:

- **Default:** tools run on the host for the **main** session, so the agent has full access when it's just you.
- **Group/channel safety:** set `agents.defaults.sandbox.mode: "non-main"` to run **non‑main sessions** (groups/channels) inside per‑session Docker sandboxes; bash then runs in Docker for those sessions.
- **Sandbox defaults:** allowlist `bash`, `process`, `read`, `write`, `edit`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`; denylist `browser`, `canvas`, `nodes`, `cron`, `discord`, `gateway`.
- **Signed envelopes:** all client–server communication uses cryptographically signed envelopes (`src/infra/signed-envelope.ts`) verified against desktop identity certificates (`src/infra/desktop-identity.ts`).

Details: [Security guide](https://docs.edwinpai.com/gateway/security) · [Docker + sandboxing](https://docs.edwinpai.com/install/docker) · [Sandbox config](https://docs.edwinpai.com/gateway/configuration)

### [WhatsApp](https://docs.edwinpai.com/channels/whatsapp)

- Link the device: `pnpm edwin channels login` (stores creds in `~/.edwinpai/credentials`).
- Allowlist who can talk to the assistant via `channels.whatsapp.allowFrom`.
- If `channels.whatsapp.groups` is set, it becomes a group allowlist; include `"*"` to allow all.

### [Telegram](https://docs.edwinpai.com/channels/telegram)

- Set `TELEGRAM_BOT_TOKEN` or `channels.telegram.botToken` (env wins).
- Optional: set `channels.telegram.groups` (with `channels.telegram.groups."*".requireMention`); when set, it is a group allowlist (include `"*"` to allow all). Also `channels.telegram.allowFrom` or `channels.telegram.webhookUrl` + `channels.telegram.webhookSecret` as needed.

```json5
{
  channels: {
    telegram: {
      botToken: "123456:ABCDEF",
    },
  },
}
```

### [Slack](https://docs.edwinpai.com/channels/slack)

- Set `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (or `channels.slack.botToken` + `channels.slack.appToken`).

### [Discord](https://docs.edwinpai.com/channels/discord)

- Set `DISCORD_BOT_TOKEN` or `channels.discord.token` (env wins).
- Optional: set `commands.native`, `commands.text`, or `commands.useAccessGroups`, plus `channels.discord.dm.allowFrom`, `channels.discord.guilds`, or `channels.discord.mediaMaxMb` as needed.

```json5
{
  channels: {
    discord: {
      token: "1234abcd",
    },
  },
}
```

### [Signal](https://docs.edwinpai.com/channels/signal)

- Requires `signal-cli` and a `channels.signal` config section.

### [BlueBubbles (iMessage)](https://docs.edwinpai.com/channels/bluebubbles)

- **Recommended** iMessage integration.
- Configure `channels.bluebubbles.serverUrl` + `channels.bluebubbles.password` and a webhook (`channels.bluebubbles.webhookPath`).
- The BlueBubbles server runs on macOS; the Gateway can run on macOS or elsewhere.

### [iMessage (legacy)](https://docs.edwinpai.com/channels/imessage)

- Legacy macOS-only integration via `imsg` (Messages must be signed in).
- If `channels.imessage.groups` is set, it becomes a group allowlist; include `"*"` to allow all.

### [Microsoft Teams](https://docs.edwinpai.com/channels/msteams)

- Configure a Teams app + Bot Framework, then add a `msteams` config section.
- Allowlist who can talk via `msteams.allowFrom`; group access via `msteams.groupAllowFrom` or `msteams.groupPolicy: "open"`.

### [WebChat](https://docs.edwinpai.com/web/webchat)

- Uses the Gateway WebSocket; no separate WebChat port/config.

Browser control (optional):

```json5
{
  browser: {
    enabled: true,
    color: "#FF4500",
  },
}
```

## Docs

Use these when you're past the onboarding flow and want the deeper reference.

- [Start with the docs index for navigation and "what's where."](https://docs.edwinpai.com)
- [Read the architecture overview for the gateway + protocol model.](https://docs.edwinpai.com/concepts/architecture)
- [Use the full configuration reference when you need every key and example.](https://docs.edwinpai.com/gateway/configuration)
- [Run the Gateway by the book with the operational runbook.](https://docs.edwinpai.com/gateway)
- [Learn how the Control UI/Web surfaces work and how to expose them safely.](https://docs.edwinpai.com/web)
- [Understand remote access over SSH tunnels or tailnets.](https://docs.edwinpai.com/gateway/remote)
- [Follow the onboarding wizard flow for a guided setup.](https://docs.edwinpai.com/start/wizard)
- [Wire external triggers via the webhook surface.](https://docs.edwinpai.com/automation/webhook)
- [Set up Gmail Pub/Sub triggers.](https://docs.edwinpai.com/automation/gmail-pubsub)
- [Platform guides: Windows (WSL2)](https://docs.edwinpai.com/platforms/windows), [Linux](https://docs.edwinpai.com/platforms/linux), [iOS](https://docs.edwinpai.com/platforms/ios), [Android](https://docs.edwinpai.com/platforms/android)
- [Debug common failures with the troubleshooting guide.](https://docs.edwinpai.com/channels/troubleshooting)
- [Review security guidance before exposing anything.](https://docs.edwinpai.com/gateway/security)

## Advanced docs (discovery + control)

- [Discovery + transports](https://docs.edwinpai.com/gateway/discovery)
- [Bonjour/mDNS](https://docs.edwinpai.com/gateway/bonjour)
- [Gateway pairing](https://docs.edwinpai.com/gateway/pairing)
- [Remote gateway README](https://docs.edwinpai.com/gateway/remote-gateway-readme)
- [Control UI](https://docs.edwinpai.com/web/control-ui)
- [Dashboard](https://docs.edwinpai.com/web/dashboard)

## Operations & troubleshooting

- [Health checks](https://docs.edwinpai.com/gateway/health)
- [Gateway lock](https://docs.edwinpai.com/gateway/gateway-lock)
- [Background process](https://docs.edwinpai.com/gateway/background-process)
- [Browser troubleshooting (Linux)](https://docs.edwinpai.com/tools/browser-linux-troubleshooting)
- [Logging](https://docs.edwinpai.com/logging)

## Deep dives

- [Agent loop](https://docs.edwinpai.com/concepts/agent-loop)
- [Presence](https://docs.edwinpai.com/concepts/presence)
- [TypeBox schemas](https://docs.edwinpai.com/concepts/typebox)
- [RPC adapters](https://docs.edwinpai.com/reference/rpc)
- [Queue](https://docs.edwinpai.com/concepts/queue)

## Workspace & skills

- [Skills config](https://docs.edwinpai.com/tools/skills-config)
- [Default AGENTS](https://docs.edwinpai.com/reference/AGENTS.default)
- [Templates: AGENTS](https://docs.edwinpai.com/reference/templates/AGENTS)
- [Templates: BOOTSTRAP](https://docs.edwinpai.com/reference/templates/BOOTSTRAP)
- [Templates: IDENTITY](https://docs.edwinpai.com/reference/templates/IDENTITY)
- [Templates: SOUL](https://docs.edwinpai.com/reference/templates/SOUL)
- [Templates: TOOLS](https://docs.edwinpai.com/reference/templates/TOOLS)
- [Templates: USER](https://docs.edwinpai.com/reference/templates/USER)

## Platform internals

- [iOS node](https://docs.edwinpai.com/platforms/ios)
- [Android node](https://docs.edwinpai.com/platforms/android)
- [Windows (WSL2)](https://docs.edwinpai.com/platforms/windows)
- [Linux app](https://docs.edwinpai.com/platforms/linux)

## Email hooks (Gmail)

- [docs.edwinpai.com/gmail-pubsub](https://docs.edwinpai.com/automation/gmail-pubsub)

## Community

EdwinPAI is maintained by [Jake Jones](https://github.com/jonesj38) / [OnChain Innovation](https://onchaininnovation.com).

- [edwinpai.com](https://edwinpai.com)
- [Discord](https://discord.gg/clawd)
- [GitHub](https://github.com/jonesj38/edwin)
