import pino, { type Logger } from "pino";

export const REDACT_PATHS = [
  "authorization",
  "token",
  "authToken",
  "MCP_AUTH_TOKEN",
  "config.authToken",
  "req.headers.authorization",
  "headers.authorization",
  "*.authorization",
  "*.token",
  "*.authToken",
  "*.MCP_AUTH_TOKEN",
];

export function createLogger(
  level = "info",
  destination: pino.DestinationStream = pino.destination(2),
): Logger {
  return pino({ level, redact: REDACT_PATHS }, destination);
}
