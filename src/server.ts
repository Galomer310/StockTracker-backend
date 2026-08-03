import express from "express";                 // Import express framework
import dotenv from "dotenv";                   // Import dotenv to load environment variables
import cors from "cors";                       // Import cors middleware for handling cross-origin requests
import cookieParser from "cookie-parser";      // Import cookie-parser middleware to parse cookies
import authRoutes from "./routes/authRoutes";  // Import authentication routes
import stockRoutes from "./routes/stockRoutes"; // Import stock routes
import watchlistRoutes from "./routes/watchlistRoutes"; // Import watchlist routes

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

// Middleware configuration
app.use(express.json());                       // Parse incoming JSON payloads
app.use(cors());                               // Enable Cross-Origin Resource Sharing
app.use(cookieParser());                       // Parse cookies attached to client requests

// API Routes: mount the routers on specific base paths
app.use("/auth", authRoutes);                  // Routes for user authentication
app.use("/stocks", stockRoutes);               // Routes for fetching stock data
app.use("/watchlist", watchlistRoutes);        // Routes for managing watchlist items

// Start the server and listen on the specified PORT (default to 3000 if not provided)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`); // Log a message indicating the server is running
});
