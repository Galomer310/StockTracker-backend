import { Request, Response } from "express";   // Import Request and Response types from Express
import pool from "../config/db";                 // Import the PostgreSQL pool from the config
import bcrypt from "bcryptjs";                   // Import bcryptjs for hashing passwords
import { generateAccessToken, generateRefreshToken } from "../utils/jwt"; // Import utility function to generate JWT tokens
import jwt from "jsonwebtoken"; // Import jsonwebtoken library
import { TypedRequest, RegisterRequestBody, LoginRequestBody, JwtPayload, RefreshTokenRequestBody } from "../types/types";
// ^-- Import custom types for typed requests and request bodies

// REGISTER CONTROLLER
export const register = async (
  req: TypedRequest<RegisterRequestBody>,     // Typed request with expected RegisterRequestBody
  res: Response                               // Express response object
) => {
  const { email, password } = req.body;         // Destructure email and password from request body
  if (!email || !password)                      // Check if both email and password are provided
    return res.status(400).json({ error: "Email and password are required" });
  
  try {
    // Query the database to see if the user already exists
    const existingUser = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existingUser.rows.length > 0)           // If user already exists, send a 400 response
      return res.status(400).json({ error: "Email already exists" });
    
    // Hash the user's password with 10 salt rounds
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insert the new user into the database and return the new user's id
    const newUser = await pool.query(
      "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id",
      [email, hashedPassword]
    );
    
    // Generate an access token for the new user
    const accessToken = generateAccessToken(newUser.rows[0].id);
    
    // Send a success response with the access token
    return res.status(201).json({ message: "User registered", accessToken });
  } catch (error) {
    console.error("Error:", error);            // Log any errors to the console
    return res.status(500).json({ error: "Server error" }); // Send a 500 error response if something goes wrong
  }
};

// LOGIN CONTROLLER
export const login = async (
  req: TypedRequest<LoginRequestBody>,        // Typed request with expected LoginRequestBody
  res: Response                               // Express response object
) => {
  const { email, password } = req.body;         // Destructure email and password from the request body
  if (!email || !password)                      // Check if both email and password are provided
    return res.status(400).json({ error: "Email and password are required" });
  
  try {
    // Query the database for a user with the provided email
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0)               // If no user is found, send a 401 Unauthorized response
      return res.status(401).json({ error: "Invalid credentials" });
    
    const user = result.rows[0];                // Get the user data from the query result
    // Compare the provided password with the hashed password in the database
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)                       // If the password does not match, send a 401 response
      return res.status(401).json({ error: "Invalid credentials" });
    
    // Generate an access token for the authenticated user
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id); // Generate a refresh token for the user
    
// Send a successful response with both tokens and user info
return res.json({
  message: "Login successful",
  accessToken,
  refreshToken,  // Include the refresh token in the response
  user: {
    id: user.id,
    email: user.email,
  },
});
  } catch (error) {
    console.error("Error:", error);            // Log errors to the console
    return res.status(500).json({ error: "Server error" }); // Send a 500 error response if something goes wrong
  }
};



export const refreshToken = async (req: Request, res: Response) => {
  // Extract refreshToken from request body
  const { refreshToken } = req.body as RefreshTokenRequestBody;
  if (!refreshToken) {
    return res.status(400).json({ error: "Refresh token is required" });
  }

  try {
    // Verify the refresh token using your REFRESH_SECRET
    const payload = jwt.verify(refreshToken, process.env.REFRESH_SECRET as string) as JwtPayload;

    // Generate a new refresh token with a 2-hour expiration
    const newRefreshToken = generateRefreshToken(payload.userId);

    return res.json({ refreshToken: newRefreshToken });
  } catch (error) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
};