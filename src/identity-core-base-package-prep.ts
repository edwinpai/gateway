import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PrepareIdentityCoreBasePackageOptions {
  packageDir: string;
  outDir: string;
  companionPackagesRoot?: string;
  clean?: boolean;
}

export interface PrepareIdentityCoreBasePackageResult {
  packageDir: string;
  outDir: string;
  packageName: string;
  version: string;
  optionalDependencies: Record<string, string>;
}

type PackageJson = {
  name?: unknown;
  version?: unknown;
  optionalDependencies?: unknown;
};

export async function prepareIdentityCoreBasePackage(
  options: PrepareIdentityCoreBasePackageOptions,
): Promise<PrepareIdentityCoreBasePackageResult> {
  const packageDir = path.resolve(options.packageDir);
  const outDir = path.resolve(options.outDir);

  if (options.clean !== false) {
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(path.dirname(outDir), { recursive: true });
  await cp(packageDir, outDir, { recursive: true });

  const packageJsonPath = path.join(outDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJson;
  const packageName =
    typeof packageJson.name === "string" && packageJson.name.trim()
      ? packageJson.name.trim()
      : null;
  const version =
    typeof packageJson.version === "string" && packageJson.version.trim()
      ? packageJson.version.trim()
      : null;

  if (!packageName || !version) {
    throw new Error(`Invalid identity-core package.json at ${packageJsonPath}`);
  }

  const optionalDependencies = await collectCompanionOptionalDependencies({
    companionPackagesRoot: options.companionPackagesRoot,
    version,
  });

  const existingOptionalDependencies = normalizeOptionalDependencies(
    packageJson.optionalDependencies,
  );
  const mergedOptionalDependencies = {
    ...existingOptionalDependencies,
    ...optionalDependencies,
  };

  if (Object.keys(mergedOptionalDependencies).length > 0) {
    (packageJson as Record<string, unknown>).optionalDependencies = mergedOptionalDependencies;
  } else {
    delete (packageJson as Record<string, unknown>).optionalDependencies;
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

  return {
    packageDir,
    outDir,
    packageName,
    version,
    optionalDependencies: mergedOptionalDependencies,
  };
}

async function collectCompanionOptionalDependencies(params: {
  companionPackagesRoot?: string;
  version: string;
}): Promise<Record<string, string>> {
  if (!params.companionPackagesRoot) {
    return {};
  }

  const rootDir = path.resolve(params.companionPackagesRoot);
  const packageJsonPaths = await findPackageJsonFiles(rootDir).catch(() => []);
  const out: Record<string, string> = {};

  for (const packageJsonPath of packageJsonPaths) {
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJson;
    const packageName = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!packageName.startsWith("@edwinpai/identity-core-")) {
      continue;
    }
    out[packageName] = params.version;
  }

  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

async function findPackageJsonFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const out: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findPackageJsonFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name === "package.json") {
      out.push(fullPath);
    }
  }

  return out;
}

function normalizeOptionalDependencies(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      )
      .map(([name, version]) => [name.trim(), version.trim()])
      .filter(([name, version]) => name.length > 0 && version.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
