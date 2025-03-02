import jwt from "jsonwebtoken";                 // Import jsonwebtoken for token creation

// Function to generate an access token for a given user id
export const generateAccessToken = (userId: number) => {
  // Sign a new token with the userId payload, secret from env variables, and expiration time of 15 minutes
  return jwt.sign({ userId }, process.env.JWT_SECRET as string, { expiresIn: "15m" });
};

// Generates a refresh token valid for 2 hours.
export const generateRefreshToken = (userId: number) => {
  // Refresh token with the userId payload, secret from env variables, and expiration time of 2 hours
  return jwt.sign({ userId }, process.env.REFRESH_SECRET as string, { expiresIn: "2h" });
};