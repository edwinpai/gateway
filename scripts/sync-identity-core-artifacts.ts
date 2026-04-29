import path from "node:path";
import { stageIdentityCoreArtifacts } from "../src/identity-core-artifact-sync.js";

interface CliArgs {
  sourceDir?: string;
  outDir?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sourceDir || !args.outDir) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const result = await stageIdentityCoreArtifacts({
    sourceDir: path.resolve(args.sourceDir),
    outDir: path.resolve(args.outDir),
  });

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        outDir: result.outDir,
        manifestPath: result.manifestPath,
        artifactCount: result.artifacts.length,
        packageTriples: result.artifacts.map((artifact) => artifact.packageTriple),
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
    if (arg === "--source-dir") {
      out.sourceDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      out.outDir = argv[i + 1];
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
      "Usage: node --import tsx scripts/sync-identity-core-artifacts.ts --source-dir <dir> --out-dir <dir>",
      "",
      "Normalizes staged identity-core shared-library bundles into the consumer-side staging layout.",
    ].join("\n") + "\n",
  );
}

await main();
