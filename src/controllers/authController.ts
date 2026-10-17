import { Request, Response } from "express";
import pool from "../config/db";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt";
import jwt from "jsonwebtoken";
import {
  TypedRequest,
  RegisterRequestBody,
  LoginRequestBody,
  JwtPayload,
  RefreshTokenRequestBody,
} from "../types/types";
import {
  validatePassword,
  validateEmail,
  normaliseEmail,
} from "../utils/credentials";

/* Work factor for bcrypt.
   Raised from 10. The cost is stored inside each hash, so existing passwords
   keep verifying at the factor they were created with; login re-hashes them
   to this cost the next time their owner signs in, which is the only moment
   the plaintext exists. 12 is roughly four times the work of 10 - a few
   hundred milliseconds once per sign-in here, and several years of extra
   compute for anyone attacking a stolen hash table. */
const BCRYPT_ROUNDS = 12;

/* A real bcrypt hash of a string nobody will guess, used to spend the same
   time verifying a password for an address that does not exist as for one
   that does.

   Without it, login returned immediately when the email was unknown and only
   ran bcrypt when it was known. That difference is measurable over the
   network, so anyone could test whether an address had an account here by
   timing the response - and "who banks with you" is exactly what a targeted
   phishing run wants. Generated at startup so it is never a constant anyone
   can recognise in the source. */
const TIMING_DECOY_HASH = bcrypt.hashSync(
  "timing-decoy-" + Math.random().toString(36).slice(2),
  BCRYPT_ROUNDS
);

// REGISTER
export const register = async (
  req: TypedRequest<RegisterRequestBody>,
  res: Response
) => {
  const { email, password, display_name } = req.body;

  const emailProblem = validateEmail(email);
  if (emailProblem) return res.status(400).json(emailProblem);

  const passwordProblem = validatePassword(password);
  if (passwordProblem) return res.status(400).json(passwordProblem);

  const name = typeof display_name === "string" ? display_name.trim() : "";
  if (!name) return res.status(400).json({ error: "Display name is required", code: "DISPLAY_NAME_REQUIRED" });
  if (name.length > 40)
    return res
      .status(400)
      .json({ error: "Display name must be 40 characters or fewer", code: "DISPLAY_NAME_TOO_LONG" });

  const address = normaliseEmail(email as string);

  try {
    // Compared case-insensitively against what is stored. Addresses are
    // case-insensitive in practice, so without this the same person could
    // hold two accounts that differ only in capitalisation - and would find
    // that signing in worked or not depending on how they typed it.
    const existingUser = await pool.query(
      "SELECT 1 FROM users WHERE LOWER(email) = $1",
      [address]
    );
    if (existingUser.rows.length > 0)
      return res.status(409).json({ error: "Email already exists", code: "EMAIL_TAKEN" });

    const hashedPassword = await bcrypt.hash(password as string, BCRYPT_ROUNDS);

    const newUser = await pool.query(
      "INSERT INTO users (email, password, display_name) VALUES ($1, $2, $3) RETURNING id",
      [address, hashedPassword, name]
    );

    const accessToken = generateAccessToken(newUser.rows[0].id);
    return res.status(201).json({ message: "User registered", accessToken });
  } catch (error) {
    console.error("[auth] register failed:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// LOGIN
export const login = async (
  req: TypedRequest<LoginRequestBody>,
  res: Response
) => {
  const { email, password } = req.body;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password)
    return res.status(400).json({ error: "Email and password are required", code: "CREDENTIALS_REQUIRED" });

  try {
    // LOWER() on the column rather than storing everything normalised in one
    // pass: rows written before addresses were normalised still carry their
    // original capitalisation, and those accounts must keep working.
    const result = await pool.query(
      "SELECT id, email, password FROM users WHERE LOWER(email) = $1",
      [normaliseEmail(email)]
    );

    const user = result.rows[0];

    // Always run a comparison, even with no user to compare against, so the
    // response takes the same time either way. Assigning the result and
    // ignoring it keeps the call from being optimised away.
    const isPasswordValid = await bcrypt.compare(
      password,
      user ? user.password : TIMING_DECOY_HASH
    );

    // One message for both "no such account" and "wrong password". Telling
    // them apart hands an attacker a free account-enumeration oracle.
    if (!user || !isPasswordValid)
      return res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" });

    /* Upgrade the stored hash if it was made at a lower cost.
       Two things depend on this. The obvious one is that accounts created
       before BCRYPT_ROUNDS was raised keep their weaker hash forever
       otherwise, since a hash cannot be strengthened without the plaintext -
       and this request is the only moment it exists.

       The second is the timing decoy above. Its cost is fixed at the current
       BCRYPT_ROUNDS, so while a real hash sits at a lower cost the two paths
       take measurably different times and the enumeration oracle is still
       open, merely reversed. Re-hashing closes that gap for each account the
       first time its owner signs in.

       Deliberately not awaited: the caller should not wait on maintenance,
       and a failure here must not turn a good sign-in into an error. */
    const storedRounds = bcrypt.getRounds(user.password);
    if (storedRounds < BCRYPT_ROUNDS) {
      bcrypt
        .hash(password, BCRYPT_ROUNDS)
        .then((upgraded) =>
          pool.query("UPDATE users SET password = $1 WHERE id = $2", [
            upgraded,
            user.id,
          ])
        )
        .catch((err) =>
          console.error("[auth] password rehash failed for user", user.id, err)
        );
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    return res.json({
      message: "Login successful",
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("[auth] login failed:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// REFRESH
export const refreshToken = async (req: Request, res: Response) => {
  const { refreshToken } = req.body as RefreshTokenRequestBody;
  if (!refreshToken) {
    return res.status(400).json({ error: "Refresh token is required" });
  }

  try {
    // Verified against REFRESH_SECRET, which is a different key from the one
    // that signs access tokens. That separation is what stops an access token
    // from being replayed here to mint an endless supply of new ones.
    const payload = jwt.verify(
      refreshToken,
      process.env.REFRESH_SECRET as string
    ) as JwtPayload;

    const newAccessToken = generateAccessToken(payload.userId);
    const newRefreshToken = generateRefreshToken(payload.userId);

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
};
