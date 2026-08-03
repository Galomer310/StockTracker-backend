import rateLimit from "express-rate-limit"; // Import the express-rate-limit middleware
import { Request } from "express";           // Import the Express Request type

// Rate limiter for the market-data proxy routes.
//
// These routes spend our Polygon.io quota, so the budget is tracked per user
// rather than per IP: several users behind one office NAT should not share a
// bucket, and one user on several devices should not get a larger allowance.
//
// This must be mounted AFTER authenticateUser so that req.user is populated.
export const stockApiLimiter = rateLimit({
  windowMs: 60 * 1000, // Rolling one minute window
  limit: 60,           // 60 market-data requests per user per minute
  standardHeaders: "draft-7", // Emit the standard RateLimit-* response headers
  legacyHeaders: false,       // Omit the deprecated X-RateLimit-* headers
  // Key on the authenticated user id. Every route using this limiter sits
  // behind authenticateUser, so the fallback is unreachable in practice; it
  // exists only so the key is never undefined. Keying on the id rather than
  // req.ip also sidesteps IPv6 and trust-proxy handling entirely.
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id;
    return userId !== undefined ? `user:${userId}` : "anonymous";
  },
  message: {
    error: "Too many market data requests. Please wait a moment and try again.",
  },
});

// --- Authentication limiters -------------------------------------------------
//
// These routes run before any token exists, so there is no user id to key on
// and they fall back to express-rate-limit's default IP-based key (which
// normalises IPv6 correctly). See the TRUST_PROXY note in server.ts: behind a
// load balancer every request appears to come from the proxy unless Express is
// told how many hops to trust, which would put all users in one bucket.

// Login is the brute-force target. skipSuccessfulRequests means a successful
// login does not consume budget, so only failed attempts count — a legitimate
// user sharing an office IP is unaffected while a password guesser is stopped
// after 10 wrong tries.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,                // 10 *failed* attempts per IP per window
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many failed login attempts. Please try again later.",
  },
});

// Registration counts every request, successful or not, to make bulk account
// creation from one source impractical.
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,                // 10 new accounts per IP per hour
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many accounts created from this address. Please try again later.",
  },
});

// Refresh is called automatically by the client (on 403 and on the session
// timer), so the budget is deliberately generous — it exists to stop a token
// being ground against the endpoint, not to interrupt normal use.
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 60,                // 60 refresh attempts per IP per window
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many token refresh attempts. Please try again later.",
  },
});
