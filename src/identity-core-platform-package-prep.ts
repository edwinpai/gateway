import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

interface CompanionPlatformPackageDefinition {
  runtimeTriple: string;
  packageSuffix: string;
  os: NodeJS.Platform;
  cpu: "x64" | "arm64";
  libc?: "glibc";
}

export interface PreparedIdentityCorePlatformPackage {
  runtimeTriple: string;
  packageName: string;
  packageDir: string;
  nodeFilePath: string;
  manifestPath: string;
  os: string[];
  cpu: string[];
  libc?: string[];
}

export interface PrepareIdentityCorePlatformPackagesOptions {
  stagingDir: string;
  outDir: string;
  version: string;
  clean?: boolean;
}

export interface PrepareIdentityCorePlatformPackagesResult {
  stagingDir: string;
  outDir: string;
  version: string;
  preparedPackages: PreparedIdentityCorePlatformPackage[];
  skippedRuntimeTriples: string[];
}

const COMPANION_SCOPE = "@edwinpai";
const COMPANION_NAME_PREFIX = "identity-core";
const LOADABLE_NATIVE_FILE = "identity-core.node";
const STAGED_MANIFEST_FILE = "identity-core-artifact.json";

const COMPANION_PLATFORM_DEFINITIONS: CompanionPlatformPackageDefinition[] = [
  {
    runtimeTriple: "darwin-arm64",
    packageSuffix: "darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    runtimeTriple: "darwin-x64",
    packageSuffix: "darwin-x64",
    os: "darwin",
    cpu: "x64",
  },
  {
    runtimeTriple: "linux-arm64",
    packageSuffix: "linux-arm64-gnu",
    os: "linux",
    cpu: "arm64",
    libc: "glibc",
  },
  {
    runtimeTriple: "linux-x64",
    packageSuffix: "linux-x64-gnu",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
  },
  {
    runtimeTriple: "win32-x64",
    packageSuffix: "win32-x64-msvc",
    os: "win32",
    cpu: "x64",
  },
];

const COMPANION_PLATFORM_DEFINITION_BY_RUNTIME_TRIPLE = new Map(
  COMPANION_PLATFORM_DEFINITIONS.map((definition) => [definition.runtimeTriple, definition]),
);

export function getIdentityCoreCompanionPlatformDefinition(runtimeTriple: string) {
  const definition = COMPANION_PLATFORM_DEFINITION_BY_RUNTIME_TRIPLE.get(runtimeTriple);
  if (!definition) {
    throw new Error(`Unsupported identity-core runtime triple: ${runtimeTriple}`);
  }
  return definition;
}

export function getIdentityCoreCompanionPackageName(runtimeTriple: string): string {
  return `${COMPANION_SCOPE}/${COMPANION_NAME_PREFIX}-${getIdentityCoreCompanionPlatformDefinition(runtimeTriple).packageSuffix}`;
}

export async function prepareIdentityCorePlatformPackages(
  options: PrepareIdentityCorePlatformPackagesOptions,
): Promise<PrepareIdentityCorePlatformPackagesResult> {
  const stagingDir = path.resolve(options.stagingDir);
  const outDir = path.resolve(options.outDir);

  if (options.clean !== false) {
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  const stagedEntries = await readdir(stagingDir, { withFileTypes: true }).catch((error) => {
    throw new Error(
      `Failed to read identity-core staging dir ${stagingDir}: ${formatError(error)}`,
    );
  });

  const runtimeTripleDirs = stagedEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const preparedPackages: PreparedIdentityCorePlatformPackage[] = [];
  const skippedRuntimeTriples: string[] = [];

  for (const runtimeTriple of runtimeTripleDirs) {
    const tripleDir = path.join(stagingDir, runtimeTriple);
    const nodeFilePath = path.join(tripleDir, LOADABLE_NATIVE_FILE);
    const manifestPath = path.join(tripleDir, STAGED_MANIFEST_FILE);

    const hasNodeFile = await isFile(nodeFilePath);
    if (!hasNodeFile) {
      skippedRuntimeTriples.push(runtimeTriple);
      continue;
    }

    const hasManifestFile = await isFile(manifestPath);
    if (!hasManifestFile) {
      throw new Error(
        `Staged identity-core addon ${nodeFilePath} is missing sibling ${STAGED_MANIFEST_FILE}`,
      );
    }

    const definition = getIdentityCoreCompanionPlatformDefinition(runtimeTriple);
    const packageName = getIdentityCoreCompanionPackageName(runtimeTriple);
    const packageDir = path.join(outDir, packageName.replace("@", "").replaceAll("/", path.sep));

    await mkdir(packageDir, { recursive: true });
    await cp(nodeFilePath, path.join(packageDir, LOADABLE_NATIVE_FILE));
    await cp(manifestPath, path.join(packageDir, STAGED_MANIFEST_FILE));

    const packageJson = {
      name: packageName,
      version: options.version,
      private: false,
      os: [definition.os],
      cpu: [definition.cpu],
      ...(definition.libc ? { libc: [definition.libc] } : {}),
      main: LOADABLE_NATIVE_FILE,
      files: [LOADABLE_NATIVE_FILE, STAGED_MANIFEST_FILE],
    };

    await writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify(packageJson, null, 2) + "\n",
      "utf8",
    );

    preparedPackages.push({
      runtimeTriple,
      packageName,
      packageDir,
      nodeFilePath: path.join(packageDir, LOADABLE_NATIVE_FILE),
      manifestPath: path.join(packageDir, STAGED_MANIFEST_FILE),
      os: packageJson.os,
      cpu: packageJson.cpu,
      ...(packageJson.libc ? { libc: packageJson.libc } : {}),
    });
  }

  return {
    stagingDir,
    outDir,
    version: options.version,
    preparedPackages,
    skippedRuntimeTriples,
  };
}

async function isFile(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null);
  return fileStat?.isFile() ?? false;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
