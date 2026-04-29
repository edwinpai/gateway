import type { EdwinPAIPluginApi } from "@edwinpai/edwinpai/plugin-sdk";
import { emptyPluginConfigSchema } from "@edwinpai/edwinpai/plugin-sdk";
import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: EdwinPAIPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;
