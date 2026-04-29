---
summary: "Workspace template for HEARTBEAT.md"
read_when:
  - Bootstrapping a workspace manually
---

# HEARTBEAT.md

## Step 1: Memory Persistence (ALWAYS FIRST)

Flush current session knowledge to disk before anything else. This is the critical path — context WILL be compacted after this step, so anything not written to disk is lost forever.

### Writing Standard (MANDATORY)

Every memory entry must be **self-contained and descriptive enough that a completely cold version of you — with zero context window history — can read it and pick up exactly where you left off.**

Bad: "User had an issue"
Good: "User (Alice, +1234567890) reported that their scheduled message to Bob didn't fire at 9 AM MST on Feb 15. Root cause: cron job used UTC instead of America/Denver. Fixed by adding tz field. Status: resolved."

**For every entry, include:**

- WHO: Full name + identifier (phone, username, etc.)
- WHAT: Exactly what happened, with enough detail to reconstruct the situation
- WHEN: Timestamp (time + timezone)
- WHY: Context/motivation — why does this matter?
- STATUS: Current state — resolved? pending? waiting on someone?
- NEXT: What needs to happen next, if anything

**For decisions, include:**

- What was decided
- Who decided it
- What alternatives were considered
- Why this option was chosen

**For conversations, include:**

- Key topics discussed
- Emotional tone / how the person seemed
- Any commitments made (by either party)
- New information learned about the person
- Exact quotes when they're important

### Daily Notes

- Write/update `memory/YYYY-MM-DD.md` with everything notable from the current session
- If multiple days have passed since last write, backfill missing days
- Each day's file should read like a complete briefing document

### Task Files

- Update `memory/tasks/today.md` — current task state (check off done items, add new ones)
- Update `memory/tasks/waiting.md` — anything blocked
- Process `memory/tasks/inbox.md` — move items to appropriate files

### People & Context

- Update contact/profile files if new info learned
- Update topic files if decisions were made or status changed
- **Per-peer privacy:** Write private conversation details to `memory/peers/<name>/`,
  NOT to shared daily notes. See AGENTS.md for full privacy rules.

### Index

- Run `qmd update --collection workspace` after all writes so search tools can find everything immediately

## Step 2: Compact Context Window

After flushing all memories to disk, **proactively compact the session context**. Do not wait for auto-compaction — trigger it yourself.

Send `/compact` with a brief summary of what was preserved to disk.

**Why:** The context window is volatile and expensive. Disk files are the true memory layer. By compacting after every flush:

- Context never approaches the limit
- Every interaction starts lean, pulling what's needed from disk
- No information is lost because it was all just written to disk in Step 1
- Token costs stay low

**The rule: if it's on disk, it doesn't need to be in context.**

## Step 3: Task System Check

- Read `memory/tasks/today.md` — any overdue items?
- Read `memory/tasks/waiting.md` — any items waiting > 3 days?
- If urgent items need attention, message the user

## Step 4: Quick Checks (rotate through)

- Inbox items to process? (`memory/tasks/inbox.md`)
- Any crons that need updating or removing?
- Any stale files that need refreshing?

## Step 5: Context Retrieval (for active work)

When responding to messages or doing tasks AFTER a compaction, always pull context first:

```bash
# Semantic recall
~/.shad/bin/shad recall "query about the topic" --collection ~/workspace -m sonnet

# BM25 search
qmd search "query" --collection workspace --limit 10

# Or direct file reads for known files
cat memory/contacts.md
cat memory/tasks/today.md
```

**Never guess from stale context. Always verify from disk.**

## Philosophy

The context window is a scratchpad, not a filing cabinet. Disk is memory. Shad is recall. Write everything down descriptively, compact aggressively, retrieve on demand. The goal: seamless continuity where the context window size is invisible — it could be 200K tokens or 20K tokens and the experience is identical because the real memory lives on disk.
