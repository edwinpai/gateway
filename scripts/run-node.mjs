#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const env = { ...process.env };
const cwd = process.cwd();
const compiler = "tsdown";

const distRoot = path.join(cwd, "dist");
const distEntry = path.join(distRoot, "/entry.js");
const buildStampPath = path.join(distRoot, ".buildstamp");
const srcRoot = path.join(cwd, "src");
const configFiles = [path.join(cwd, "tsconfig.json"), path.join(cwd, "package.json")];
const protectedWorkspacePackages = [
  { name: "@edwinpai/identity-core", dir: path.join(cwd, "packages", "identity-core") },
  { name: "@edwinpai/shad-core", dir: path.join(cwd, "packages", "shad-core") },
];

const statMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
};

const isExcludedSource = (filePath) => {
  const relativePath = path.relative(srcRoot, filePath);
  if (relativePath.startsWith("..")) {
    return false;
  }
  return (
    relativePath.endsWith(".test.ts") ||
    relativePath.endsWith(".test.tsx") ||
    relativePath.endsWith(`test-helpers.ts`)
  );
};

const findLatestMtime = (dirPath, shouldSkip) => {
  let latest = null;
  const queue = [dirPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (shouldSkip?.(fullPath)) {
        continue;
      }
      const mtime = statMtime(fullPath);
      if (mtime == null) {
        continue;
      }
      if (latest == null || mtime > latest) {
        latest = mtime;
      }
    }
  }
  return latest;
};

const shouldBuild = () => {
  if ((env.EDWINPAI_FORCE_BUILD ?? env.EDWIN_FORCE_BUILD) === "1") {
    return true;
  }
  const stampMtime = statMtime(buildStampPath);
  if (stampMtime == null) {
    return true;
  }
  if (statMtime(distEntry) == null) {
    return true;
  }

  for (const workspacePackage of protectedWorkspacePackages) {
    const packageJson = path.join(workspacePackage.dir, "package.json");
    const distIndex = path.join(workspacePackage.dir, "dist", "index.js");
    if (statMtime(packageJson) != null && statMtime(distIndex) == null) {
      return true;
    }
  }

  for (const filePath of configFiles) {
    const mtime = statMtime(filePath);
    if (mtime != null && mtime > stampMtime) {
      return true;
    }
  }

  const srcMtime = findLatestMtime(srcRoot, isExcludedSource);
  if (srcMtime != null && srcMtime > stampMtime) {
    return true;
  }
  return false;
};

const logRunner = (message) => {
  if ((env.EDWINPAI_RUNNER_LOG ?? env.EDWIN_RUNNER_LOG) === "0") {
    return;
  }
  process.stderr.write(`[edwinpai] ${message}\n`);
};

const runNode = () => {
  const nodeProcess = spawn(process.execPath, ["edwinpai.mjs", ...args], {
    cwd,
    env,
    stdio: "inherit",
  });

  nodeProcess.on("exit", (exitCode, exitSignal) => {
    if (exitSignal) {
      process.exit(1);
    }
    process.exit(exitCode ?? 1);
  });
};

const writeBuildStamp = () => {
  try {
    fs.mkdirSync(distRoot, { recursive: true });
    fs.writeFileSync(buildStampPath, `${Date.now()}\n`);
  } catch (error) {
    // Best-effort stamp; still allow the runner to start.
    logRunner(`Failed to write build stamp: ${error?.message ?? "unknown error"}`);
  }
};

if (!shouldBuild()) {
  runNode();
} else {
  logRunner("Building TypeScript (dist is stale).");
  const buildSteps = [
    ...protectedWorkspacePackages
      .filter(
        (workspacePackage) => statMtime(path.join(workspacePackage.dir, "package.json")) != null,
      )
      .map((workspacePackage) => ({
        label: `Building ${workspacePackage.name}`,
        args: ["--dir", workspacePackage.dir, "build"],
      })),
    { label: "Building gateway runtime", args: ["exec", compiler] },
  ];

  const runBuildStep = (index = 0) => {
    const step = buildSteps[index];
    if (!step) {
      writeBuildStamp();
      runNode();
      return;
    }

    logRunner(`${step.label}.`);
    const buildCmd = process.platform === "win32" ? "cmd.exe" : "pnpm";
    const buildArgs =
      process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...step.args] : step.args;
    const build = spawn(buildCmd, buildArgs, {
      cwd,
      env,
      stdio: "inherit",
    });

    build.on("exit", (code, signal) => {
      if (signal) {
        process.exit(1);
      }
      if (code !== 0 && code !== null) {
        process.exit(code);
      }
      runBuildStep(index + 1);
    });
  };

  runBuildStep();
}
