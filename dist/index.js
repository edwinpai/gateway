//#region src/index.ts
const EDWINPAI_PUBLIC_WRAPPER_VERSION = "1.0.0-beta.4";
const EDWINPAI_GATEWAY_CORE_PACKAGE = "@edwinpai/gateway-core";
async function loadGatewayCore() {
	return import(process.env.EDWINPAI_GATEWAY_CORE_PACKAGE ?? EDWINPAI_GATEWAY_CORE_PACKAGE);
}

//#endregion
export { EDWINPAI_GATEWAY_CORE_PACKAGE, EDWINPAI_PUBLIC_WRAPPER_VERSION, loadGatewayCore };