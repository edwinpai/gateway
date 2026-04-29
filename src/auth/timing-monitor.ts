/**
 * Timing Monitor - Anomaly Detection for Request Timing
 *
 * Implements the 1-to-1 constraint: tracks per-identity action timestamps
 * and flags concurrent actions from the same identity (physically impossible).
 *
 * Features:
 * - Statistical baseline building per identity
 * - Anomaly scoring based on deviation from baseline
 * - Concurrency detection
 * - Escalation ladder (flag → hold → reject → lockdown)
 *
 * @see SECURITY-MITIGATIONS-v2.md - Threat #6
 */

/**
 * Escalation levels for timing anomalies
 */
export type EscalationLevel = "normal" | "flag" | "hold" | "reject" | "lockdown";

/**
 * Configuration for the timing monitor
 */
export interface TimingMonitorConfig {
  /** Minimum latency difference to consider concurrent (ms) */
  concurrencyWindowMs?: number;
  /** Number of samples needed before baseline is considered stable */
  baselineMinSamples?: number;
  /** Maximum samples to keep for baseline calculation */
  baselineMaxSamples?: number;
  /** Anomaly score threshold for flagging (0-1) */
  flagThreshold?: number;
  /** Anomaly score threshold for holding (0-1) */
  holdThreshold?: number;
  /** Anomaly score threshold for rejection (0-1) */
  rejectThreshold?: number;
  /** Number of consecutive anomalies before lockdown */
  lockdownCount?: number;
  /** Lockdown duration in milliseconds */
  lockdownDurationMs?: number;
  /** Anomaly history retention count */
  maxAnomalyHistory?: number;
}

const DEFAULT_CONFIG: Required<TimingMonitorConfig> = {
  concurrencyWindowMs: 100, // 100ms window for concurrent detection
  baselineMinSamples: 10,
  baselineMaxSamples: 1000,
  flagThreshold: 0.5,
  holdThreshold: 0.7,
  rejectThreshold: 0.9,
  lockdownCount: 5,
  lockdownDurationMs: 60000, // 1 minute
  maxAnomalyHistory: 100,
};

/**
 * Baseline latency statistics
 */
export interface LatencyBaseline {
  /** Mean latency in milliseconds */
  mean: number;
  /** Standard deviation */
  stddev: number;
  /** 95th percentile */
  p95: number;
  /** 99th percentile */
  p99: number;
}

/**
 * Anomaly event record
 */
export interface AnomalyEvent {
  /** Event timestamp */
  timestamp: number;
  /** Anomaly score (0-1) */
  score: number;
  /** Type of anomaly */
  type: "latency" | "concurrency" | "pattern";
  /** Additional details */
  details?: string;
}

/**
 * Timing profile for an identity
 */
export interface TimingProfile {
  /** Identity public key */
  identity: string;
  /** Baseline latency statistics */
  baselineLatencyMs: LatencyBaseline;
  /** Timestamp of last action */
  lastActionTimestamp: number;
  /** Total action count */
  actionCount: number;
  /** Recent anomaly history */
  anomalyHistory: AnomalyEvent[];
  /** Current escalation level */
  escalationLevel: EscalationLevel;
  /** Consecutive anomaly count */
  consecutiveAnomalies: number;
  /** Lockdown expiry (if in lockdown) */
  lockdownExpiresAt?: number;
}

/**
 * Verdict from timing check
 */
export interface TimingVerdict {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Anomaly score (0-1) */
  anomalyScore: number;
  /** Current escalation level */
  escalationLevel: EscalationLevel;
  /** Reason for verdict */
  reason?: string;
  /** Recommendations */
  recommendations?: string[];
}

/**
 * Internal timing data for an identity
 */
interface TimingData {
  /** Raw latency samples */
  latencySamples: number[];
  /** Action timestamps */
  actionTimestamps: number[];
  /** Computed baseline (cached) */
  baseline?: LatencyBaseline;
  /** Profile metadata */
  profile: TimingProfile;
}

/**
 * Timing Monitor
 *
 * Tracks per-identity request timing and detects anomalies that could
 * indicate attacks or constraint violations.
 *
 * @example
 * ```typescript
 * const monitor = new TimingMonitor();
 *
 * // Record an action
 * const verdict = monitor.recordAction(
 *   "03abc...",  // identity
 *   Date.now(),  // timestamp
 *   150          // latency in ms
 * );
 *
 * if (!verdict.allowed) {
 *   console.log(`Action blocked: ${verdict.reason}`);
 * }
 *
 * // Check for concurrent actions (1-to-1 constraint)
 * if (!monitor.checkConcurrency("03abc...", Date.now())) {
 *   console.log("Concurrent action detected!");
 * }
 * ```
 */
export class TimingMonitor {
  private readonly config: Required<TimingMonitorConfig>;
  private readonly identities: Map<string, TimingData> = new Map();

  /**
   * Create a new TimingMonitor
   *
   * @param config - Monitor configuration
   */
  constructor(config: TimingMonitorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an action and get timing verdict
   *
   * @param identity - Identity public key
   * @param timestamp - Action timestamp (Unix ms)
   * @param latencyMs - Request latency in milliseconds
   * @returns Timing verdict
   */
  recordAction(identity: string, timestamp: number, latencyMs: number): TimingVerdict {
    const data = this.getOrCreateTimingData(identity);
    const profile = data.profile;

    // Check if in lockdown
    if (profile.lockdownExpiresAt && Date.now() < profile.lockdownExpiresAt) {
      return {
        allowed: false,
        anomalyScore: 1.0,
        escalationLevel: "lockdown",
        reason: `Identity in lockdown until ${new Date(profile.lockdownExpiresAt).toISOString()}`,
      };
    } else if (profile.lockdownExpiresAt) {
      // Lockdown expired, reset
      profile.lockdownExpiresAt = undefined;
      profile.escalationLevel = "normal";
      profile.consecutiveAnomalies = 0;
    }

    // Add latency sample
    data.latencySamples.push(latencyMs);
    if (data.latencySamples.length > this.config.baselineMaxSamples) {
      data.latencySamples.shift();
    }

    // Check for concurrency BEFORE updating lastActionTimestamp
    const concurrencyViolation = this.detectConcurrency(data, timestamp);

    // Add action timestamp
    data.actionTimestamps.push(timestamp);
    if (data.actionTimestamps.length > this.config.baselineMaxSamples) {
      data.actionTimestamps.shift();
    }

    // Update profile
    profile.lastActionTimestamp = timestamp;
    profile.actionCount++;

    // Recompute baseline
    data.baseline = this.computeBaseline(data.latencySamples);
    profile.baselineLatencyMs = data.baseline;

    // Calculate anomaly score
    const anomalyScore = this.calculateAnomalyScore(latencyMs, data);

    // Handle concurrency violation
    if (concurrencyViolation) {
      return this.handleAnomaly(data, {
        timestamp,
        score: 1.0,
        type: "concurrency",
        details: "Concurrent action detected",
      });
    }

    // Check for latency anomaly
    if (anomalyScore >= this.config.flagThreshold) {
      return this.handleAnomaly(data, {
        timestamp,
        score: anomalyScore,
        type: "latency",
        details: `Latency ${latencyMs}ms deviates from baseline`,
      });
    }

    // Normal action
    profile.consecutiveAnomalies = 0;
    if (profile.escalationLevel !== "lockdown") {
      profile.escalationLevel = "normal";
    }

    return {
      allowed: true,
      anomalyScore,
      escalationLevel: profile.escalationLevel,
    };
  }

  /**
   * Check for concurrent actions from an identity
   *
   * The 1-to-1 constraint: it should be physically impossible for the same
   * identity to perform concurrent actions.
   *
   * @param identity - Identity public key
   * @param timestamp - Current action timestamp
   * @returns true if action is valid (not concurrent), false if concurrent detected
   */
  checkConcurrency(identity: string, timestamp: number): boolean {
    const data = this.identities.get(identity);
    if (!data) {
      return true;
    }

    return !this.detectConcurrency(data, timestamp);
  }

  /**
   * Get timing profile for an identity
   *
   * @param identity - Identity public key
   * @returns Timing profile or undefined if not tracked
   */
  getProfile(identity: string): TimingProfile | undefined {
    const data = this.identities.get(identity);
    return data?.profile;
  }

  /**
   * Get all tracked identities
   *
   * @returns Array of identity public keys
   */
  getTrackedIdentities(): string[] {
    return Array.from(this.identities.keys());
  }

  /**
   * Reset timing data for an identity
   *
   * @param identity - Identity public key
   */
  reset(identity: string): void {
    this.identities.delete(identity);
  }

  /**
   * Reset all timing data
   */
  resetAll(): void {
    this.identities.clear();
  }

  /**
   * Get monitor statistics
   */
  getStats(): {
    trackedIdentities: number;
    totalActions: number;
    lockedOutIdentities: number;
  } {
    let totalActions = 0;
    let lockedOut = 0;
    const now = Date.now();

    for (const data of this.identities.values()) {
      totalActions += data.profile.actionCount;
      if (data.profile.lockdownExpiresAt && now < data.profile.lockdownExpiresAt) {
        lockedOut++;
      }
    }

    return {
      trackedIdentities: this.identities.size,
      totalActions,
      lockedOutIdentities: lockedOut,
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private getOrCreateTimingData(identity: string): TimingData {
    let data = this.identities.get(identity);

    if (!data) {
      data = {
        latencySamples: [],
        actionTimestamps: [],
        profile: {
          identity,
          baselineLatencyMs: { mean: 0, stddev: 0, p95: 0, p99: 0 },
          lastActionTimestamp: 0,
          actionCount: 0,
          anomalyHistory: [],
          escalationLevel: "normal",
          consecutiveAnomalies: 0,
        },
      };
      this.identities.set(identity, data);
    }

    return data;
  }

  private computeBaseline(samples: number[]): LatencyBaseline {
    if (samples.length === 0) {
      return { mean: 0, stddev: 0, p95: 0, p99: 0 };
    }

    // Sort for percentiles
    const sorted = [...samples].toSorted((a, b) => a - b);

    // Mean
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;

    // Standard deviation
    const squaredDiffs = sorted.map((x) => Math.pow(x - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / sorted.length;
    const stddev = Math.sqrt(variance);

    // Percentiles
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);
    const p95 = sorted[p95Index] ?? sorted[sorted.length - 1] ?? 0;
    const p99 = sorted[p99Index] ?? sorted[sorted.length - 1] ?? 0;

    return { mean, stddev, p95, p99 };
  }

  private calculateAnomalyScore(latencyMs: number, data: TimingData): number {
    // Not enough samples for reliable baseline - return 0 (no anomaly)
    if (data.latencySamples.length <= this.config.baselineMinSamples) {
      return 0;
    }

    const baseline = data.baseline!;

    // Calculate z-score (how many standard deviations from mean)
    if (baseline.stddev === 0 || baseline.stddev < 0.001) {
      // If stddev is essentially 0, compare directly to mean
      const diff = Math.abs(latencyMs - baseline.mean);
      // Consider anything within 10% of mean as normal
      if (diff < baseline.mean * 0.1) {
        return 0;
      }
      return Math.min(1, diff / baseline.mean);
    }

    const zScore = Math.abs(latencyMs - baseline.mean) / baseline.stddev;

    // Convert z-score to anomaly score (0-1)
    // z=2 → ~0.5, z=3 → ~0.75, z=4 → ~0.9
    return Math.min(1, zScore / 4);
  }

  private detectConcurrency(data: TimingData, currentTimestamp: number): boolean {
    // No previous actions, no concurrency possible
    if (data.profile.lastActionTimestamp === 0) {
      return false;
    }

    // Get the most recent action timestamp
    const lastTimestamp = data.profile.lastActionTimestamp;

    // Check if the current action is too close to the last one
    const timeDiff = Math.abs(currentTimestamp - lastTimestamp);

    return timeDiff < this.config.concurrencyWindowMs;
  }

  private handleAnomaly(data: TimingData, event: AnomalyEvent): TimingVerdict {
    const profile = data.profile;

    // Record anomaly
    profile.anomalyHistory.push(event);
    if (profile.anomalyHistory.length > this.config.maxAnomalyHistory) {
      profile.anomalyHistory.shift();
    }

    profile.consecutiveAnomalies++;

    // Determine escalation level
    let escalationLevel: EscalationLevel;
    let allowed = true;
    let reason: string | undefined;
    const recommendations: string[] = [];

    if (profile.consecutiveAnomalies >= this.config.lockdownCount) {
      // Enter lockdown
      escalationLevel = "lockdown";
      profile.lockdownExpiresAt = Date.now() + this.config.lockdownDurationMs;
      allowed = false;
      reason = `Identity locked out after ${profile.consecutiveAnomalies} consecutive anomalies`;
      recommendations.push("Verify identity ownership");
      recommendations.push("Check for compromised credentials");
    } else if (event.score >= this.config.rejectThreshold) {
      escalationLevel = "reject";
      allowed = false;
      reason = `Anomaly score ${event.score.toFixed(2)} exceeds rejection threshold`;
      recommendations.push("Review recent activity");
    } else if (event.score >= this.config.holdThreshold) {
      escalationLevel = "hold";
      allowed = true; // Allow but flag for review
      reason = `Anomaly score ${event.score.toFixed(2)} exceeds hold threshold`;
      recommendations.push("Monitor subsequent actions");
    } else if (event.score >= this.config.flagThreshold) {
      escalationLevel = "flag";
      allowed = true;
      reason = `Anomaly score ${event.score.toFixed(2)} exceeds flag threshold`;
    } else {
      escalationLevel = "normal";
    }

    profile.escalationLevel = escalationLevel;

    return {
      allowed,
      anomalyScore: event.score,
      escalationLevel,
      reason: reason ?? event.details,
      recommendations: recommendations.length > 0 ? recommendations : undefined,
    };
  }
}
