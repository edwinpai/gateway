/**
 * TimingMonitor Tests
 *
 * Tests for timing anomaly detection:
 * - Concurrency detection (1-to-1 constraint)
 * - Baseline building
 * - Anomaly scoring
 * - Escalation ladder
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TimingMonitor, type EscalationLevel } from "../timing-monitor.js";

describe("TimingMonitor", () => {
  let monitor: TimingMonitor;

  beforeEach(() => {
    monitor = new TimingMonitor({
      concurrencyWindowMs: 100,
      baselineMinSamples: 5,
      flagThreshold: 0.5,
      holdThreshold: 0.7,
      rejectThreshold: 0.9,
      lockdownCount: 3,
      lockdownDurationMs: 1000,
    });
  });

  describe("recordAction()", () => {
    it("should record an action and return a verdict", () => {
      const verdict = monitor.recordAction("identity-1", Date.now(), 100);

      expect(verdict).toBeDefined();
      expect(verdict.allowed).toBe(true);
      expect(verdict.anomalyScore).toBeDefined();
      expect(verdict.escalationLevel).toBe("normal");
    });

    it("should build baseline from multiple samples", () => {
      const identity = "identity-1";
      let timestamp = Date.now();

      // Record several actions with consistent latency
      for (let i = 0; i < 10; i++) {
        timestamp += 1000; // 1 second between actions
        monitor.recordAction(identity, timestamp, 100 + Math.random() * 20);
      }

      const profile = monitor.getProfile(identity);

      expect(profile).toBeDefined();
      expect(profile?.baselineLatencyMs.mean).toBeGreaterThan(0);
      expect(profile?.baselineLatencyMs.stddev).toBeDefined();
      expect(profile?.actionCount).toBe(10);
    });

    it("should track action count", () => {
      const identity = "identity-1";
      let timestamp = Date.now();

      for (let i = 0; i < 5; i++) {
        timestamp += 1000;
        monitor.recordAction(identity, timestamp, 100);
      }

      const profile = monitor.getProfile(identity);
      expect(profile?.actionCount).toBe(5);
    });
  });

  describe("Concurrency Detection", () => {
    it("should detect concurrent actions", () => {
      const identity = "identity-concurrent";
      const timestamp = Date.now();

      // First action
      const verdict1 = monitor.recordAction(identity, timestamp, 100);
      expect(verdict1.allowed).toBe(true);

      // Second action at nearly the same time (within concurrency window)
      const verdict2 = monitor.recordAction(identity, timestamp + 50, 100);
      expect(verdict2.allowed).toBe(false);
      expect(verdict2.anomalyScore).toBe(1.0);
      // The reason could be from the anomaly handler's escalation or the original details
      expect(
        verdict2.reason?.includes("Concurrent") || verdict2.reason?.includes("Anomaly score"),
      ).toBe(true);
    });

    it("should allow actions outside concurrency window", () => {
      const identity = "identity-1";
      const timestamp = Date.now();

      monitor.recordAction(identity, timestamp, 100);

      // Action 200ms later (outside 100ms window)
      const verdict = monitor.recordAction(identity, timestamp + 200, 100);
      expect(verdict.allowed).toBe(true);
    });

    it("should check concurrency independently", () => {
      const identity = "identity-1";
      const timestamp = Date.now();

      monitor.recordAction(identity, timestamp, 100);

      // Check concurrency without recording
      const isConcurrent = monitor.checkConcurrency(identity, timestamp + 50);
      expect(isConcurrent).toBe(false); // Concurrent detected

      const isNotConcurrent = monitor.checkConcurrency(identity, timestamp + 200);
      expect(isNotConcurrent).toBe(true); // Not concurrent
    });
  });

  describe("Anomaly Scoring", () => {
    it("should calculate low anomaly score for normal latency", () => {
      // Use a fresh monitor to avoid state pollution
      const freshMonitor = new TimingMonitor({
        concurrencyWindowMs: 100,
        baselineMinSamples: 5,
      });

      const identity = "identity-low-anomaly";
      let timestamp = Date.now();

      // Build baseline with varied latencies (need variation for meaningful stddev)
      const latencies = [100, 102, 98, 101, 99, 103, 97, 100, 102, 98];
      for (const latency of latencies) {
        timestamp += 1000;
        freshMonitor.recordAction(identity, timestamp, latency);
      }

      // New action with similar latency (within normal range)
      timestamp += 1000;
      const verdict = freshMonitor.recordAction(identity, timestamp, 100);

      // With a consistent baseline around 100ms, 100ms should have very low anomaly
      expect(verdict.anomalyScore).toBeLessThan(0.3);
    });

    it("should calculate high anomaly score for unusual latency", () => {
      const identity = "identity-1";
      let timestamp = Date.now();

      // Build baseline with consistent 100ms latency (low variance)
      for (let i = 0; i < 10; i++) {
        timestamp += 1000;
        monitor.recordAction(identity, timestamp, 100);
      }

      // New action with very different latency
      timestamp += 1000;
      const verdict = monitor.recordAction(identity, timestamp, 500);

      expect(verdict.anomalyScore).toBeGreaterThan(0.5);
    });

    it("should return 0 anomaly score when baseline is not established", () => {
      // Record fewer than baselineMinSamples to keep baseline unstable
      const identity = "new-identity";
      let timestamp = Date.now();

      // First few actions should have 0 anomaly score (baseline not established)
      for (let i = 0; i < 4; i++) {
        timestamp += 1000;
        const verdict = monitor.recordAction(identity, timestamp, 100);
        expect(verdict.anomalyScore).toBe(0);
      }
    });
  });

  describe("Escalation Ladder", () => {
    it("should escalate through flag -> hold -> reject -> lockdown", () => {
      const identity = "identity-1";
      let timestamp = Date.now();

      // Build baseline
      for (let i = 0; i < 10; i++) {
        timestamp += 1000;
        monitor.recordAction(identity, timestamp, 100);
      }

      // Generate anomalies (concurrent actions trigger immediate high score)
      const escalationLevels: EscalationLevel[] = [];

      for (let i = 0; i < 5; i++) {
        timestamp += 50; // Within concurrency window
        const verdict = monitor.recordAction(identity, timestamp, 100);
        escalationLevels.push(verdict.escalationLevel);
      }

      // Should see progression in escalation
      expect(escalationLevels).toContain("lockdown");
    });

    it("should block actions during lockdown", () => {
      const identity = "identity-1";
      let timestamp = Date.now();

      // Trigger lockdown with consecutive concurrent actions
      for (let i = 0; i < 5; i++) {
        timestamp += 50;
        monitor.recordAction(identity, timestamp, 100);
      }

      const profile = monitor.getProfile(identity);
      expect(profile?.escalationLevel).toBe("lockdown");
      expect(profile?.lockdownExpiresAt).toBeDefined();

      // New action should be blocked
      timestamp += 1000;
      const verdict = monitor.recordAction(identity, timestamp, 100);
      expect(verdict.allowed).toBe(false);
      expect(verdict.escalationLevel).toBe("lockdown");
    });

    it("should release lockdown after expiry", () => {
      vi.useFakeTimers();
      const startTime = Date.now();

      const identity = "identity-1";
      let timestamp = startTime;

      // Trigger lockdown with concurrent actions
      for (let i = 0; i < 5; i++) {
        timestamp += 50; // Within concurrency window (100ms)
        monitor.recordAction(identity, timestamp, 100);
      }

      const profile1 = monitor.getProfile(identity);
      expect(profile1?.escalationLevel).toBe("lockdown");

      // Advance real time past lockdown (1000ms configured)
      vi.advanceTimersByTime(1500);

      // New action with timestamp well after lockdown should be allowed
      const newTimestamp = startTime + 2000; // 2 seconds after start
      const verdict = monitor.recordAction(identity, newTimestamp, 100);

      expect(verdict.allowed).toBe(true);
      expect(verdict.escalationLevel).toBe("normal");

      vi.useRealTimers();
    });

    it("should reset consecutive anomalies on normal action", () => {
      // Create a fresh monitor for this test to avoid state from other tests
      const freshMonitor = new TimingMonitor({
        concurrencyWindowMs: 100,
        baselineMinSamples: 5,
        flagThreshold: 0.5,
        holdThreshold: 0.7,
        rejectThreshold: 0.9,
        lockdownCount: 10, // Higher threshold so we don't hit lockdown
        lockdownDurationMs: 1000,
      });

      const identity = "identity-reset-test";
      let timestamp = Date.now();

      // Build baseline with well-spaced actions
      for (let i = 0; i < 10; i++) {
        timestamp += 1000; // 1 second between each
        freshMonitor.recordAction(identity, timestamp, 100);
      }

      // One concurrent action (anomaly)
      timestamp += 50; // Within concurrency window
      freshMonitor.recordAction(identity, timestamp, 100);

      const profile1 = freshMonitor.getProfile(identity);
      expect(profile1?.consecutiveAnomalies).toBeGreaterThan(0);

      // Normal action (well outside concurrency window)
      timestamp += 1000;
      freshMonitor.recordAction(identity, timestamp, 100);

      const profile2 = freshMonitor.getProfile(identity);
      expect(profile2?.consecutiveAnomalies).toBe(0);
    });
  });

  describe("getProfile()", () => {
    it("should return profile for tracked identity", () => {
      monitor.recordAction("identity-1", Date.now(), 100);

      const profile = monitor.getProfile("identity-1");

      expect(profile).toBeDefined();
      expect(profile?.identity).toBe("identity-1");
    });

    it("should return undefined for unknown identity", () => {
      const profile = monitor.getProfile("unknown");
      expect(profile).toBeUndefined();
    });
  });

  describe("getTrackedIdentities()", () => {
    it("should return all tracked identities", () => {
      let timestamp = Date.now();
      monitor.recordAction("identity-1", timestamp, 100);
      monitor.recordAction("identity-2", timestamp + 100, 100);
      monitor.recordAction("identity-3", timestamp + 200, 100);

      const identities = monitor.getTrackedIdentities();

      expect(identities).toContain("identity-1");
      expect(identities).toContain("identity-2");
      expect(identities).toContain("identity-3");
    });
  });

  describe("reset() / resetAll()", () => {
    it("should reset timing data for an identity", () => {
      monitor.recordAction("identity-1", Date.now(), 100);

      expect(monitor.getProfile("identity-1")).toBeDefined();

      monitor.reset("identity-1");

      expect(monitor.getProfile("identity-1")).toBeUndefined();
    });

    it("should reset all timing data", () => {
      let timestamp = Date.now();
      monitor.recordAction("identity-1", timestamp, 100);
      monitor.recordAction("identity-2", timestamp + 100, 100);

      monitor.resetAll();

      expect(monitor.getTrackedIdentities()).toHaveLength(0);
    });
  });

  describe("getStats()", () => {
    it("should return monitor statistics", () => {
      // Use a fresh monitor to avoid state pollution
      const freshMonitor = new TimingMonitor({
        concurrencyWindowMs: 100,
        baselineMinSamples: 5,
      });

      let timestamp = Date.now();

      // Record actions for multiple identities with proper spacing
      for (let i = 0; i < 5; i++) {
        timestamp += 1000; // 1 second between each (outside concurrency window)
        freshMonitor.recordAction("stats-identity-1", timestamp, 100);
      }

      for (let i = 0; i < 3; i++) {
        timestamp += 1000; // 1 second between each
        freshMonitor.recordAction("stats-identity-2", timestamp, 100);
      }

      const stats = freshMonitor.getStats();

      expect(stats.trackedIdentities).toBe(2);
      expect(stats.totalActions).toBe(8);
      expect(stats.lockedOutIdentities).toBe(0);
    });

    it("should count locked out identities", () => {
      const identity = "identity-1";
      let timestamp = Date.now();

      // Trigger lockdown
      for (let i = 0; i < 5; i++) {
        timestamp += 50;
        monitor.recordAction(identity, timestamp, 100);
      }

      const stats = monitor.getStats();
      expect(stats.lockedOutIdentities).toBe(1);
    });
  });

  describe("Latency Baseline", () => {
    it("should calculate mean latency correctly", () => {
      const identity = "identity-1";
      let timestamp = Date.now();

      // Record actions with known latencies
      const latencies = [100, 110, 90, 105, 95];
      for (const latency of latencies) {
        timestamp += 1000;
        monitor.recordAction(identity, timestamp, latency);
      }

      const profile = monitor.getProfile(identity);
      const expectedMean = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      expect(profile?.baselineLatencyMs.mean).toBeCloseTo(expectedMean, 1);
    });

    it("should calculate percentiles correctly", () => {
      const identity = "identity-1";
      let timestamp = Date.now();

      // Record many actions to get stable percentiles
      for (let i = 0; i < 100; i++) {
        timestamp += 1000;
        // Random latency between 50 and 150
        const latency = 50 + Math.random() * 100;
        monitor.recordAction(identity, timestamp, latency);
      }

      const profile = monitor.getProfile(identity);

      // P95 should be less than or equal to P99
      expect(profile?.baselineLatencyMs.p95).toBeLessThanOrEqual(
        profile?.baselineLatencyMs.p99 ?? Infinity,
      );

      // P95 should be greater than mean (for this distribution)
      expect(profile?.baselineLatencyMs.p95).toBeGreaterThan(profile?.baselineLatencyMs.mean);
    });
  });
});
