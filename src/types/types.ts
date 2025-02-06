import { Request } from "express";             // Import the Express Request type

// Define type for user registration request body
export interface RegisterRequestBody {
  email: string;                              // User's email address
  password: string;                           // User's password
}

// Define type for user login request body
export interface LoginRequestBody {
  email: string;                              // User's email address
  password: string;                           // User's password
}

// Extend the Express Request type to include a typed body
export interface TypedRequest<T> extends Request {
  body: T;                                    // Body of the request should conform to type T
}

// JWT Payload Type: defines the structure of the token payload
export interface JwtPayload {
  userId: number;                             // The user id contained in the token
}

// User type: represents a user object in the system
export interface User {
  id: number;                                 // Unique identifier for the user
  email: string;                              // User's email address
}

// AuthRequest type: extends Express Request to optionally include a user object (set by auth middleware)
export interface AuthRequest extends Request {
  user?: User;
}
