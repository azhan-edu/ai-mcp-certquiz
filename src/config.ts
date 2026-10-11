import { z } from "zod";
import { ConfigError } from "./lib/errors.js";

const envSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_AUTH_TOKEN: z.string({ error: "is required" }).trim().min(1, "must not be empty"),
  DB_PATH: z.string().trim().min(1).default("data/certquiz.db"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface Config {
  host: string;
  port: number;
  authToken: string;
  dbPath: string;
  logLevel: z.infer<typeof envSchema>["LOG_LEVEL"];
}

/** Parses env into a typed config. Error messages never include values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "env"}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }
  const e = result.data;
  return {
    host: e.HOST,
    port: e.PORT,
    authToken: e.MCP_AUTH_TOKEN,
    dbPath: e.DB_PATH,
    logLevel: e.LOG_LEVEL,
  };
}

/** For scripts that only need the database (db:seed): no auth token required. */
export function loadDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const result = envSchema.pick({ DB_PATH: true }).safeParse(env);
  if (!result.success) {
    throw new ConfigError("Invalid configuration:\n  - DB_PATH: must not be empty");
  }
  return result.data.DB_PATH;
}

/** For src/index.ts: loads config or prints the message to stderr and exits 1. */
export function loadConfigOrExit(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    return loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}
