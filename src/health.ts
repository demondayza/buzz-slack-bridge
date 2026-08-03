import { createServer, type Server } from "node:http";
import { logger } from "./logger.js";

export function startHealthServer(host: string, port: number, isReady: () => boolean): Server {
  const server = createServer((request, response) => {
    if (request.url === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url === "/readyz") {
      const ready = isReady();
      response.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: ready ? "ready" : "not_ready" }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(port, host, () => logger.info("Health server listening", { host, port }));
  return server;
}
