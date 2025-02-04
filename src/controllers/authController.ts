import { Request, Response } from "express";
import pool from "../config/db";
import bcrypt from "bcryptjs";
import { generateAccessToken } from "../utils/jwt";
import { TypedRequest, RegisterRequestBody, LoginRequestBody } from "../types/types";

// Register
export const register = async (req: TypedRequest<RegisterRequestBody>, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  try {
    const existingUser = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existingUser.rows.length > 0) return res.status(400).json({ error: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await pool.query("INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id", [email, hashedPassword]);

    const accessToken = generateAccessToken(newUser.rows[0].id);
    return res.status(201).json({ message: "User registered", accessToken });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// Login
export const login = async (req: TypedRequest<LoginRequestBody>, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: "Invalid credentials" });

    const accessToken = generateAccessToken(user.id);

    // ✅ Ensure the response has a `user` object
    return res.json({
      message: "Login successful",
      accessToken,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
