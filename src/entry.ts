#!/usr/bin/env node
import process from "node:process";
import { loadGatewayCore, EDWINPAI_GATEWAY_CORE_PACKAGE } from "./index.js";

async function main() {
  const runtime = await loadGatewayCore().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `EdwinPAI protected gateway runtime is not installed. Expected compiled runtime package ${EDWINPAI_GATEWAY_CORE_PACKAGE}. ` +
        `Publish/install the protected runtime package before using this public wrapper. ${detail}`,
    );
  });
  const maybeRunCli = (runtime as { runCli?: (argv: string[]) => unknown }).runCli;
  if (typeof maybeRunCli !== "function") {
    throw new Error(`Protected gateway runtime package ${EDWINPAI_GATEWAY_CORE_PACKAGE} does not export runCli(argv).`);
  }
  await maybeRunCli(process.argv);
}

main().catch((error) => {
  console.error("[edwinpai]", error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
