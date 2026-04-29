import path from "node:path";
import { prepareIdentityCoreBasePackage } from "../src/identity-core-base-package-prep.js";

interface CliArgs {
  packageDir?: string;
  outDir?: string;
  companionPackagesRoot?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.packageDir || !args.outDir) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const result = await prepareIdentityCoreBasePackage({
    packageDir: path.resolve(args.packageDir),
    outDir: path.resolve(args.outDir),
    companionPackagesRoot: args.companionPackagesRoot
      ? path.resolve(args.companionPackagesRoot)
      : undefined,
  });

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        packageDir: result.packageDir,
        outDir: result.outDir,
        packageName: result.packageName,
        version: result.version,
        optionalDependencyCount: Object.keys(result.optionalDependencies).length,
        optionalDependencies: result.optionalDependencies,
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
    if (arg === "--package-dir") {
      out.packageDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      out.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--companion-packages-root") {
      out.companionPackagesRoot = argv[i + 1];
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

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: node --import tsx scripts/prepare-identity-core-base-package.ts --package-dir <dir> --out-dir <dir> [--companion-packages-root <dir>]",
      "",
      "Copies packages/identity-core to a temp publish directory and injects truthful optionalDependencies only for prepared companion packages that actually exist.",
    ].join("\n") + "\n",
  );
}

await main();
