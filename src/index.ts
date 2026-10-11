#!/usr/bin/env node
import { loadConfigOrExit } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { createRepository } from "./db/repository.js";
import { createApp } from "./http.js";
import { createLogger } from "./lib/logger.js";
import { createQuizService } from "./services/quiz.js";

const config = loadConfigOrExit();
const logger = createLogger(config.logLevel);

let db: ReturnType<typeof openDatabase>;
try {
  db = openDatabase(config.dbPath, { readOnly: true });
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : "Cannot open database"}\n`);
  process.exit(1);
}

const service = createQuizService(createRepository(db));
const app = createApp({ service, logger });

const httpServer = app.listen(config.port, config.host, (err?: Error) => {
  if (err) return; // bind failure is reported by the "error" handler below
  logger.info({ host: config.host, port: config.port }, "certquiz listening");
});

httpServer.on("error", (err) => {
  logger.fatal({ errName: err.name, code: "code" in err ? err.code : undefined }, "server error");
  db.close();
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const forceTimer = setTimeout(() => {
    httpServer.closeAllConnections();
    db.close();
    process.exit(1);
  }, 10_000);
  forceTimer.unref();
  httpServer.close((err) => {
    if (err) logger.error({ errName: err.name }, "close failed");
    db.close();
    process.exit(err ? 1 : 0);
  });
  httpServer.closeIdleConnections();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
