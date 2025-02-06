import express from "express";                 // Import express
import { register, login } from "../controllers/authController"; // Import register and login controllers
import { TypedRequest, RegisterRequestBody, LoginRequestBody } from "../types/types"; // Import custom types

const router = express.Router();               // Create a new router instance

// Register route: handle POST requests to "/register"
router.post("/register", async (req: TypedRequest<RegisterRequestBody>, res) => {
  await register(req, res);                    // Call the register controller with the request and response objects
});

// Login route: handle POST requests to "/login"
router.post("/login", async (req: TypedRequest<LoginRequestBody>, res) => {
  await login(req, res);                       // Call the login controller with the request and response objects
});

export default router;                         // Export the router to be used in the main server file
