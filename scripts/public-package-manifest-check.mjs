#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const packagePath = path.join(root, "package.json");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(
      `cannot read JSON ${path.relative(root, filePath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectDeps(pkg) {
  const out = [];
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = pkg[section];
    if (!isObject(deps)) continue;
    for (const [name, spec] of Object.entries(deps)) {
      out.push({ section, name, spec: String(spec) });
    }
  }
  return out;
}

function checkNoWorkspaceDeps(pkg) {
  for (const dep of collectDeps(pkg)) {
    if (dep.spec.startsWith("workspace:")) {
      fail(`${dep.section}.${dep.name} uses workspace spec ${dep.spec}`);
    }
  }
}

function checkScripts(pkg) {
  if (!isObject(pkg.scripts)) {
    fail("scripts must be an object");
    return;
  }
  for (const [name, value] of Object.entries(pkg.scripts)) {
    if (typeof value !== "string") {
      fail(`scripts.${name} must be a string, got ${value === null ? "null" : typeof value}`);
    }
  }
  for (const forbidden of [
    "build:protected",
    "check:protected-cores",
    "release:check",
    "build:gateway",
    "ui:build",
  ]) {
    if (Object.hasOwn(pkg.scripts, forbidden)) {
      fail(`forbidden private script present: scripts.${forbidden}`);
    }
  }
  if (pkg.scripts.build !== "tsdown") {
    fail(
      `public wrapper build script must be exactly "tsdown", got ${JSON.stringify(pkg.scripts.build)}`,
    );
  }
}

function checkEntrypoints(pkg) {
  const files = [pkg.main, pkg.bin?.edwinpai, pkg.exports?.["."], pkg.exports?.["./cli-entry"]]
    .filter((value) => typeof value === "string")
    .map((value) => value.replace(/^\.\//, ""));
  for (const rel of files) {
    const sourceRel = rel.startsWith("dist/")
      ? rel.replace(/^dist\//, "src/").replace(/\.js$/, ".ts")
      : rel;
    if (!exists(rel) && !exists(sourceRel)) {
      fail(`entrypoint ${rel} missing; neither ${rel} nor ${sourceRel} exists`);
    }
  }
}

function checkWrapperShape(pkg) {
  if (pkg.name !== "@edwinpai/edwinpai") fail(`unexpected package name: ${pkg.name}`);
  if (pkg.private !== false) fail("public wrapper package must set private=false");
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const allowedFiles = new Set([
    "dist/",
    "edwinpai.mjs",
    "LICENSE",
    "README.md",
    "README-header.png",
  ]);
  for (const file of files) {
    if (!allowedFiles.has(file)) fail(`unexpected package files entry: ${file}`);
  }
  for (const required of allowedFiles) {
    if (!files.includes(required)) fail(`missing package files entry: ${required}`);
  }
  for (const forbiddenField of ["pnpm", "vitest", "typesVersions"]) {
    if (Object.hasOwn(pkg, forbiddenField)) {
      fail(`forbidden private/dev manifest field present: ${forbiddenField}`);
    }
  }
  for (const requiredDep of [
    "@edwinpai/gateway-core",
    "@edwinpai/identity-core",
    "@edwinpai/shad-core",
  ]) {
    if (pkg.dependencies?.[requiredDep] !== "1.0.0-beta.3") {
      fail(`dependencies.${requiredDep} must be 1.0.0-beta.3`);
    }
  }
  if (exists("packages")) fail("public wrapper export must not include packages/");
  if (exists("pnpm-workspace.yaml"))
    fail("public wrapper export must not include pnpm-workspace.yaml");
  if (exists("pnpm-lock.yaml"))
    fail("public wrapper export must not include stale private pnpm-lock.yaml");
}

const pkg = readJson(packagePath);
if (pkg) {
  checkNoWorkspaceDeps(pkg);
  checkScripts(pkg);
  checkEntrypoints(pkg);
  checkWrapperShape(pkg);
}

if (failures.length > 0) {
  console.error(`public package manifest check failed for ${root}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`public package manifest check passed: ${root}`);
