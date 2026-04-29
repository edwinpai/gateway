# Shad Protocol — Standing Operating Procedure

**Type:** Standing protocol (always active, not task-triggered)
**Applies to:** All Edwin instances (VPS, Desktop, Macbook)
**Purpose:** Maximize use of Shad's RLM capabilities for research, analysis, and memory retrieval. Minimize unnecessary sub-agent spawns.

---

## Why Shad Matters

Shad (Shannon's Daemon) is Edwin's retrieval-augmented reasoning engine. It enables virtually unlimited context by treating collections as explorable environments — recursively decomposing tasks, retrieving targeted context, synthesizing across files, and producing coherent analysis.

### Without Shad

- Context window is your only memory → compaction loses information
- Sub-agents start cold with no cross-cutting knowledge
- Complex multi-file tasks require holding everything in context (impossible at scale)
- Long-running tasks degrade as context fills up
- Each session is an island — no shared analytical capability

### With Shad

- **Unlimited effective context** — Shad searches gigabytes of collection content, retrieves only what's relevant
- **Cross-file synthesis** — Opus-powered reasoning across dozens of files simultaneously
- **Persistent knowledge** — Collection content survives session restarts, compactions, and context resets
- **Cheaper operations** — A Shad recall costs a fraction of keeping everything in a 200K Opus context window
- **Continuity** — Any Edwin instance can recall what any other instance worked on, if it's in the collection

### The Competitive Edge

Edwin + Shad outperforms single-context agents (including Codex) on complex multi-domain tasks because:

1. We don't degrade as task complexity grows (Shad retrieves what's needed per subtask)
2. We can reason across an entire codebase without loading it all into context
3. We maintain cross-session continuity that pure sandbox agents can't match
4. Research and planning happen with full collection knowledge, not just what fits in context

---

## When to Use What

### Decision Tree

```
Is this a RESEARCH, ANALYSIS, or MEMORY task?
  │
  ├─ YES: Do you know exactly which file(s) to read?
  │   ├─ YES → Direct file read (fastest)
  │   └─ NO: Is it a keyword/pattern search?
  │       ├─ YES → qmd search (BM25, fast)
  │       └─ NO: Does it need multi-file synthesis or reasoning?
  │           ├─ YES → Shad RLM (shad run with Opus)
  │           └─ NO → Shad recall (shad recall, lighter weight)
  │
  └─ NO: Is this an EXECUTION task (build, deploy, modify, test)?
      ├─ YES: Does it need its own tool access (exec, browser, files)?
      │   ├─ YES → Sub-agent
      │   └─ NO → Do it yourself
      └─ NO → Just respond (no tool needed)
```

### Quick Reference

| Situation                                                 | Tool                                              | Command                                                                        |
| --------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| "What did we discuss about X?"                            | **Shad recall**                                   | `~/.shad/bin/shad recall "query" --collection ~/clawd -m sonnet`               |
| "Find all references to BSV auth"                         | **qmd search**                                    | `qmd search "BSV auth" --collection workspace`                                 |
| "Read today's task list"                                  | **Direct read**                                   | `cat memory/tasks/today.md`                                                    |
| "Analyze this codebase for security issues"               | **Shad RLM**                                      | `~/.shad/bin/shad run "task" --collection ~/edwin -O opus -W sonnet -L sonnet` |
| "Trace how messages flow from WhatsApp to tool execution" | **Shad RLM**                                      | `~/.shad/bin/shad run "task" --collection ~/edwin -O opus -W sonnet -L sonnet` |
| "Summarize everything about this contact"                 | **Shad recall**                                   | `~/.shad/bin/shad recall "contact name" --collection ~/clawd -m sonnet`        |
| "Build this feature and test it"                          | **Sub-agent**                                     | `sessions_spawn(task=...)`                                                     |
| "Deploy this change"                                      | **Sub-agent or self**                             | Depends on tool access needed                                                  |
| "Compare our approach with competitor X"                  | **Shad RLM** (our data) + **web_search** (theirs) | Combined                                                                       |

### The Key Principle

> **Shad for THINKING. Sub-agents for DOING.**

If the task is understanding, analyzing, researching, planning, or recalling — use Shad.
If the task is building, deploying, modifying, or executing — use a sub-agent.
If the task needs BOTH — use Shad for research/planning first, THEN sub-agents for execution.

---

## How to Use Shad

### Mode 1: Quick Recall (6-12 seconds)

For memory lookups, context retrieval, "what do we know about X?"

```bash
~/.shad/bin/shad recall "query" --collection ~/clawd -m sonnet
```

- Fast, lightweight
- Good for: memory retrieval, contact info, prior decisions, recent work
- Returns: synthesized answer with citations

### Mode 2: Research Task (30-120 seconds)

For deep analysis, multi-file reasoning, code auditing, architectural review.

```bash
~/.shad/bin/shad run "detailed task description" --collection ~/edwin -O opus -W sonnet -L sonnet
```

- **-O opus**: Opus orchestrator — deep reasoning, security analysis, architectural thinking
- **-W sonnet**: Sonnet workers — file reading, code parsing, data extraction
- **-L sonnet**: Sonnet librarian — index lookup, retrieval optimization
- Good for: code review, security audit, architecture analysis, complex synthesis
- Returns: structured analysis with file references

### Mode 3: Standard Run (30-60 seconds)

For moderate tasks with Sonnet throughout (faster, cheaper).

```bash
~/.shad/bin/shad run "task" --collection ~/clawd -O sonnet
```

- Good for: summarization, comparison, moderate analysis
- Faster than Opus mode, still gets synthesis

### Mode 4: No-Code Mode (fastest recall)

For simple retrieval without code execution in Shad's sandbox.

```bash
~/.shad/bin/shad run "query" --collection ~/clawd --no-code-mode -O sonnet
```

- Skips Shad's code executor — pure retrieval + synthesis
- Good for: memory lookups when `recall` isn't giving enough depth

### Multi-Collection Queries

When you need to search across multiple knowledge bases:

```bash
~/.shad/bin/shad run "task" --collection ~/clawd --collection ~/edwin -O opus -W sonnet -L sonnet
```

Earlier collections have higher priority in search ranking.

### Collection Reference

| Collection        | Path                                             | Contents                                            |
| ----------------- | ------------------------------------------------ | --------------------------------------------------- |
| clawd (workspace) | `~/clawd`                                        | Memory, tasks, contacts, daily notes, cover letters |
| edwin (gateway)   | `~/edwin`                                        | Edwin Gateway source code (~475K LOC)               |
| edwin-desktop     | `~/Desktop/edwin-desktop` (Macbook/Desktop only) | Edwin Desktop source                                |

### qmd Collections Reference

| Collection    | Contents                              | Search Command                        |
| ------------- | ------------------------------------- | ------------------------------------- |
| workspace     | Memory, docs, sessions, cover letters | `qmd search "query" -c workspace`     |
| edwin-gateway | Gateway source (if indexed)           | `qmd search "query" -c edwin-gateway` |
| edwin-desktop | Desktop source (if indexed)           | `qmd search "query" -c edwin-desktop` |

---

## Mandatory Protocol

### Rule 1: Pre-Task Context Check

Before starting any complex task (more than a simple lookup or reply), check for prior work:

```bash
# First: Do we already know about this?
qmd search "topic keywords" --collection workspace --limit 5

# If needed: Deeper semantic recall
~/.shad/bin/shad recall "what do we know about [topic]" --collection ~/clawd -m sonnet
```

**Why:** Prevents duplicate work, ensures continuity, catches decisions already made.

### Rule 2: Research Before Execution

Before spawning a sub-agent for a complex task, use Shad for the research/planning phase:

```bash
# Research phase (Shad)
~/.shad/bin/shad run "Analyze [topic] and identify the key issues/approaches" --collection ~/clawd -O opus

# Then execution phase (sub-agent, armed with Shad's findings)
sessions_spawn(task="Based on this analysis: [Shad results]... implement [specific thing]")
```

**Why:** Sub-agents with good context from Shad outperform sub-agents that start cold.

### Rule 3: Index After Writing

After writing any new memory files or significant content:

```bash
qmd update --collection workspace
```

**Why:** Makes new content immediately searchable by Shad and qmd.

### Rule 4: Shad Over Sub-Agents for Analysis

If the task is purely analytical (no tool execution needed), use Shad instead of spawning a sub-agent:

| ❌ Anti-pattern                                          | ✅ Correct                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `sessions_spawn(task="analyze this codebase for...")`    | `shad run "analyze this codebase for..." --collection ~/edwin -O opus` |
| `sessions_spawn(task="summarize what we know about...")` | `shad recall "what we know about..." --collection ~/clawd -m sonnet`   |
| `sessions_spawn(task="compare approach A vs B")`         | `shad run "compare approach A vs B" --collection ~/clawd -O opus`      |

**Exception:** If the analysis requires tool access (browser, exec, etc.), a sub-agent is appropriate.

### Rule 5: Timeout Handling

If Shad times out or fails:

1. **Retry once** with a simpler model: `-O sonnet` instead of `-O opus`
2. **If still failing**, fall back to `qmd search` (BM25) + direct file reads
3. **Log the failure** in daily notes so we can diagnose later
4. **Do NOT** silently ignore the failure and proceed without the context

---

## Enforcement

### Self-Check (Every Complex Task)

Before any task involving research, analysis, or memory:

- [ ] Did I check qmd/Shad for prior work on this topic?
- [ ] Am I using Shad for research and sub-agents only for execution?
- [ ] After writing new content, did I run `qmd update`?

### Heartbeat Audit

During heartbeat processing, log:

- Number of Shad calls this session
- Number of sub-agent spawns this session
- If spawns > Shad calls for research tasks, flag it

### Anti-Pattern Alerts

If you catch yourself doing any of these, stop and reconsider:

- Spawning a sub-agent to "research" or "analyze" something (use Shad)
- Reading more than 5 files manually to understand something (use Shad to synthesize)
- Starting a complex task without checking for prior work (check qmd/Shad first)
- Keeping stale context in the window instead of retrieving fresh from disk/Shad

---

## Troubleshooting

### Shad Timeouts

- **Cause:** Heavy queries with Opus, large collection scans
- **Fix:** Use sonnet instead of opus, narrow the collection path, use `--no-code-mode`
- **Fallback:** `qmd search` for BM25, direct file reads for known paths

### Empty/Poor Results

- **Cause:** Missing embeddings, stale index
- **Fix:** Run `qmd update && qmd embed` to refresh
- **Check:** `qmd status` shows pending embeddings count

### Shad Process Killed

- **Cause:** Memory pressure, long-running query
- **Fix:** Retry with simpler task decomposition, or use qmd search as fallback

---

## Maintenance

### Keep the Index Fresh

```bash
# After any memory/doc writes
qmd update --collection workspace

# Periodic full re-embed (weekly or when gaps detected)
qmd embed -f
```

### Monitor Health

```bash
# Check index status
qmd status

# Verify Shad is responsive
~/.shad/bin/shad recall "test query" --collection ~/clawd -m sonnet
```
