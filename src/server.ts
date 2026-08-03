import express from "express";                 // Import express framework
import dotenv from "dotenv";                   // Import dotenv to load environment variables
import cors from "cors";                       // Import cors middleware for handling cross-origin requests
import helmet from "helmet";                   // Security response headers
import cookieParser from "cookie-parser";      // Import cookie-parser middleware to parse cookies
import authRoutes from "./routes/authRoutes";  // Import authentication routes
import stockRoutes from "./routes/stockRoutes"; // Import stock routes
import watchlistRoutes from "./routes/watchlistRoutes"; // Import watchlist routes
import socialRoutes from "./routes/leaderboardRoutes"; // Import leaderboard and public portfolio routes
import { corsOptions, getAllowedOrigins } from "./config/cors"; // Origin allowlist + exposed headers
import { errorHandler, notFoundHandler } from "./middleware/errorHandler"; // JSON errors

dotenv.config();                               // Load environment variables from .env file

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
app.use(express.json());                       // Parse incoming JSON payloads
app.use(cors(corsOptions));                    // Restrict origins and expose our custom headers
app.use(cookieParser());                       // Parse cookies attached to client requests

// API Routes: mount the routers on specific base paths
app.use("/auth", authRoutes);                  // Routes for user authentication
app.use("/stocks", stockRoutes);               // Routes for fetching stock data
app.use("/watchlist", watchlistRoutes);        // Routes for managing watchlist items
app.use("/social", socialRoutes);              // Leaderboard and viewing other users' portfolios

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
