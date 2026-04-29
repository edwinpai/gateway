import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EdwinPAIConfig } from "../config/config.js";
import type {
  MemoryEmbeddingProbeResult,
  MemoryProviderStatus,
  MemorySearchManager,
  MemorySearchResult,
  MemorySource,
  MemorySyncProgressUpdate,
} from "./types.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { parseAgentSessionKey } from "../sessions/session-key-utils.js";
import { QmdProcessPool } from "./qmd-pool.js";
import {
  listSessionFilesForAgent,
  buildSessionEntry,
  type SessionFileEntry,
} from "./session-files.js";
import { requireNodeSqlite } from "./sqlite.js";
import {
  computeDecayScore,
  blendTemporalScore,
  accessFrequencyBoost,
  DEFAULT_TEMPORAL_CONFIG,
} from "./temporal.js";

type SqliteDatabase = import("node:sqlite").DatabaseSync;
import type { ResolvedMemoryBackendConfig, ResolvedQmdConfig } from "./backend-config.js";
import {
  isDirectMemoryReadAllowed,
  isMemoryPathAllowed,
  type MemoryAccessScope,
} from "./access-policy.js";

const log = createSubsystemLogger("memory");

const SNIPPET_HEADER_RE = /@@\s*-([0-9]+),([0-9]+)/;

// Trigger consolidation after this many successful updates since the last consolidation.
const CONSOLIDATE_UPDATE_THRESHOLD = 10;
// Trigger consolidation when total active document count reaches this level.
const CONSOLIDATE_FRAGMENT_THRESHOLD = 200;

type QmdQueryResult = {
  docid?: string;
  score?: number;
  file?: string;
  snippet?: string;
  body?: string;
};

type CollectionRoot = {
  path: string;
  kind: MemorySource;
};

type SessionExporterConfig = {
  dir: string;
  retentionMs?: number;
  collectionName: string;
};

export class QmdMemoryManager implements MemorySearchManager {
  static async create(params: {
    cfg: EdwinPAIConfig;
    agentId: string;
    resolved: ResolvedMemoryBackendConfig;
  }): Promise<QmdMemoryManager | null> {
    const resolved = params.resolved.qmd;
    if (!resolved) {
      return null;
    }
    const manager = new QmdMemoryManager({ cfg: params.cfg, agentId: params.agentId, resolved });
    await manager.initialize();
    return manager;
  }

  private readonly cfg: EdwinPAIConfig;
  private readonly agentId: string;
  private readonly qmd: ResolvedQmdConfig;
  private readonly workspaceDir: string;
  private readonly stateDir: string;
  private readonly agentStateDir: string;
  private readonly qmdDir: string;
  private readonly xdgConfigHome: string;
  private readonly xdgCacheHome: string;
  private readonly indexPath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly collectionRoots = new Map<string, CollectionRoot>();
  private readonly sources = new Set<MemorySource>();
  private readonly docPathCache = new Map<
    string,
    { rel: string; abs: string; source: MemorySource }
  >();
  private readonly sessionExporter: SessionExporterConfig | null;
  private readonly pool: QmdProcessPool;
  private updateTimer: NodeJS.Timeout | null = null;
  private embedTimer: NodeJS.Timeout | null = null;
  private consolidateTimer: NodeJS.Timeout | null = null;
  private pendingUpdate: Promise<void> | null = null;
  private pendingEmbed: Promise<void> | null = null;
  private pendingConsolidate: Promise<void> | null = null;
  private closed = false;
  private db: SqliteDatabase | null = null;
  private lastUpdateAt: number | null = null;
  private lastEmbedAt: number | null = null;
  private lastConsolidateAt: number | null = null;
  private updateCountSinceLastConsolidate = 0;
  private indexChangedCallbacks: Array<() => void> = [];
  private newTokensSinceLastEmbed = 0;

  private constructor(params: {
    cfg: EdwinPAIConfig;
    agentId: string;
    resolved: ResolvedQmdConfig;
  }) {
    this.cfg = params.cfg;
    this.agentId = params.agentId;
    this.qmd = params.resolved;
    this.workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
    this.stateDir = resolveStateDir(process.env, os.homedir);
    this.agentStateDir = path.join(this.stateDir, "agents", this.agentId);
    this.qmdDir = path.join(this.agentStateDir, "qmd");
    // QMD uses XDG base dirs for its internal state.
    // Collections are managed via `qmd collection add` and stored inside the index DB.
    // - config:  $XDG_CONFIG_HOME (contexts, etc.)
    // - cache:   $XDG_CACHE_HOME/qmd/index.sqlite
    this.xdgConfigHome = path.join(this.qmdDir, "xdg-config");
    this.xdgCacheHome = path.join(this.qmdDir, "xdg-cache");
    this.indexPath = path.join(this.xdgCacheHome, "qmd", "index.sqlite");

    const openAiApiKey = params.resolved.embeddingApiKey?.trim();
    this.env = {
      ...process.env,
      ...(openAiApiKey ? { OPENAI_API_KEY: openAiApiKey, QMD_OPENAI: "1" } : {}),
      XDG_CONFIG_HOME: this.xdgConfigHome,
      XDG_CACHE_HOME: this.xdgCacheHome,
      NO_COLOR: "1",
    };
    // Process pool: cap concurrent qmd processes to prevent CPU thrashing.
    // Default 3 workers handles typical query load without the thundering herd
    // that caused 5+ simultaneous bun processes each eating 6-8% CPU.
    this.pool = new QmdProcessPool({
      command: this.qmd.command,
      maxWorkers: 3,
      maxQueueSize: 20,
    });

    this.sessionExporter = this.qmd.sessions.enabled
      ? {
          dir: this.qmd.sessions.exportDir ?? path.join(this.qmdDir, "sessions"),
          retentionMs: this.qmd.sessions.retentionDays
            ? this.qmd.sessions.retentionDays * 24 * 60 * 60 * 1000
            : undefined,
          collectionName: this.pickSessionCollectionName(),
        }
      : null;
    if (this.sessionExporter) {
      this.qmd.collections = [
        ...this.qmd.collections,
        {
          name: this.sessionExporter.collectionName,
          path: this.sessionExporter.dir,
          pattern: "**/*.md",
          kind: "sessions",
        },
      ];
    }
  }

  private async initialize(): Promise<void> {
    await fs.mkdir(this.xdgConfigHome, { recursive: true });
    await fs.mkdir(this.xdgCacheHome, { recursive: true });
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });

    this.bootstrapCollections();
    await this.ensureCollections();

    if (this.qmd.update.onBoot) {
      await this.runUpdate("boot", true);
    }
    if (this.qmd.update.intervalMs > 0) {
      this.updateTimer = setInterval(() => {
        void this.runUpdate("interval").catch((err) => {
          log.warn(`qmd update failed (${String(err)})`);
        });
      }, this.qmd.update.intervalMs);
    }
    if (this.qmd.update.embedMaxIntervalMs > 0) {
      this.embedTimer = setInterval(() => {
        this.maybeScheduleEmbed("embed-ceiling");
      }, this.qmd.update.embedMaxIntervalMs);
    }

    if (this.qmd.consolidate.onBoot) {
      await this.runConsolidation(true);
    }
    if (this.qmd.consolidate.intervalMs > 0) {
      this.consolidateTimer = setInterval(() => {
        void this.runConsolidation().catch((err) => {
          log.warn(`qmd consolidate failed (${String(err)})`);
        });
      }, this.qmd.consolidate.intervalMs);
    }
  }

  private bootstrapCollections(): void {
    this.collectionRoots.clear();
    this.sources.clear();
    for (const collection of this.qmd.collections) {
      const kind: MemorySource = collection.kind === "sessions" ? "sessions" : "memory";
      this.collectionRoots.set(collection.name, { path: collection.path, kind });
      this.sources.add(kind);
    }
  }

  private async ensureCollections(): Promise<void> {
    // QMD collections are persisted inside the index database and must be created
    // via the CLI. Prefer listing existing collections when supported, otherwise
    // fall back to best-effort idempotent `qmd collection add`.
    const existing = new Set<string>();
    try {
      const result = await this.runQmd(["collection", "list", "--json"]);
      const parsed = JSON.parse(result.stdout) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === "string") {
            existing.add(entry);
          } else if (entry && typeof entry === "object") {
            const name = (entry as { name?: unknown }).name;
            if (typeof name === "string") {
              existing.add(name);
            }
          }
        }
      }
    } catch {
      // ignore; older qmd versions might not support list --json.
    }

    for (const collection of this.qmd.collections) {
      if (existing.has(collection.name)) {
        continue;
      }
      try {
        await this.runQmd([
          "collection",
          "add",
          collection.path,
          "--name",
          collection.name,
          "--mask",
          collection.pattern,
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Idempotency: qmd exits non-zero if the collection name already exists.
        if (message.toLowerCase().includes("already exists")) {
          continue;
        }
        if (message.toLowerCase().includes("exists")) {
          continue;
        }
        log.warn(`qmd collection add failed for ${collection.name}: ${message}`);
      }
    }
  }

  async search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      sessionKey?: string;
      accessScope?: MemoryAccessScope;
    },
  ): Promise<MemorySearchResult[]> {
    if (!this.isScopeAllowed(opts?.sessionKey)) {
      return [];
    }
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    await this.pendingUpdate?.catch(() => undefined);
    const limit = Math.min(
      this.qmd.limits.maxResults,
      opts?.maxResults ?? this.qmd.limits.maxResults,
    );
    const args = ["query", trimmed, "--json", "-n", String(limit)];
    let stdout: string;
    try {
      const result = await this.runQmd(args, { timeoutMs: this.qmd.limits.timeoutMs });
      stdout = result.stdout;
    } catch (err) {
      log.warn(`qmd query failed: ${String(err)}`);
      throw err instanceof Error ? err : new Error(String(err));
    }
    let parsed: QmdQueryResult[] = [];
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`qmd query returned invalid JSON: ${message}`);
      throw new Error(`qmd query returned invalid JSON: ${message}`, { cause: err });
    }
    const results: MemorySearchResult[] = [];
    for (const entry of parsed) {
      const doc = await this.resolveDocLocation(entry.docid);
      if (!doc) {
        continue;
      }
      if (!this.isDocumentAllowed(doc.rel, opts?.accessScope)) {
        continue;
      }
      const snippet = entry.snippet?.slice(0, this.qmd.limits.maxSnippetChars) ?? "";
      const lines = this.extractSnippetLines(snippet);
      const score = typeof entry.score === "number" ? entry.score : 0;
      const minScore = opts?.minScore ?? 0;
      if (score < minScore) {
        continue;
      }
      // Resolve event time: prefer DB value, fall back to path extraction
      const dbEventTime =
        typeof doc.eventTimeMs === "number" ? new Date(doc.eventTimeMs) : undefined;
      const eventTime = dbEventTime ?? this.extractDateFromPath(doc.rel);
      const now = new Date();
      const temporalScore = eventTime ? computeDecayScore(eventTime, now) : undefined;
      const freqBoost = accessFrequencyBoost(doc.accessCount ?? 0);
      const baseWithBoost = Math.min(1, score + freqBoost);
      const blended =
        temporalScore !== undefined
          ? blendTemporalScore(baseWithBoost, temporalScore, DEFAULT_TEMPORAL_CONFIG.temporalAlpha)
          : baseWithBoost;
      results.push({
        path: doc.rel,
        startLine: lines.startLine,
        endLine: lines.endLine,
        score: blended,
        snippet,
        source: doc.source,
        eventTime: eventTime ?? undefined,
        temporalScore,
        tier: doc.memoryTier as any,
      });
    }
    // Re-sort by blended score (temporal decay + access boost may reorder results)
    results.sort((a, b) => b.score - a.score);
    const clamped = this.clampResultsByInjectedChars(results.slice(0, limit));
    // Fire-and-forget: track access counts for returned results
    this.updateAccessCounts(clamped.map((r) => r.path));
    return clamped;
  }

  async sync(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    if (params?.progress) {
      params.progress({ completed: 0, total: 1, label: "Updating QMD index…" });
    }
    await this.runUpdate(params?.reason ?? "manual", params?.force);
    if (params?.progress) {
      params.progress({ completed: 1, total: 1, label: "QMD index updated" });
    }
  }

  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
    accessScope?: MemoryAccessScope;
  }): Promise<{ text: string; path: string }> {
    const relPath = params.relPath?.trim();
    if (!relPath) {
      throw new Error("path required");
    }
    if (!isDirectMemoryReadAllowed(params.accessScope)) {
      throw new Error("memory_get is disabled by runtime attachment policy attach-on-demand");
    }
    if (!this.isDocumentAllowed(relPath, params.accessScope)) {
      throw new Error("memory path is outside allowed collections");
    }
    const absPath = this.resolveReadPath(relPath);
    if (!absPath.endsWith(".md")) {
      throw new Error("path required");
    }
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("path required");
    }
    const content = await fs.readFile(absPath, "utf-8");
    if (!params.from && !params.lines) {
      return { text: content, path: relPath };
    }
    const lines = content.split("\n");
    const start = Math.max(1, params.from ?? 1);
    const count = Math.max(1, params.lines ?? lines.length);
    const slice = lines.slice(start - 1, start - 1 + count);
    return { text: slice.join("\n"), path: relPath };
  }

  status(): MemoryProviderStatus {
    const counts = this.readCounts();
    const embeddingCoverage = this.readEmbeddingCoverage();
    return {
      backend: "qmd",
      provider: "qmd",
      model: "qmd",
      requestedProvider: "qmd",
      files: counts.totalDocuments,
      chunks: counts.totalDocuments,
      dirty: false,
      workspaceDir: this.workspaceDir,
      dbPath: this.indexPath,
      sources: Array.from(this.sources),
      sourceCounts: counts.sourceCounts,
      vector: { enabled: true, available: true },
      batch: {
        enabled: false,
        failures: 0,
        limit: 0,
        wait: false,
        concurrency: 0,
        pollIntervalMs: 0,
        timeoutMs: 0,
      },
      custom: {
        qmd: {
          collections: this.qmd.collections.length,
          lastUpdateAt: this.lastUpdateAt,
          lastEmbedAt: this.lastEmbedAt,
          lastConsolidateAt: this.lastConsolidateAt,
          updateCountSinceLastConsolidate: this.updateCountSinceLastConsolidate,
          embedPending: Boolean(this.pendingEmbed),
          newTokensSinceLastEmbed: this.newTokensSinceLastEmbed,
          embedTokenThreshold: this.qmd.update.embedTokenThreshold,
          embedMinIntervalMs: this.qmd.update.embedMinIntervalMs,
          embedMaxIntervalMs: this.qmd.update.embedMaxIntervalMs,
          totalContentHashes: embeddingCoverage?.totalContentHashes,
          vectorizedContentHashes: embeddingCoverage?.vectorizedContentHashes,
          missingVectorHashes: embeddingCoverage?.missingVectorHashes,
          pool: this.pool.stats(),
        },
      },
    };
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    return { ok: true };
  }

  async probeVectorAvailability(): Promise<boolean> {
    return true;
  }

  /**
   * Extract a date from a file path (e.g., "memory/2026-04-04.md" → Date).
   * Falls back to null if no date pattern found.
   */
  private extractDateFromPath(relPath: string): Date | null {
    const match = relPath.match(/(\d{4}-\d{2}-\d{2})/);
    if (!match) return null;
    const parsed = new Date(match[1] + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  async flushIndex(reason: string): Promise<void> {
    if (this.sessionExporter) {
      await this.exportSessions();
    }
    await this.runQmd(["update"], { timeoutMs: 120_000 });
    this.lastUpdateAt = Date.now();
    this.docPathCache.clear();
    this.notifyIndexChanged();
    log.info(`qmd flush-index complete (${reason})`);
  }

  onIndexChanged(callback: () => void): void {
    this.indexChangedCallbacks.push(callback);
  }

  private notifyIndexChanged(): void {
    for (const cb of this.indexChangedCallbacks) {
      try {
        cb();
      } catch {
        // Ignore callback errors
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    if (this.embedTimer) {
      clearInterval(this.embedTimer);
      this.embedTimer = null;
    }
    if (this.consolidateTimer) {
      clearInterval(this.consolidateTimer);
      this.consolidateTimer = null;
    }
    await this.pendingUpdate?.catch(() => undefined);
    await this.pendingEmbed?.catch(() => undefined);
    await this.pendingConsolidate?.catch(() => undefined);
    await this.pool.close();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private async runUpdate(reason: string, force?: boolean): Promise<void> {
    if (this.pendingUpdate && !force) {
      return this.pendingUpdate;
    }
    if (this.shouldSkipUpdate(force)) {
      return;
    }
    const run = async () => {
      if (this.sessionExporter) {
        await this.exportSessions();
      }
      await this.runQmd(["update"], { timeoutMs: 120_000 });
      this.lastUpdateAt = Date.now();
      this.updateCountSinceLastConsolidate += 1;
      this.docPathCache.clear();
      this.notifyIndexChanged();
      this.maybeScheduleEmbed(reason);
    };
    this.pendingUpdate = run().finally(() => {
      this.pendingUpdate = null;
    });
    await this.pendingUpdate;
  }

  private maybeScheduleEmbed(reason: string): void {
    if (this.pendingEmbed || this.closed) {
      return;
    }
    const { embedMinIntervalMs, embedMaxIntervalMs, embedTokenThreshold } = this.qmd.update;
    const elapsed = this.lastEmbedAt !== null ? Date.now() - this.lastEmbedAt : Infinity;
    if (elapsed < embedMinIntervalMs) {
      return;
    }
    const tokenThresholdMet = this.newTokensSinceLastEmbed >= embedTokenThreshold;
    const maxIntervalMet = elapsed >= embedMaxIntervalMs;
    const firstRun = this.lastEmbedAt === null;
    if (!tokenThresholdMet && !maxIntervalMet && !firstRun) {
      return;
    }
    log.info(
      `qmd embed scheduled (${reason}, tokens=${this.newTokensSinceLastEmbed}, elapsed=${Math.round(elapsed / 1000)}s)`,
    );
    this.runEmbedAsync(reason);
  }

  private runEmbedAsync(reason: string): void {
    if (this.pendingEmbed) {
      return;
    }
    const run = async () => {
      await this.runQmd(["embed"], { timeoutMs: 120_000 });
      this.lastEmbedAt = Date.now();
      this.newTokensSinceLastEmbed = 0;
    };
    this.pendingEmbed = run()
      .catch((err) => {
        log.warn(`qmd embed failed (${reason}): ${String(err)}`);
      })
      .finally(() => {
        this.pendingEmbed = null;
      });
  }

  trackNewTokens(count: number): void {
    this.newTokensSinceLastEmbed += count;
  }

  async runConsolidation(force?: boolean): Promise<void> {
    if (this.pendingConsolidate && !force) {
      return this.pendingConsolidate;
    }
    if (this.shouldSkipConsolidate(force)) {
      return;
    }
    const run = async () => {
      await this.runQmd(["consolidate"], { timeoutMs: 120_000 });
      this.lastConsolidateAt = Date.now();
      this.updateCountSinceLastConsolidate = 0;
    };
    this.pendingConsolidate = run().finally(() => {
      this.pendingConsolidate = null;
    });
    await this.pendingConsolidate;
  }

  private async runQmd(
    args: string[],
    opts?: { timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string }> {
    return this.pool.exec(args, {
      env: this.env,
      cwd: this.workspaceDir,
      timeoutMs: opts?.timeoutMs,
    });
  }

  private ensureDb(): SqliteDatabase {
    if (this.db) {
      return this.db;
    }
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(this.indexPath, { readOnly: true });
    return this.db;
  }

  private async exportSessions(): Promise<void> {
    if (!this.sessionExporter) {
      return;
    }
    const exportDir = this.sessionExporter.dir;
    await fs.mkdir(exportDir, { recursive: true });
    const files = await listSessionFilesForAgent(this.agentId);
    const keep = new Set<string>();
    const cutoff = this.sessionExporter.retentionMs
      ? Date.now() - this.sessionExporter.retentionMs
      : null;
    for (const sessionFile of files) {
      const entry = await buildSessionEntry(sessionFile);
      if (!entry) {
        continue;
      }
      if (cutoff && entry.mtimeMs < cutoff) {
        continue;
      }
      const target = path.join(exportDir, `${path.basename(sessionFile, ".jsonl")}.md`);
      await fs.writeFile(target, this.renderSessionMarkdown(entry), "utf-8");
      keep.add(target);
    }
    const exported = await fs.readdir(exportDir).catch(() => []);
    for (const name of exported) {
      if (!name.endsWith(".md")) {
        continue;
      }
      const full = path.join(exportDir, name);
      if (!keep.has(full)) {
        await fs.rm(full, { force: true });
      }
    }
  }

  private renderSessionMarkdown(entry: SessionFileEntry): string {
    const header = `# Session ${path.basename(entry.absPath, path.extname(entry.absPath))}`;
    const body = entry.content?.trim().length ? entry.content.trim() : "(empty)";
    return `${header}\n\n${body}\n`;
  }

  private pickSessionCollectionName(): string {
    const existing = new Set(this.qmd.collections.map((collection) => collection.name));
    if (!existing.has("sessions")) {
      return "sessions";
    }
    let counter = 2;
    let candidate = `sessions-${counter}`;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = `sessions-${counter}`;
    }
    return candidate;
  }

  private async resolveDocLocation(docid?: string): Promise<{
    rel: string;
    abs: string;
    source: MemorySource;
    memoryTier?: string;
    accessCount?: number;
    eventTimeMs?: number;
  } | null> {
    if (!docid) {
      return null;
    }
    const normalized = docid.startsWith("#") ? docid.slice(1) : docid;
    if (!normalized) {
      return null;
    }
    const cached = this.docPathCache.get(normalized);
    if (cached) {
      return cached;
    }
    const db = this.ensureDb();
    const row = db
      .prepare(
        "SELECT d.collection, d.path, c.memory_tier, c.access_count, c.event_time FROM documents d LEFT JOIN chunks c ON c.path = d.path AND c.active = 1 WHERE d.hash LIKE ? AND d.active = 1 LIMIT 1",
      )
      .get(`${normalized}%`) as
      | {
          collection: string;
          path: string;
          memory_tier?: string;
          access_count?: number;
          event_time?: number;
        }
      | undefined;
    if (!row) {
      return null;
    }
    const location = this.toDocLocation(row.collection, row.path);
    if (!location) {
      return null;
    }
    const enriched = {
      ...location,
      memoryTier: row.memory_tier ?? undefined,
      accessCount: typeof row.access_count === "number" ? row.access_count : undefined,
      eventTimeMs: typeof row.event_time === "number" ? row.event_time : undefined,
    };
    this.docPathCache.set(normalized, enriched);
    return enriched;
  }

  /**
   * Increment access count for retrieved search results (fire-and-forget).
   */
  private updateAccessCounts(paths: string[]): void {
    if (paths.length === 0) return;
    try {
      const db = this.ensureDb();
      const now = Date.now();
      const stmt = db.prepare(
        "UPDATE chunks SET access_count = COALESCE(access_count, 0) + 1, last_accessed_at = ? WHERE path = ? AND active = 1",
      );
      for (const p of paths) {
        try {
          stmt.run(now, p);
        } catch {
          // best-effort
        }
      }
    } catch {
      // best-effort — don't break search for tracking failures
    }
  }

  private extractSnippetLines(snippet: string): { startLine: number; endLine: number } {
    const match = SNIPPET_HEADER_RE.exec(snippet);
    if (match) {
      const start = Number(match[1]);
      const count = Number(match[2]);
      if (Number.isFinite(start) && Number.isFinite(count)) {
        return { startLine: start, endLine: start + count - 1 };
      }
    }
    const lines = snippet.split("\n").length;
    return { startLine: 1, endLine: lines };
  }

  private readEmbeddingCoverage(): {
    totalContentHashes: number;
    vectorizedContentHashes: number;
    missingVectorHashes: number;
  } | null {
    try {
      const db = this.ensureDb();
      const totalContentHashes = Number(
        db.prepare("SELECT COUNT(DISTINCT hash) as c FROM documents WHERE active = 1").get()?.c ??
          0,
      );
      const vectorizedContentHashes = Number(
        db
          .prepare(
            `SELECT COUNT(DISTINCT d.hash) as c
             FROM documents d
             JOIN content_vectors v ON v.hash = d.hash
             WHERE d.active = 1`,
          )
          .get()?.c ?? 0,
      );
      return {
        totalContentHashes,
        vectorizedContentHashes,
        missingVectorHashes: Math.max(0, totalContentHashes - vectorizedContentHashes),
      };
    } catch (err) {
      log.warn(`failed to read qmd embedding coverage: ${String(err)}`);
      return null;
    }
  }

  private readCounts(): {
    totalDocuments: number;
    sourceCounts: Array<{ source: MemorySource; files: number; chunks: number }>;
  } {
    try {
      const db = this.ensureDb();
      const rows = db
        .prepare(
          "SELECT collection, COUNT(*) as c FROM documents WHERE active = 1 GROUP BY collection",
        )
        .all() as Array<{ collection: string; c: number }>;
      const bySource = new Map<MemorySource, { files: number; chunks: number }>();
      for (const source of this.sources) {
        bySource.set(source, { files: 0, chunks: 0 });
      }
      let total = 0;
      for (const row of rows) {
        const root = this.collectionRoots.get(row.collection);
        const source = root?.kind ?? "memory";
        const entry = bySource.get(source) ?? { files: 0, chunks: 0 };
        entry.files += row.c ?? 0;
        entry.chunks += row.c ?? 0;
        bySource.set(source, entry);
        total += row.c ?? 0;
      }
      return {
        totalDocuments: total,
        sourceCounts: Array.from(bySource.entries()).map(([source, value]) => ({
          source,
          files: value.files,
          chunks: value.chunks,
        })),
      };
    } catch (err) {
      log.warn(`failed to read qmd index stats: ${String(err)}`);
      return {
        totalDocuments: 0,
        sourceCounts: Array.from(this.sources).map((source) => ({ source, files: 0, chunks: 0 })),
      };
    }
  }

  private isDocumentAllowed(relPath: string, accessScope?: MemoryAccessScope): boolean {
    return isMemoryPathAllowed({
      relPath,
      workspaceDir: this.workspaceDir,
      collections: this.qmd.collections,
      allowedCollections: accessScope?.allowedCollections,
    });
  }

  private isScopeAllowed(sessionKey?: string): boolean {
    const scope = this.qmd.scope;
    if (!scope) {
      return true;
    }
    const channel = this.deriveChannelFromKey(sessionKey);
    const chatType = this.deriveChatTypeFromKey(sessionKey);
    const normalizedKey = sessionKey ?? "";
    for (const rule of scope.rules ?? []) {
      if (!rule) {
        continue;
      }
      const match = rule.match ?? {};
      if (match.channel && match.channel !== channel) {
        continue;
      }
      if (match.chatType && match.chatType !== chatType) {
        continue;
      }
      if (match.keyPrefix && !normalizedKey.startsWith(match.keyPrefix)) {
        continue;
      }
      return rule.action === "allow";
    }
    const fallback = scope.default ?? "allow";
    return fallback === "allow";
  }

  private deriveChannelFromKey(key?: string) {
    if (!key) {
      return undefined;
    }
    const normalized = this.normalizeSessionKey(key);
    if (!normalized) {
      return undefined;
    }
    const parts = normalized.split(":").filter(Boolean);
    if (
      parts.length >= 2 &&
      (parts[1] === "group" || parts[1] === "channel" || parts[1] === "dm")
    ) {
      return parts[0]?.toLowerCase();
    }
    return undefined;
  }

  private deriveChatTypeFromKey(key?: string) {
    if (!key) {
      return undefined;
    }
    const normalized = this.normalizeSessionKey(key);
    if (!normalized) {
      return undefined;
    }
    if (normalized.includes(":group:")) {
      return "group";
    }
    if (normalized.includes(":channel:")) {
      return "channel";
    }
    return "direct";
  }

  private normalizeSessionKey(key: string): string | undefined {
    const trimmed = key.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = parseAgentSessionKey(trimmed);
    const normalized = (parsed?.rest ?? trimmed).toLowerCase();
    if (normalized.startsWith("subagent:")) {
      return undefined;
    }
    return normalized;
  }

  private toDocLocation(
    collection: string,
    collectionRelativePath: string,
  ): { rel: string; abs: string; source: MemorySource } | null {
    const root = this.collectionRoots.get(collection);
    if (!root) {
      return null;
    }
    const normalizedRelative = collectionRelativePath.replace(/\\/g, "/");
    const absPath = path.normalize(path.resolve(root.path, collectionRelativePath));
    const relativeToWorkspace = path.relative(this.workspaceDir, absPath);
    const relPath = this.buildSearchPath(
      collection,
      normalizedRelative,
      relativeToWorkspace,
      absPath,
    );
    return { rel: relPath, abs: absPath, source: root.kind };
  }

  private buildSearchPath(
    collection: string,
    collectionRelativePath: string,
    relativeToWorkspace: string,
    absPath: string,
  ): string {
    const insideWorkspace = this.isInsideWorkspace(relativeToWorkspace);
    if (insideWorkspace) {
      const normalized = relativeToWorkspace.replace(/\\/g, "/");
      if (!normalized) {
        return path.basename(absPath);
      }
      return normalized;
    }
    const sanitized = collectionRelativePath.replace(/^\/+/, "");
    return `qmd/${collection}/${sanitized}`;
  }

  private isInsideWorkspace(relativePath: string): boolean {
    if (!relativePath) {
      return true;
    }
    if (relativePath.startsWith("..")) {
      return false;
    }
    if (relativePath.startsWith(`..${path.sep}`)) {
      return false;
    }
    return !path.isAbsolute(relativePath);
  }

  private resolveReadPath(relPath: string): string {
    if (relPath.startsWith("qmd/")) {
      const [, collection, ...rest] = relPath.split("/");
      if (!collection || rest.length === 0) {
        throw new Error("invalid qmd path");
      }
      const root = this.collectionRoots.get(collection);
      if (!root) {
        throw new Error(`unknown qmd collection: ${collection}`);
      }
      const joined = rest.join("/");
      const resolved = path.resolve(root.path, joined);
      if (!this.isWithinRoot(root.path, resolved)) {
        throw new Error("qmd path escapes collection");
      }
      return resolved;
    }
    const absPath = path.resolve(this.workspaceDir, relPath);
    if (!this.isWithinWorkspace(absPath)) {
      throw new Error("path escapes workspace");
    }
    return absPath;
  }

  private isWithinWorkspace(absPath: string): boolean {
    const normalizedWorkspace = this.workspaceDir.endsWith(path.sep)
      ? this.workspaceDir
      : `${this.workspaceDir}${path.sep}`;
    if (absPath === this.workspaceDir) {
      return true;
    }
    const candidate = absPath.endsWith(path.sep) ? absPath : `${absPath}${path.sep}`;
    return candidate.startsWith(normalizedWorkspace);
  }

  private isWithinRoot(root: string, candidate: string): boolean {
    const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (candidate === root) {
      return true;
    }
    const next = candidate.endsWith(path.sep) ? candidate : `${candidate}${path.sep}`;
    return next.startsWith(normalizedRoot);
  }

  private clampResultsByInjectedChars(results: MemorySearchResult[]): MemorySearchResult[] {
    const budget = this.qmd.limits.maxInjectedChars;
    if (!budget || budget <= 0) {
      return results;
    }
    let remaining = budget;
    const clamped: MemorySearchResult[] = [];
    for (const entry of results) {
      if (remaining <= 0) {
        break;
      }
      const snippet = entry.snippet ?? "";
      if (snippet.length <= remaining) {
        clamped.push(entry);
        remaining -= snippet.length;
      } else {
        const trimmed = snippet.slice(0, Math.max(0, remaining));
        clamped.push({ ...entry, snippet: trimmed });
        break;
      }
    }
    return clamped;
  }

  private shouldSkipUpdate(force?: boolean): boolean {
    if (force) {
      return false;
    }
    const debounceMs = this.qmd.update.debounceMs;
    if (debounceMs <= 0) {
      return false;
    }
    if (!this.lastUpdateAt) {
      return false;
    }
    return Date.now() - this.lastUpdateAt < debounceMs;
  }

  shouldConsolidate(): boolean {
    if (this.pendingConsolidate) {
      return false;
    }
    if (this.shouldSkipConsolidate()) {
      return false;
    }
    if (this.updateCountSinceLastConsolidate >= CONSOLIDATE_UPDATE_THRESHOLD) {
      return true;
    }
    return this.readCounts().totalDocuments >= CONSOLIDATE_FRAGMENT_THRESHOLD;
  }

  private shouldSkipConsolidate(force?: boolean): boolean {
    if (force) {
      return false;
    }
    const debounceMs = this.qmd.consolidate.debounceMs;
    if (debounceMs <= 0) {
      return false;
    }
    if (!this.lastConsolidateAt) {
      return false;
    }
    return Date.now() - this.lastConsolidateAt < debounceMs;
  }
}
