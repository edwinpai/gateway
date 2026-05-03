import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";

type DashboardOptions = {
  noOpen?: boolean;
};

export async function dashboardCommand(
  runtime: RuntimeEnv = defaultRuntime,
  _options: DashboardOptions = {},
) {
  runtime.log(
    "Legacy browser dashboard has been removed. Use the Edwin Desktop app as the sole UI.",
  );
}
