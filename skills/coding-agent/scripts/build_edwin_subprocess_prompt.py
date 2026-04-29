#!/usr/bin/env python3
"""Build a retrieval-first bootstrap prompt for Edwin-orchestrated Codex subprocesses."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

DEFAULT_COLLECTION = "memory-dir"
DEFAULT_LIMIT = 6
DEFAULT_SECTION_CHAR_LIMIT = 12000
DEFAULT_FILE_CHAR_LIMIT = 8000
DEFAULT_INSTRUCTIONS_CHAR_LIMIT = 5000
DEFAULT_TASKS_CHAR_LIMIT = 7000


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive
        return f"[unreadable: {path} :: {exc}]"


def truncate(text: str, *, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 60)].rstrip() + "\n\n[truncated]"


def extract_open_tasks(markdown: str, *, item_limit: int = 12) -> str:
    current_heading = "General"
    out: list[str] = []
    last_heading: str | None = None
    count = 0
    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if stripped.startswith("#"):
            current_heading = stripped
            continue
        if stripped.startswith("- [ ]"):
            if current_heading != last_heading:
                if out:
                    out.append("")
                out.append(current_heading)
                last_heading = current_heading
            out.append(stripped)
            count += 1
            if count >= item_limit:
                break
    if not out:
        return "No unchecked tasks found in memory/tasks/today.md."
    return "\n".join(out)


def resolve_read_path(raw: str, *, cwd: Path) -> Path:
    path = Path(raw).expanduser()
    if path.is_absolute():
        return path
    return (cwd / path).resolve()


def resolve_edwin_cli() -> str:
    for candidate in ("edwinpai", "edwin"):
        if shutil.which(candidate):
            return candidate
    return "edwinpai"


def run_capture(cmd: list[str], *, timeout_seconds: int = 4) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout_seconds}s"


def query_memory(task: str, *, collection: str, limit: int) -> tuple[str, str]:
    qmd = shutil.which("qmd")
    if qmd:
        code, out, err = run_capture(
            [
                qmd,
                "search",
                task,
                "--collection",
                collection,
                "--limit",
                str(limit),
                "--format",
                "markdown",
            ],
            timeout_seconds=4,
        )
        if code == 0 and out:
            return out, "qmd search"
        if err:
            qmd_error = err
        else:
            qmd_error = f"exit {code}"
    else:
        qmd_error = "qmd not found"

    edwinpai = shutil.which("edwinpai")
    if edwinpai:
        code, out, err = run_capture(
            [
                edwinpai,
                "memory",
                "search",
                task,
                "--limit",
                str(limit),
                "--format",
                "markdown",
            ],
            timeout_seconds=6,
        )
        if code == 0 and out:
            return out, "edwinpai memory search"
        if err:
            return f"No memory context found ({qmd_error}; edwinpai memory search: {err}).", "none"
        return (
            f"No memory context found ({qmd_error}; edwinpai memory search exit {code}).",
            "none",
        )

    return f"No memory context found ({qmd_error}; edwinpai not found).", "none"


def render_file_sections(paths: Iterable[Path], *, char_limit: int) -> str:
    sections: list[str] = []
    for path in paths:
        body = truncate(read_text(path), limit=char_limit)
        sections.append(f"### {path}\n```text\n{body}\n```")
    if not sections:
        return "No explicit handoff files were provided."
    return "\n\n".join(sections)


def build_prompt(args: argparse.Namespace) -> str:
    edwinpai_home = Path(args.edwinpai_home).expanduser()
    workspace = edwinpai_home / "workspace"
    memory_dir = workspace / "memory"
    instructions_path = memory_dir / "subagent-instructions.md"
    tasks_path = memory_dir / "tasks" / "today.md"
    cwd = Path.cwd()
    explicit_files = [resolve_read_path(raw, cwd=cwd) for raw in args.read]

    memory_context, memory_source = query_memory(
        args.query or args.task,
        collection=args.collection,
        limit=args.limit,
    )

    instructions = truncate(read_text(instructions_path), limit=args.instructions_char_limit)
    open_tasks = truncate(
        extract_open_tasks(read_text(tasks_path), item_limit=args.task_item_limit),
        limit=args.tasks_char_limit,
    )
    explicit_sections = render_file_sections(explicit_files, char_limit=args.file_char_limit)
    memory_context = truncate(memory_context, limit=args.section_char_limit)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Edwin Codex Bootstrap",
        "",
        "You are an external Codex subprocess orchestrated by Edwin.",
        "You are NOT a native Edwin `sessions_spawn` subagent, so the bootstrap context you need is injected below.",
        "Treat this as your starting context; if something is missing, inspect the repo/filesystem directly and say what was missing.",
        "",
        "## Assigned task",
        args.task.strip(),
        "",
        "## Working rules",
        "- Stay tightly scoped to the assigned task.",
        "- Prefer direct evidence from files, commands, tests, and diffs.",
        "- Distinguish facts from inferences.",
        "- Do not assume the parent agent's live context beyond what is injected here.",
        "- Return your final answer as a structured synthesis artifact with these sections in order:",
        "  - task",
        "  - scope / files examined",
        "  - actions taken",
        "  - findings",
        "  - conclusions",
        "  - confidence",
        "  - open questions / uncertainties",
        "",
        "## Runtime context",
        f"- Generated: {timestamp}",
        f"- Current workdir: {cwd}",
        f"- Edwin workspace: {workspace}",
        f"- Memory retrieval source: {memory_source}",
        "",
        "## Edwin subagent instructions (injected excerpt)",
        "```text",
        instructions,
        "```",
        "",
        "## Open tasks snapshot from memory/tasks/today.md",
        "```text",
        open_tasks,
        "```",
        "",
        "## Retrieved memory context",
        f"<!-- source: {memory_source}; query: {args.query or args.task} -->",
        "```markdown",
        memory_context,
        "```",
        "",
        "## Explicit handoff files",
        explicit_sections,
    ]

    if args.extra_instruction:
        lines.extend(["", "## Extra instruction", args.extra_instruction.strip()])

    if args.wake_text:
        edwin_cli = resolve_edwin_cli()
        lines.extend(
            [
                "",
                "## Completion hook",
                "When completely finished, run this command exactly:",
                "```bash",
                f'{edwin_cli} gateway wake --text {args.wake_text!r} --mode now',
                "```",
            ]
        )

    return "\n".join(lines).strip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a retrieval-first bootstrap prompt for Edwin-orchestrated Codex subprocesses."
    )
    parser.add_argument("--task", required=True, help="Assigned task for the Codex subprocess.")
    parser.add_argument(
        "--query",
        help="Optional memory-retrieval query; defaults to the task text.",
    )
    parser.add_argument(
        "--read",
        action="append",
        default=[],
        help="File to inject as an explicit handoff. Can be repeated.",
    )
    parser.add_argument(
        "--collection",
        default=DEFAULT_COLLECTION,
        help=f"Memory collection for qmd search (default: {DEFAULT_COLLECTION}; use workspace only when you explicitly want broader non-memory docs).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Number of memory hits to retrieve (default: {DEFAULT_LIMIT}).",
    )
    parser.add_argument(
        "--edwinpai-home",
        default="~/.edwinpai",
        help="EdwinPAI home directory (default: ~/.edwinpai).",
    )
    parser.add_argument(
        "--section-char-limit",
        type=int,
        default=DEFAULT_SECTION_CHAR_LIMIT,
        help=f"Max chars for retrieved memory section (default: {DEFAULT_SECTION_CHAR_LIMIT}).",
    )
    parser.add_argument(
        "--file-char-limit",
        type=int,
        default=DEFAULT_FILE_CHAR_LIMIT,
        help=f"Max chars per explicit handoff file (default: {DEFAULT_FILE_CHAR_LIMIT}).",
    )
    parser.add_argument(
        "--instructions-char-limit",
        type=int,
        default=DEFAULT_INSTRUCTIONS_CHAR_LIMIT,
        help=f"Max chars for injected subagent instructions (default: {DEFAULT_INSTRUCTIONS_CHAR_LIMIT}).",
    )
    parser.add_argument(
        "--tasks-char-limit",
        type=int,
        default=DEFAULT_TASKS_CHAR_LIMIT,
        help=f"Max chars for open-task snapshot (default: {DEFAULT_TASKS_CHAR_LIMIT}).",
    )
    parser.add_argument(
        "--task-item-limit",
        type=int,
        default=12,
        help="Maximum number of unchecked task bullets to inject from today.md.",
    )
    parser.add_argument(
        "--extra-instruction",
        help="Optional extra instruction block to append to the bootstrap prompt.",
    )
    parser.add_argument(
        "--wake-text",
        help="Optional wake text; if set, completion-hook instructions are appended.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sys.stdout.write(build_prompt(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
