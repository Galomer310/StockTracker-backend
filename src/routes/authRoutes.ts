import express from "express";                 // Import express
import { register, login, refreshToken } from "../controllers/authController"; // Import register and login controllers
import { TypedRequest, RegisterRequestBody, LoginRequestBody, RefreshTokenRequestBody } from "../types/types"; // Import custom types
import { loginLimiter, registerLimiter, refreshLimiter } from "../middleware/rateLimiter"; // Per-IP limiters for the unauthenticated routes

const router = express.Router();               // Create a new router instance

// Register route: handle POST requests to "/register"
router.post("/register", registerLimiter, async (req: TypedRequest<RegisterRequestBody>, res) => {
  await register(req, res);                    // Call the register controller with the request and response objects
});

// Login route: handle POST requests to "/login"
router.post("/login", loginLimiter, async (req: TypedRequest<LoginRequestBody>, res) => {
  await login(req, res);                       // Call the login controller with the request and response objects
});

// Refresh route: exchange a valid refresh token for a new token pair
router.post("/refresh", refreshLimiter, async (req: TypedRequest<RefreshTokenRequestBody>, res) => {
  await refreshToken(req, res);
});

export default router;                         // Export the router to be used in the main server file
