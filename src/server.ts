import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes";
import stockRoutes from "./routes/stockRoutes";
import watchlistRoutes from "./routes/watchlistRoutes";
import path from "path";



dotenv.config();

// Initialize express
const app = express();

// 
app.use(express.json());

// Enable CORS
app.use(cors());

// Cookie parser
app.use(cookieParser());

// Routes
app.use("/auth", authRoutes);
app.use("/stocks", stockRoutes);
app.use("/watchlist", watchlistRoutes);

// Serve static assets if in production
app.use(express.static(path.join(__dirname, "../public")));

// Handle React routing, return all requests to React app
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../public", "index.html"));
  });

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
