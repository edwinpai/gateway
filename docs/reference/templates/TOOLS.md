---
summary: "Workspace template for TOOLS.md"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

---

## Shad - Memory Retrieval Sidecar

**When to use:** Semantic search across the collection — finding past work, decisions, context when you don't know which file it's in.

**Why:** Keeps your session context lean. Shad does retrieval + synthesis in isolated calls, only the answer comes back.

```bash
# Fast recall (6-12s) - use for most memory lookups
~/.shad/bin/shad run "query" --collection ~/workspace --no-code-mode -O sonnet

# Quick search (raw results, no synthesis)
~/.shad/bin/shad search "query" --collection ~/workspace

# Full research (minutes) - complex synthesis tasks
~/.shad/bin/shad run "task" --collection ~/workspace -O opus -W sonnet -L sonnet

# BM25 search (fast, no embeddings needed) - use when vector search fails
qmd search "query" --collection workspace --limit 10
```

**When NOT to use Shad:**

- Current conversation context (you already have it)
- Simple file reads (just use `read` tool)
- Tasks needing your full toolkit (browser, messages, cron)

---

## Direct File Access (Preferred for Known Files)

**Use direct `read` when you know which file you need:**

| Task            | Approach                         |
| --------------- | -------------------------------- |
| Today's notes   | `read memory/YYYY-MM-DD.md`      |
| Your identity   | `read memory/identity-full.md`   |
| User's profile  | `read memory/user-profile.md`    |
| Workspace rules | `read memory/workspace-guide.md` |
| Specific topic  | `read memory/<topic>.md`         |

**Use Shad when:**

- You don't know which file has the info
- Searching across many files
- Need semantic matching (not just keywords)

---

## Memory Storage Workflow

**After writing new memories** (to `memory/*.md`), index them:

```bash
qmd update --collection workspace
```

This indexes new/changed files so Shad (and BM25 search) can find them immediately.

**Memory file conventions:**

- `memory/YYYY-MM-DD.md` — daily notes
- `memory/identity-full.md` — who you are (rich detail)
- `memory/workspace-guide.md` — operating rules
- `memory/<topic>.md` — structured topic files as needed

---

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Collection paths and QMD collection names
- Anything environment-specific

---

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
