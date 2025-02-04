import { Request } from "express";

// Define user registration request body type
export interface RegisterRequestBody {
  email: string;
  password: string;
}

// Define user login request body type
export interface LoginRequestBody {
  email: string;
  password: string;
}

// Extend Express Request type to include typed body
export interface TypedRequest<T> extends Request {
  body: T;
}

// JWT Payload Type
export interface JwtPayload {
  userId: number;
}

export interface User {
  id: number;
  email: string;
}

export interface AuthRequest extends Request {
  user?: User;
}