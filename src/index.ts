export const EDWINPAI_PUBLIC_WRAPPER_VERSION = "1.0.0-beta.6";
export const EDWINPAI_GATEWAY_CORE_PACKAGE = "@edwinpai/gateway-core";

export async function loadGatewayCore(): Promise<unknown> {
  const packageName = process.env.EDWINPAI_GATEWAY_CORE_PACKAGE ?? EDWINPAI_GATEWAY_CORE_PACKAGE;
  return import(packageName);
}
