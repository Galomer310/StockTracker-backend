import express from "express";
import { register, login } from "../controllers/authController";
import { TypedRequest, RegisterRequestBody, LoginRequestBody } from "../types/types";

const router = express.Router();

// Register route
router.post("/register", async (req: TypedRequest<RegisterRequestBody>, res) => {
  await register(req, res);
});

// Login route
router.post("/login", async (req: TypedRequest<LoginRequestBody>, res) => {
  await login(req, res);
});

export default router;
