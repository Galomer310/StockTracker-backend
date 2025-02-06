import { Request, Response, NextFunction } from "express"; // Import Express types for Request, Response, and NextFunction
import jwt from "jsonwebtoken";                // Import the jsonwebtoken library for JWT operations
import { JwtPayload } from "../types/types";     // Import custom JwtPayload type

// Middleware function to authenticate users based on JWT token
export const authenticateUser = (req: Request, res: Response, next: NextFunction): void => {
    // Extract the token from the Authorization header (format: "Bearer <token>")
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {                              // If no token is provided, respond with a 401 error
        res.status(401).json({ error: "Unauthorized: No token provided" });
        return;                                // Stop further execution
    }
    try {
        // Verify the token using the secret key from environment variables
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
        // Attach the decoded user id to the request object for use in subsequent middleware/controllers
        (req as any).user = { id: decoded.userId };
        next();                                // Call next() to pass control to the next middleware/controller
    } catch (error) {
        res.status(403).json({ error: "Forbidden: Invalid token" });
        return;                                // Stop execution if token verification fails
    }
};
