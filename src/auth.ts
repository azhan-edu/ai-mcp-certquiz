import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const BEARER_PREFIX = /^bearer /i;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Requires `Authorization: Bearer <token>`. Missing, malformed and wrong tokens get the same 401.
 * Both sides are hashed first so the comparison is fixed-length and leaks no length information.
 */
export function bearerAuth(expectedToken: string): RequestHandler {
  const expected = digest(expectedToken);
  return (req, res, next) => {
    const header = req.headers.authorization;
    const provided =
      typeof header === "string" && BEARER_PREFIX.test(header)
        ? header.replace(BEARER_PREFIX, "")
        : "";
    // Compare unconditionally so a missing header costs the same as a wrong token.
    const matches = timingSafeEqual(digest(provided), expected);
    if (provided === "" || !matches) {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized." },
        id: null,
      });
      return;
    }
    next();
  };
}
