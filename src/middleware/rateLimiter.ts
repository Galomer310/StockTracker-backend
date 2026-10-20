import rateLimit from "express-rate-limit"; // Import the express-rate-limit middleware
import { Request } from "express";           // Import the Express Request type

// Every limiter below is mounted AFTER authenticateUser, so budgets are
// tracked per account rather than per IP: several users behind one office NAT
// should not share a bucket, and one user on several devices should not get a
// larger allowance. Keying on the id rather than req.ip also sidesteps IPv6
// and trust-proxy handling entirely. The "anonymous" fallback is unreachable
// in practice and exists only so the key is never undefined.
const byUser = (req: Request): string => {
  const userId = (req as any).user?.id;
  return userId !== undefined ? `user:${userId}` : "anonymous";
};

// Market data. These routes spend the Massive per-minute allowance.
export const stockApiLimiter = rateLimit({
  windowMs: 60 * 1000, // Rolling one minute window
  limit: 60,           // 60 market-data requests per user per minute
  standardHeaders: "draft-7", // Emit the standard RateLimit-* response headers
  legacyHeaders: false,       // Omit the deprecated X-RateLimit-* headers
  keyGenerator: byUser,
  message: {
    error: "Too many market data requests. Please wait a moment and try again.",
  },
});

// Portfolio reads and writes. Mostly cheap database work, so the ceiling is
// generous: opening the dashboard already fires one request per holding.
// This exists to stop a runaway client hammering the database, not to ration
// normal use.
//
// Note that POST /watchlist can additionally spend market data budget, so
// that route also carries stockApiLimiter - a user's total market-data spend
// is then capped across /stocks and /watchlist together rather than per route.
export const watchlistLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: byUser,
  message: { error: "Too many portfolio requests. Please slow down." },
});

// Leaderboard, other people's portfolios and journals. The leaderboard query
// aggregates across every account, so it is the most expensive read in the
// app and the one most worth protecting.
export const socialLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: byUser,
  message: { error: "Too many leaderboard requests. Please slow down." },
});

// The feed. Reads are one query per page load, but writes are one per tap on a
// reaction, so the ceiling is higher than the social limiter's: a user flicking
// through the timeline liking things should never be throttled, while a script
// hammering the reaction endpoint still is.
export const feedLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: byUser,
  message: { error: "Too many feed requests. Please slow down." },
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
    code: "TOO_MANY_LOGIN_ATTEMPTS",
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
    code: "TOO_MANY_REGISTRATIONS",
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
