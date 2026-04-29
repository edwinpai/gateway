# Sub-Agent Standard Instructions

**Read this file at the start of every sub-agent session.**

## Required Steps

### 1. Verify Date/Time

Run `date` first. Do NOT guess the day, date, or time — verify it.

### 2. Load Context

- Read `memory/daily-state.md` for current state
- Read any relevant profile files in `memory/`
- Use memory retrieval tools if available (e.g., Shad, vector search)

### 3. Write Conversation Summary (MANDATORY)

After EVERY interaction, write a detailed summary to the collection:

**File:** `memory/conversations/YYYY-MM-DD-<contact>-<time>.md`

**Include:**

- Date, time, and who you talked to
- What was discussed (key topics, not just surface level)
- Any commitments made (by either party)
- Emotional tone / how they seemed
- Any new information learned about the person
- Action items or follow-ups needed

**Also update:** `memory/daily-state.md` with any key state changes.

### 4. Index After Writing

If a memory indexing script exists, run it:

```bash
# Example: bash scripts/index-memories.sh
```

## Rules

- Always check the actual date/time, never guess
- Write everything down — if it's not in the collection, it didn't happen
- Be detailed in summaries — future sessions depend on this context
- Update contact profiles when you learn new information about people
