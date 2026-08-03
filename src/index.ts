import { Bridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import { logger } from "./logger.js";

const abortController = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info("Stopping bridge", { signal });
    abortController.abort();
  });
}

try {
  const config = await loadConfig();
  const bridge = new Bridge(config);
  const healthServer = startHealthServer(
    config.health.host,
    config.health.port,
    () => bridge.healthy,
  );
  abortController.signal.addEventListener("abort", () => healthServer.close(), { once: true });
  await bridge.run(abortController.signal);
} catch (error) {
  logger.error("Bridge terminated", {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exitCode = 1;
}
