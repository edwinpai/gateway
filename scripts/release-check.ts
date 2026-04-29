#!/usr/bin/env -S node --import tsx

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type PackFile = { path: string };
type PackResult = { files?: PackFile[] };

type ReleasePackRule = {
  label: string;
  cwd?: string;
  requiredPaths: string[];
  forbiddenPrefixes?: string[];
  forbiddenPaths?: string[];
  packageJsonPath?: string;
  packageJsonChecks?: Array<{
    field: string;
    validate: (value: unknown) => string | null;
  }>;
};

const releasePackRules: ReleasePackRule[] = [
  {
    label: "root package",
    requiredPaths: [
      "dist/index.js",
      "dist/entry.js",
      "dist/plugin-sdk/index.js",
      "dist/plugin-sdk/index.d.ts",
      "dist/build-info.json",
    ],
    forbiddenPrefixes: ["dist/EdwinPAI.app/"],
  },
  {
    label: "@edwinpai/shad-core",
    cwd: resolve("packages/shad-core"),
    packageJsonPath: resolve("packages/shad-core/package.json"),
    requiredPaths: ["README.md", "package.json", "dist/index.js", "dist/index.d.ts"],
    forbiddenPrefixes: ["src/"],
    forbiddenPaths: ["tsconfig.json"],
    packageJsonChecks: [
      {
        field: "main",
        validate: (value) =>
          value === "dist/index.js"
            ? null
            : `expected main to be \"dist/index.js\", got ${JSON.stringify(value)}`,
      },
      {
        field: "types",
        validate: (value) =>
          value === "dist/index.d.ts"
            ? null
            : `expected types to be \"dist/index.d.ts\", got ${JSON.stringify(value)}`,
      },
      {
        field: "exports",
        validate: (value) => {
          if (typeof value !== "object" || value === null) {
            return `expected exports to be an object, got ${JSON.stringify(value)}`;
          }
          const entry = (value as Record<string, unknown>)["."];
          if (entry !== "./dist/index.js") {
            return `expected exports["."] to be "./dist/index.js", got ${JSON.stringify(entry)}`;
          }
          return null;
        },
      },
    ],
  },
  {
    label: "@edwinpai/identity-core",
    cwd: resolve("packages/identity-core"),
    packageJsonPath: resolve("packages/identity-core/package.json"),
    requiredPaths: [
      "README.md",
      "package.json",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/native-loader.js",
      "dist/node-binding.js",
      "dist/types.d.ts",
    ],
    forbiddenPrefixes: ["src/"],
    forbiddenPaths: ["tsconfig.json"],
    packageJsonChecks: [
      {
        field: "main",
        validate: (value) =>
          value === "dist/index.js"
            ? null
            : `expected main to be \"dist/index.js\", got ${JSON.stringify(value)}`,
      },
      {
        field: "types",
        validate: (value) =>
          value === "dist/index.d.ts"
            ? null
            : `expected types to be \"dist/index.d.ts\", got ${JSON.stringify(value)}`,
      },
      {
        field: "exports",
        validate: (value) => {
          if (typeof value !== "object" || value === null) {
            return `expected exports to be an object, got ${JSON.stringify(value)}`;
          }
          const entry = (value as Record<string, unknown>)["."];
          if (entry !== "./dist/index.js") {
            return `expected exports[\".\"] to be \"./dist/index.js\", got ${JSON.stringify(entry)}`;
          }
          return null;
        },
      },
    ],
  },
];

type PackageJson = {
  name?: string;
  version?: string;
  main?: string;
  types?: string;
  exports?: unknown;
};

function runPackDry(cwd?: string): PackResult[] {
  const raw = execSync("npm pack --dry-run --json --ignore-scripts", {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 100,
  });
  return JSON.parse(raw) as PackResult[];
}

function checkPluginVersions() {
  const rootPackagePath = resolve("package.json");
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8")) as PackageJson;
  const targetVersion = rootPackage.version;

  if (!targetVersion) {
    console.error("release-check: root package.json missing version.");
    process.exit(1);
  }

  const extensionsDir = resolve("extensions");
  const entries = readdirSync(extensionsDir, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );

  const mismatches: string[] = [];

  for (const entry of entries) {
    const packagePath = join(extensionsDir, entry.name, "package.json");
    let pkg: PackageJson;
    try {
      pkg = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;
    } catch {
      continue;
    }

    if (!pkg.name || !pkg.version) {
      continue;
    }

    if (pkg.version !== targetVersion) {
      mismatches.push(`${pkg.name} (${pkg.version})`);
    }
  }

  if (mismatches.length > 0) {
    console.error(`release-check: plugin versions must match ${targetVersion}:`);
    for (const item of mismatches) {
      console.error(`  - ${item}`);
    }
    console.error("release-check: run `pnpm plugins:sync` to align plugin versions.");
    process.exit(1);
  }
}

function checkPackRule(rule: ReleasePackRule) {
  const results = runPackDry(rule.cwd);
  const files = results.flatMap((entry) => entry.files ?? []);
  const paths = new Set(files.map((file) => file.path));

  const missing = rule.requiredPaths.filter((path) => !paths.has(path));
  const forbidden = [...paths].filter(
    (path) =>
      rule.forbiddenPrefixes?.some((prefix) => path.startsWith(prefix)) ||
      rule.forbiddenPaths?.includes(path),
  );

  const packageJsonProblems: string[] = [];
  if (rule.packageJsonPath && rule.packageJsonChecks) {
    const pkg = JSON.parse(readFileSync(rule.packageJsonPath, "utf8")) as PackageJson;
    for (const check of rule.packageJsonChecks) {
      const problem = check.validate(pkg[check.field as keyof PackageJson]);
      if (problem) {
        packageJsonProblems.push(`${check.field}: ${problem}`);
      }
    }
  }

  if (missing.length > 0 || forbidden.length > 0 || packageJsonProblems.length > 0) {
    if (missing.length > 0) {
      console.error(`release-check: missing files in ${rule.label} npm pack:`);
      for (const path of missing) {
        console.error(`  - ${path}`);
      }
    }
    if (forbidden.length > 0) {
      console.error(`release-check: forbidden files in ${rule.label} npm pack:`);
      for (const path of forbidden) {
        console.error(`  - ${path}`);
      }
    }
    if (packageJsonProblems.length > 0) {
      console.error(`release-check: invalid package.json publish surface for ${rule.label}:`);
      for (const problem of packageJsonProblems) {
        console.error(`  - ${problem}`);
      }
    }
    process.exit(1);
  }

  console.log(`release-check: ${rule.label} npm pack contents look OK.`);
}

export function isNativeIdentityCoreRequired(envValue: string | undefined): boolean {
  if (envValue === undefined) return false;
  if (envValue === "" || envValue === "0") return false;
  if (envValue.toLowerCase() === "false") return false;
  return true;
}

export function findBundledNativeAddons(packPaths: readonly string[]): string[] {
  return packPaths.filter((p) => /^native\/[^/]+\/identity-core\.node$/.test(p));
}

/**
 * When EDWINPAI_REQUIRE_NATIVE_IDENTITY_CORE is set to a truthy value, the
 * @edwinpai/identity-core npm pack must include at least one bundled
 * native addon at `native/<triple>/identity-core.node`. This is the
 * launch gate for production deployments that refuse to ship without a
 * protected native binding. It does NOT run by default, since the truthful
 * current state of the build origin is shared-library staging only.
 */
function checkNativeIdentityCoreStrictMode() {
  if (!isNativeIdentityCoreRequired(process.env.EDWINPAI_REQUIRE_NATIVE_IDENTITY_CORE)) {
    return;
  }

  const cwd = resolve("packages/identity-core");
  const results = runPackDry(cwd);
  const paths = results.flatMap((entry) => entry.files ?? []).map((file) => file.path);
  const nativeAddons = findBundledNativeAddons(paths);

  if (nativeAddons.length === 0) {
    console.error(
      "release-check: EDWINPAI_REQUIRE_NATIVE_IDENTITY_CORE is set but @edwinpai/identity-core npm pack contains no native/<triple>/identity-core.node entry.",
    );
    console.error(
      "release-check: stage protected native artifacts into packages/identity-core/native/<triple>/ before launch, or unset the flag.",
    );
    process.exit(1);
  }

  console.log(
    `release-check: @edwinpai/identity-core ships ${nativeAddons.length} bundled native addon(s):`,
  );
  for (const path of nativeAddons) {
    console.log(`  - ${path}`);
  }
}

function main() {
  checkPluginVersions();

  for (const rule of releasePackRules) {
    checkPackRule(rule);
  }

  checkNativeIdentityCoreStrictMode();
}

const isInvokedDirectly =
  typeof process.argv[1] === "string" && /release-check\.ts$/.test(process.argv[1]);
if (isInvokedDirectly) {
  main();
}
