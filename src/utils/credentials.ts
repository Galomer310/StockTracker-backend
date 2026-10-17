/* ===========================================================================
   Credential rules
   ---------------------------------------------------------------------------
   Registration previously accepted any non-empty string as a password, so a
   single character was a valid account credential. On a site that is publicly
   reachable that is the cheapest thing for an automated attacker to exploit:
   credential-stuffing lists are mostly short, common passwords, and a rate
   limit slows guessing without making any individual guess less likely to be
   right.

   These checks are deliberately about *length and obviousness*, not about
   character-class rules. Forcing a symbol and a digit pushes people towards
   "Password1!" - which is on every list - while a long passphrase that trips
   no complexity rule is far stronger. Length is what actually costs an
   attacker work.
   =========================================================================== */

// bcrypt silently ignores everything past 72 bytes, so a longer password is
// not more secure and hashing it wastes work on a request an attacker can
// send cheaply. Rejecting it is also honest: it stops us claiming to store a
// 200-character password when we store the first 72 bytes of it.
export const MAX_PASSWORD_BYTES = 72;

// Twelve is the shortest length at which an offline attack on a bcrypt hash
// stays expensive for a password that is not in a dictionary.
export const MIN_PASSWORD_LENGTH = 12;

// The handful that show up first in every breach corpus and every default
// wordlist. This is not a serious dictionary check - it is a cheap filter for
// the passwords a bot would try in its first few hundred attempts, which is
// exactly the range the rate limiter has not yet shut down.
const OBVIOUS_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "letmein", "welcome",
  "welcome123", "qwerty", "qwerty123", "qwertyuiop", "111111", "123456",
  "1234567", "12345678", "123456789", "1234567890", "iloveyou", "admin",
  "administrator", "changeme", "secret", "monkey", "dragon", "sunshine",
  "princess", "football", "baseball", "abc123", "trustno1", "starwars",
  "investments", "portfolio", "stocktracker",
]);

// The code lets a client show the reason in its own language; the error is
// the English wording, unchanged for clients that show the server's text.
export type CredentialErrorCode =
  | "PASSWORD_NOT_TEXT"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_TOO_COMMON"
  | "PASSWORD_TOO_SIMPLE"
  | "EMAIL_NOT_TEXT"
  | "EMAIL_TOO_LONG"
  | "EMAIL_INVALID";

export interface Invalid {
  error: string;
  code: CredentialErrorCode;
}

// Returns null when the password is acceptable, or the reason it is not.
export const validatePassword = (password: unknown): Invalid | null => {
  if (typeof password !== "string") {
    return { error: "Password must be text.", code: "PASSWORD_NOT_TEXT" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember is stronger than a short jumble.`,
      code: "PASSWORD_TOO_SHORT",
    };
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return {
      error: `Password must be ${MAX_PASSWORD_BYTES} bytes or fewer.`,
      code: "PASSWORD_TOO_LONG",
    };
  }
  // Compared lowercased: "PASSWORD123" is no better than "password123".
  if (OBVIOUS_PASSWORDS.has(password.toLowerCase())) {
    return {
      error: "That password appears in common breach lists. Please choose another.",
      code: "PASSWORD_TOO_COMMON",
    };
  }
  // A single repeated character clears the length rule but has almost no
  // entropy: "aaaaaaaaaaaa" is twelve characters and one guess.
  if (new Set(password).size < 5) {
    return {
      error: "Password must use at least 5 different characters.",
      code: "PASSWORD_TOO_SIMPLE",
    };
  }
  return null;
};

/* Email.
   Deliberately permissive. The full RFC 5322 grammar accepts addresses no
   provider issues, and every short regex rejects addresses that are real, so
   the only claim made here is structural: one @, something either side, a dot
   in the domain, no whitespace. Anything subtler is the delivery system's job,
   not a signup form's. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const MAX_EMAIL_LENGTH = 254; // The SMTP path limit.

export const validateEmail = (email: unknown): Invalid | null => {
  if (typeof email !== "string") {
    return { error: "Email must be text.", code: "EMAIL_NOT_TEXT" };
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return { error: "Email address is too long.", code: "EMAIL_TOO_LONG" };
  }
  if (!EMAIL_SHAPE.test(email)) {
    return { error: "Please enter a valid email address.", code: "EMAIL_INVALID" };
  }
  return null;
};

// Addresses are case-insensitive in practice, and storing them as typed lets
// the same person register twice with different capitalisation - two accounts,
// one inbox, and a login that works or not depending on how they typed it.
export const normaliseEmail = (email: string): string =>
  email.trim().toLowerCase();
