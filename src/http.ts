import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
  type Response,
} from "express";
import type { Logger } from "pino";
import { createServer } from "./server.js";
import type { QuizService } from "./services/quiz.js";

const BODY_LIMIT = "100kb";

export interface AppDeps {
  service: QuizService;
  logger: Logger;
}

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/** Logs method, path, status and duration only: never bodies, headers or query strings. */
function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("close", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs,
          aborted: !res.writableFinished,
        },
        "request",
      );
    });
    next();
  };
}

/** Builds the Express app without listening. Middleware order: log, body parsing, routes, 404, errors. */
export function createApp({ service, logger }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogger(logger));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Extension point: authentication (F5.2) and Origin/Host checks (F5.3) go here, before the body parser on /mcp.
  app.post("/mcp", express.json({ limit: BODY_LIMIT }), async (req, res, next) => {
    const server = createServer(service);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch((err: unknown) => {
        logger.debug({ errName: errName(err) }, "transport close failed");
      });
      server.close().catch((err: unknown) => {
        logger.debug({ errName: errName(err) }, "server close failed");
      });
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  });

  const methodNotAllowed: RequestHandler = (_req, res) => {
    res.setHeader("Allow", "POST");
    jsonRpcError(res, 405, -32000, "Method not allowed.");
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const onError: ErrorRequestHandler = (err: unknown, req, res, _next) => {
    if (res.headersSent) {
      logger.error({ errName: errName(err) }, "error after headers sent");
      res.destroy();
      return;
    }
    if (isHttpError(err) && err.type === "entity.parse.failed") {
      jsonRpcError(res, 400, -32700, "Parse error.");
    } else if (isClientHttpError(err)) {
      jsonRpcError(res, err.status, -32600, "Invalid request.");
    } else {
      logger.error(
        { method: req.method, path: req.path, errName: errName(err) },
        "unhandled error",
      );
      jsonRpcError(res, 500, -32603, "Internal server error.");
    }
  };
  app.use(onError);

  return app;
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "UnknownError";
}

interface HttpErrorFields {
  type?: unknown;
  status?: unknown;
  expose?: unknown;
}

function isHttpError(err: unknown): err is HttpErrorFields {
  return typeof err === "object" && err !== null;
}

/** body-parser/http-errors 4xx errors that are safe to expose by status. */
function isClientHttpError(err: unknown): err is { status: number; expose: true } {
  return (
    isHttpError(err) &&
    typeof err.status === "number" &&
    err.status >= 400 &&
    err.status <= 499 &&
    err.expose === true
  );
}
