import type { Server as HttpServer } from "node:http";
import { GatewayLockError } from "../../infra/gateway-lock.js";

export async function listenGatewayHttpServer(params: {
  httpServer: HttpServer;
  bindHost: string;
  port: number;
}) {
  const { httpServer, bindHost, port } = params;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        httpServer.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);

      // If we bind to ::1 as an alias for loopback, force IPv6-only so it doesn't
      // also claim the IPv4 port via dual-stack and collide with 127.0.0.1.
      if (bindHost === "::1") {
        httpServer.listen({ port, host: bindHost, ipv6Only: true });
      } else {
        httpServer.listen(port, bindHost);
      }
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      throw new GatewayLockError(
        `another gateway instance is already listening on ws://${bindHost}:${port}`,
        err,
      );
    }
    throw new GatewayLockError(
      `failed to bind gateway socket on ws://${bindHost}:${port}: ${String(err)}`,
      err,
    );
  }
}
