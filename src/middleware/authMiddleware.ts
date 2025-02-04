import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JwtPayload } from "../types/types";

export const authenticateUser = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        res.status(401).json({ error: "Unauthorized: No token provided" });
        return; // ✅ Ensure function stops execution
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
        (req as any).user = { id: decoded.userId }; // Attach user ID to request object
        next(); // ✅ Call next() if user is authenticated
    } catch (error) {
        res.status(403).json({ error: "Forbidden: Invalid token" });
        return; // ✅ Ensure function stops execution
    }
};
