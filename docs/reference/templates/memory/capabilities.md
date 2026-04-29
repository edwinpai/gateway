# Edwin Capabilities Reference

Standing reference for what Edwin can do. Used by recall systems (e.g. shad-context) to restore operational knowledge in per-peer sessions after compaction.

---

## Communication Channels

- **WhatsApp** — per-peer isolated sessions for each contact
- **Telegram** — bot-based messaging
- **Matrix** — federated chat protocol
- **Discord** — server/channel messaging
- **Slack** — workspace messaging via Bolt SDK
- **Signal** — encrypted messaging
- **Webchat** — Edwin Desktop GUI / browser-based chat

## Tools Available

- **Web browser** (Playwright) — navigate, screenshot, snapshot, interact with web pages
- **Web search** (Brave API) — search the web, fetch/extract page content
- **Web fetch** — extract readable content from URLs as markdown
- **Shell exec** — run commands on the host server
- **File I/O** — read, write, edit files on disk
- **Cron scheduler** — create, manage, run recurring and one-shot jobs
- **Message tool** — send messages, polls, reactions across channels
- **TTS (text-to-speech)** — convert text to voice notes
- **Image analysis** — analyze images with vision models
- **Node control** — paired device management (camera, screen, location, notifications)
- **Canvas** — present interactive UI to paired nodes
- **Sub-agent spawning** — spawn isolated background sessions for async tasks
- **Session management** — list, inspect, send messages to other sessions

## Memory & Recall

- **Shad** — semantic recall sidecar for searching across collection files
- **QMD** — BM25 keyword search across indexed collections
- **Disk-based memory** — daily notes, contact profiles, task files in memory/
- **Shad-context plugin** — auto-recall before each turn, auto-capture after each turn
- **Workspace bootstrap files** — AGENTS.md, SOUL.md, TOOLS.md, etc. re-injected after compaction

## Skills

Skills provide specialized instructions for specific tasks. Available skills vary by instance. Common skills include: coding-agent, healthcheck, email (himalaya), image generation, speech-to-text (whisper), weather, video-frames, tmux, and skill-creator.

## Cron System

- Supports recurring (cron expressions, intervals) and one-shot (at) schedules
- Jobs run as isolated sub-agent sessions
- Can send messages, use browser, read/write files during execution
- Backfill logic ensures never-run jobs fire promptly after restart

## AI Models

- Multiple model providers supported (Anthropic, OpenAI, AWS Bedrock, Ollama)
- Per-session model overrides available
- Image generation and transcription via API skills

## Infrastructure

- Runs on any Linux/macOS host with Node.js
- Gateway runs as systemd service or foreground process
- Source managed via git; update.run provides safe preflight + deploy pipeline
- Extensions are workspace packages under extensions/

---

_This file is a template seeded on workspace creation. Update it with instance-specific capabilities as needed._
