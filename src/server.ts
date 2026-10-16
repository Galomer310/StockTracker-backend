import express from "express";                 // Import express framework
import dotenv from "dotenv";                   // Import dotenv to load environment variables
import cors from "cors";                       // Import cors middleware for handling cross-origin requests
import helmet from "helmet";                   // Security response headers
import authRoutes from "./routes/authRoutes";  // Import authentication routes
import stockRoutes from "./routes/stockRoutes"; // Import stock routes
import watchlistRoutes from "./routes/watchlistRoutes"; // Import watchlist routes
import socialRoutes from "./routes/leaderboardRoutes"; // Import leaderboard and public portfolio routes
import feedRoutes from "./routes/feedRoutes";  // Import the shared trade feed routes
import portfolioRoutes from "./routes/portfolioRoutes"; // Import the user's own portfolios
import playerRoutes from "./routes/playerRoutes"; // Import the Player Card routes
import { corsOptions, getAllowedOrigins } from "./config/cors"; // Origin allowlist + exposed headers
import { errorHandler, notFoundHandler } from "./middleware/errorHandler"; // JSON errors

dotenv.config();                               // Load environment variables from .env file

/* ===========================================================================
   Startup checks
   ---------------------------------------------------------------------------
   The signing secrets were read with `process.env.JWT_SECRET as string`,
   which is a promise to the type checker and nothing more. Start without
   them and the process comes up healthy, serves the landing page, and fails
   only when the first person tries to sign in.

   Worse is a secret that is present but weak. jsonwebtoken will happily sign
   with "secret", and every token it produces is then forgeable by anyone who
   guesses it - which is not a thing to discover in production.

   Refusing to boot is the right failure: a deploy that dies immediately gets
   noticed and rolled back, while one that half-works does not.
   =========================================================================== */
const MIN_SECRET_LENGTH = 32;

const requireSecret = (name: string): void => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
    );
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} is only ${value.length} characters; at least ${MIN_SECRET_LENGTH} are required.`
    );
  }
};

for (const name of ["JWT_SECRET", "REFRESH_SECRET", "DATABASE_URL"]) {
  requireSecret(name);
}

// The two token secrets must differ. If they are the same value, an access
// token verifies as a refresh token, so a stolen access token can be traded
// for a fresh pair indefinitely and the shorter access lifetime buys nothing.
if (process.env.JWT_SECRET === process.env.REFRESH_SECRET) {
  throw new Error(
    "JWT_SECRET and REFRESH_SECRET must be different values, or an access token can be replayed as a refresh token."
  );
}

const app = express();                         // Initialize the Express application

// The auth rate limiters bucket by client IP. Behind a load balancer (Render,
// Heroku, nginx, ...) req.ip is the proxy's address unless Express is told how
// many forwarding hops to trust, which would put every user in one bucket and
// lock everyone out together.
//
// This is off by default because the opposite mistake is worse: trusting
// X-Forwarded-For when there is no proxy in front lets any client spoof the
// header and sidestep the limits entirely. Set TRUST_PROXY to the number of
// proxies in front of this server (usually 1) when deploying behind one.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

// Middleware configuration.
//
// helmet goes first so its headers are present on every response, including
// ones short-circuited later by CORS or the rate limiters.
//
// Two defaults are overridden because this serves a JSON API to a browser app
// on a different origin, not HTML from the same origin:
//   - crossOriginResourcePolicy defaults to same-origin, which can block the
//     frontend from reading responses it is otherwise allowed to request.
//   - contentSecurityPolicy governs page resource loading and has nothing to
//     act on here; the API never returns markup.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);
// Capped well below the 100kb default. Nothing this API accepts is large -
// the biggest body is a trade with a written rationale - so a request bigger
// than this is either a mistake or someone probing for a way to make the
// server do expensive parsing work cheaply.
app.use(express.json({ limit: "16kb" }));
app.use(cors(corsOptions));                    // Restrict origins and expose our custom headers

// API Routes: mount the routers on specific base paths
app.use("/auth", authRoutes);                  // Routes for user authentication
app.use("/stocks", stockRoutes);               // Routes for fetching stock data
app.use("/portfolios", portfolioRoutes);       // The caller's own portfolios and their cash
app.use("/watchlist", watchlistRoutes);        // Routes for managing watchlist items
app.use("/social", socialRoutes);              // Leaderboard and viewing other users' portfolios
app.use("/feed", feedRoutes);                  // Shared timeline of everyone's trades
app.use("/players", playerRoutes);             // Player Card

// Error handling. These must come after all routes: Express selects the first
// matching handler, so a 404 registered earlier would swallow real routes, and
// an error handler registered earlier would never see their errors.
app.use(notFoundHandler);                      // Unknown route -> JSON 404
app.use(errorHandler);                         // Anything passed to next(err) -> JSON

// Start the server and listen on the specified PORT (default to 3000 if not provided)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`); // Log a message indicating the server is running
  console.log(`CORS origins allowed: ${getAllowedOrigins().join(", ")}`);
});
