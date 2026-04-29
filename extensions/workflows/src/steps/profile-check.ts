/**
 * Profile freshness check for workflow steps.
 * Scans profile files and warns when they're stale (not updated recently).
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";

const DEFAULT_STALE_DAYS = 7;
const PROFILES_DIR = path.join(os.homedir(), ".edwinpai/workspace/memory/peers");

export interface ProfileStatus {
  name: string;
  path: string;
  lastModified: Date;
  ageDays: number;
  isStale: boolean;
}

/**
 * Check freshness of all profile files in the peers directory.
 * Returns status for each profile found.
 */
export async function checkProfileFreshness(
  staleDays: number = DEFAULT_STALE_DAYS,
  profilesDir: string = PROFILES_DIR,
): Promise<ProfileStatus[]> {
  const results: ProfileStatus[] = [];
  const now = Date.now();

  try {
    const peers = await fs.readdir(profilesDir);
    for (const peer of peers) {
      const profilePath = path.join(profilesDir, peer, "profile.md");
      try {
        const stat = await fs.stat(profilePath);
        const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        results.push({
          name: peer,
          path: profilePath,
          lastModified: stat.mtime,
          ageDays: Math.round(ageDays * 10) / 10,
          isStale: ageDays > staleDays,
        });
      } catch {
        // Profile doesn't exist for this peer — skip
      }
    }
  } catch {
    // Profiles directory doesn't exist
  }

  return results;
}

/**
 * Generate a staleness warning string for use in LLM prompts.
 * Returns empty string if all profiles are fresh.
 */
export async function getStaleProfileWarning(
  staleDays: number = DEFAULT_STALE_DAYS,
): Promise<string> {
  const profiles = await checkProfileFreshness(staleDays);
  const stale = profiles.filter((p) => p.isStale);

  if (stale.length === 0) return "";

  const warnings = stale.map(
    (p) =>
      `- ${p.name}: last updated ${p.ageDays} days ago (${p.lastModified.toISOString().split("T")[0]})`,
  );

  return [
    "WARNING: The following profiles may contain outdated information:",
    ...warnings,
    "Verify key details (location, schedule, events) before generating personalized messages.",
  ].join("\n");
}
