import { CorsOptions } from "cors";

/* ===========================================================================
   CORS
   ---------------------------------------------------------------------------
   Previously `app.use(cors())`, which answers every origin with
   Access-Control-Allow-Origin: *. Any website could call the API with a
   token it had obtained.

   Two things matter here beyond the allowlist:

   1. exposedHeaders. Browsers hide every response header except a short safe
      list, so X-Quota-Remaining and X-Cache were invisible to the client even
      though the server was sending them. The quota indicator silently never
      worked in the browser; it only appeared to work under curl, which does
      not enforce CORS.

   2. credentials stays false. Tokens travel in the Authorization header, not
      cookies. If auth ever moves to httpOnly cookies this must become true,
      and the allowlist can no longer contain a wildcard.
   =========================================================================== */

const DEFAULT_ORIGINS = [
  "http://localhost:5173",   // Vite dev server
  "http://127.0.0.1:5173",
];

// Comma-separated list, e.g. CORS_ORIGINS=https://app.example.com,https://www.example.com
const allowedOrigins = (process.env.CORS_ORIGINS || DEFAULT_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const getAllowedOrigins = (): string[] => [...allowedOrigins];

// Rejected origins should read as forbidden, not as a server fault.
export class CorsError extends Error {
  status = 403;
  constructor(origin: string) {
    super(`Origin ${origin} is not allowed by CORS policy`);
    this.name = "CorsError";
  }
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // No Origin header: curl, server-to-server, same-origin. Not a browser
    // cross-origin request, so there is nothing for CORS to protect against.
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new CorsError(origin));
  },
  // PATCH is for profile edits (PATCH /players/me). A method missing here is
  // refused at the browser's preflight, which server-side tests never see.
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // X-Portfolio-Id carries which of the user's portfolios the request acts on.
  // A header the browser is not told it may send is stripped at the preflight,
  // so omitting it here would make every trade fail with "no portfolio
  // selected" and nothing in the server logs to explain why.
  allowedHeaders: ["Content-Type", "Authorization", "X-Portfolio-Id"],
  // Without this the client cannot read any of these, however faithfully the
  // server sets them.
  exposedHeaders: [
    "X-Cache",
    "X-Quota-Remaining",
    "X-Stale-Age-Seconds",
    "RateLimit",
    "RateLimit-Policy",
    "Retry-After",
  ],
  credentials: false,
  maxAge: 86400, // cache the preflight for a day
};
