import { ErrorRequestHandler, RequestHandler } from "express";
import {
  QuotaExhaustedError,
  UpstreamThrottledError,
  UpstreamUnavailableError,
  UpstreamDataError,
} from "../services/massive";
import { CorsError } from "../config/cors";

/* ===========================================================================
   Error handling
   ---------------------------------------------------------------------------
   Controllers call next(error), but nothing was registered to receive it, so
   Express fell back to its default handler: an HTML page containing the stack
   trace, absolute file paths and internal structure. That is both a poor API
   response and an information leak.

   Everything below returns JSON. Full detail is logged server-side; the client
   sees a stack trace only when NODE_ENV is explicitly "development".
   =========================================================================== */

/* Fails closed.
   This asked whether NODE_ENV was "production" and leaked stack traces
   whenever it was not. Nothing in this repo sets NODE_ENV, so the variable
   being absent - a missed setting on a host, a shell that did not export
   it - silently turned debug output on in front of real users, handing
   file paths and internal structure to anyone who could provoke a 500.

   Inverted: detail is included only when development is asked for
   explicitly. The unset case is now the safe one. */
const isDebug = () => process.env.NODE_ENV === "development";

// Postgres error codes worth translating rather than reporting as a 500.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_ERRORS: Record<string, { status: number; message: string }> = {
  "23505": { status: 409, message: "That record already exists." },
  "23514": { status: 400, message: "A value was outside the allowed range." },
  "23503": { status: 400, message: "A referenced record does not exist." },
  "23502": { status: 400, message: "A required value was missing." },
  "22P02": { status: 400, message: "A value was not in the expected format." },
};

// Unknown route. Without this Express answers with its own HTML 404, which is
// jarring for a client that expects JSON everywhere else.
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: `Not found: ${req.method} ${req.path}`,
    code: "NOT_FOUND",
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // A partially-sent response cannot be rewritten; hand back to Express so it
  // can close the connection.
  if (res.headersSent) {
    return next(err);
  }

  const anyErr = err as any;

  // Always log the full thing, whatever we choose to tell the client.
  console.error(
    `[error] ${req.method} ${req.originalUrl}`,
    anyErr?.stack || anyErr?.message || anyErr
  );

  let status = 500;
  let message = "Something went wrong on our end.";
  let code: string | undefined;

  if (err instanceof CorsError) {
    status = 403;
    message = err.message;
    code = "CORS_NOT_ALLOWED";
  } else if (err instanceof QuotaExhaustedError) {
    status = 429;
    message =
      "Market data is busy: the current plan allows 5 requests a minute. Please try again in a minute.";
    code = "QUOTA_EXHAUSTED";
  } else if (err instanceof UpstreamThrottledError) {
    status = 429;
    message = "Market data provider is throttling requests. Please try again shortly.";
    code = "UPSTREAM_THROTTLED";
  } else if (err instanceof UpstreamUnavailableError) {
    status = 501;
    message = "This data is not available on the current market data plan.";
    code = "UPSTREAM_UNAVAILABLE";
  } else if (err instanceof UpstreamDataError) {
    status = 502;
    message = "Market data could not be retrieved.";
    code = "UPSTREAM_ERROR";
  } else if (anyErr?.name === "TokenExpiredError") {
    status = 401;
    message = "Your session has expired. Please sign in again.";
    code = "TOKEN_EXPIRED";
  } else if (anyErr?.name === "JsonWebTokenError") {
    status = 401;
    message = "Invalid authentication token.";
    code = "TOKEN_INVALID";
  } else if (anyErr?.code && PG_ERRORS[anyErr.code]) {
    const mapped = PG_ERRORS[anyErr.code];
    status = mapped.status;
    message = mapped.message;
    code = `DB_${anyErr.code}`;
  } else if (anyErr?.type === "entity.parse.failed") {
    // express.json() could not parse the body
    status = 400;
    message = "Request body was not valid JSON.";
    code = "INVALID_JSON";
  } else if (typeof anyErr?.status === "number" && anyErr.status < 500) {
    // Errors that already carry a client-safe status and message
    status = anyErr.status;
    message = anyErr.message || message;
  }

  res.status(status).json({
    error: message,
    ...(code ? { code } : {}),
    // Only when NODE_ENV is explicitly "development".
    ...(isDebug()
      ? { detail: anyErr?.message, stack: anyErr?.stack?.split("\n").slice(0, 6) }
      : {}),
  });
};
