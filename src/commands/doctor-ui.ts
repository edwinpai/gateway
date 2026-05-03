import { note } from "@clack/prompts";
import type { RuntimeEnv } from "../runtime.js";
import type { DoctorPrompter } from "./doctor-prompter.js";

export async function maybeRepairUiProtocolFreshness(
  _runtime: RuntimeEnv,
  _prompter: DoctorPrompter,
): Promise<void> {
  // The legacy browser Control UI has been removed. Desktop is the sole UI.
}

export async function doctorUi(): Promise<void> {
  note(
    "Legacy browser Control UI has been removed. Use the Edwin Desktop app as the sole UI.",
    "UI",
  );
}
