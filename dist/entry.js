#!/usr/bin/env node
import process$1 from "node:process";

//#region src/index.ts
const EDWINPAI_GATEWAY_CORE_PACKAGE = "@edwinpai/gateway-core";
async function loadGatewayCore() {
	return import(process.env.EDWINPAI_GATEWAY_CORE_PACKAGE ?? EDWINPAI_GATEWAY_CORE_PACKAGE);
}

//#endregion
//#region src/entry.ts
async function main() {
	const maybeRunCli = (await loadGatewayCore().catch((error) => {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`EdwinPAI protected gateway runtime is not installed. Expected compiled runtime package ${EDWINPAI_GATEWAY_CORE_PACKAGE}. Publish/install the protected runtime package before using this public wrapper. ${detail}`);
	})).runCli;
	if (typeof maybeRunCli !== "function") throw new Error(`Protected gateway runtime package ${EDWINPAI_GATEWAY_CORE_PACKAGE} does not export runCli(argv).`);
	await maybeRunCli(process$1.argv);
}
main().catch((error) => {
	console.error("[edwinpai]", error instanceof Error ? error.stack ?? error.message : error);
	process$1.exitCode = 1;
});

//#endregion
export {  };