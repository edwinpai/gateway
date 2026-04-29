import { readFile } from "node:fs/promises";
import path from "node:path";
import { prepareIdentityCorePlatformPackages } from "../src/identity-core-platform-package-prep.js";

interface CliArgs {
  stagingDir?: string;
  outDir?: string;
  version?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.stagingDir || !args.outDir) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const version = args.version ?? (await readIdentityCoreVersion());
  const result = await prepareIdentityCorePlatformPackages({
    stagingDir: path.resolve(args.stagingDir),
    outDir: path.resolve(args.outDir),
    version,
  });

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        stagingDir: result.stagingDir,
        outDir: result.outDir,
        version: result.version,
        preparedPackageCount: result.preparedPackages.length,
        preparedPackages: result.preparedPackages.map((pkg) => ({
          runtimeTriple: pkg.runtimeTriple,
          packageName: pkg.packageName,
          packageDir: pkg.packageDir,
        })),
        skippedRuntimeTriples: result.skippedRuntimeTriples,
      },
      null,
      2,
    ) + "\n",
  );
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--staging-dir") {
      out.stagingDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      out.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--version") {
      out.version = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function readIdentityCoreVersion(): Promise<string> {
  const packageJsonPath = path.resolve("packages/identity-core/package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`packages/identity-core/package.json is missing a string version`);
  }
  return parsed.version;
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: node --import tsx scripts/prepare-identity-core-platform-packages.ts --staging-dir <dir> --out-dir <dir> [--version <semver>]",
      "",
      "Prepares companion @edwinpai/identity-core platform-package directories only for truthful staged identity-core.node addons.",
    ].join("\n") + "\n",
  );
}

await main();
