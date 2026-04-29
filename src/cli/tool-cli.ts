/**
 * `edwinpai tool` CLI — invoke gateway tools from any LLM CLI session.
 *
 * Commands:
 *   edwinpai tool list                     — list available tools
 *   edwinpai tool describe <tool>          — show tool schema
 *   edwinpai tool invoke <tool> [args...]  — invoke a tool (requires desktop approval if signing enabled)
 *
 * Security: tool invocations go through the gateway HTTP API which enforces
 * auth (token or BSV signature). When security.requireSignedRequests is true,
 * the gateway pushes an approval request to the connected desktop app and
 * waits for a signed response before executing.
 */

import type { Command } from "commander";
import { gatewayHttpFetch } from "../gateway/gateway-http-client.js";

export function registerToolCli(program: Command): void {
  const toolCmd = program
    .command("tool")
    .description("Invoke gateway tools (message, TTS, browser, canvas, cron, etc.)");

  toolCmd
    .command("list")
    .description("List available gateway tools")
    .action(async () => {
      try {
        const result = await gatewayHttpFetch("/tools/list", "GET");
        if (!result.ok) {
          const reason =
            result.status === 401 || result.status === 403
              ? "Gateway auth failed. Check gateway.auth.token / EDWINPAI_GATEWAY_TOKEN."
              : "Is the gateway running?";
          console.error(`Gateway returned ${result.status}. ${reason}`);
          process.exit(1);
        }
        const tools = (result.data as any)?.tools ?? result.data;
        if (Array.isArray(tools)) {
          for (const tool of tools) {
            const name = tool.name ?? tool;
            const desc = tool.description ? ` — ${tool.description}` : "";
            console.log(`${name}${desc}`);
          }
        } else {
          console.log(JSON.stringify(result.data, null, 2));
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  toolCmd
    .command("describe <tool>")
    .description("Show tool schema and parameters")
    .action(async (toolName: string) => {
      try {
        const result = await gatewayHttpFetch(
          `/tools/describe?tool=${encodeURIComponent(toolName)}`,
          "GET",
        );
        if (!result.ok) {
          console.error(`Tool not found or gateway error: ${JSON.stringify(result.data)}`);
          process.exit(1);
        }
        console.log(JSON.stringify(result.data, null, 2));
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  toolCmd
    .command("invoke <tool>")
    .description("Invoke a gateway tool")
    .option("-a, --action <action>", "Tool action (e.g. send, list, create)")
    .option("--args <json>", "Tool arguments as JSON string")
    .option("--to <target>", "Message target (shorthand for message tools)")
    .option("--text <text>", "Message text (shorthand for message tools)")
    .option("--session <key>", "Session key context")
    .option("--dry-run", "Validate without executing")
    .allowUnknownOption(true)
    .action(async (toolName: string, opts: Record<string, unknown>) => {
      try {
        // Build args from --args JSON or from individual flags
        let args: Record<string, unknown> = {};
        if (typeof opts.args === "string") {
          try {
            args = JSON.parse(opts.args);
          } catch {
            console.error("Invalid JSON in --args");
            process.exit(1);
          }
        }

        // Convenience shorthands
        if (opts.to) args.to = opts.to;
        if (opts.text) args.text = opts.text;

        const body: Record<string, unknown> = {
          tool: toolName,
          args,
        };
        if (opts.action) body.action = opts.action;
        if (opts.session) body.sessionKey = opts.session;
        if (opts.dryRun) body.dryRun = true;

        const result = await gatewayHttpFetch("/tools/invoke", "POST", body);

        if (!result.ok) {
          const errData = result.data as any;
          const message = errData?.error?.message ?? JSON.stringify(errData);
          console.error(`Tool invocation failed (${result.status}): ${message}`);
          process.exit(1);
        }

        // Output result as JSON for LLM consumption
        console.log(JSON.stringify(result.data, null, 2));
      } catch (err: any) {
        if (err.name === "AbortError") {
          console.error(
            "Tool invocation timed out (120s). The gateway may be waiting for desktop approval.",
          );
          process.exit(1);
        }
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}
