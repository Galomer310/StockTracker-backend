/* ===========================================================================
   Usernames (the spec's "nickname", Player Card spec 3.2 / 11).
   ---------------------------------------------------------------------------
   The player's primary identity: mandatory once chosen, unique, checked for
   availability while it is typed. The rules, decided by Gal on 2026-11-09:

   - 3 to 20 characters.
   - Hebrew letters (alef to tav, final forms included, no niqqud), English
     letters, digits, "_" and ".". No spaces, so it works after an "@".
   - At least one letter, so a username never looks like an id.
   - "." not first, not last, never two in a row.
   - Unique WITHOUT regard to case: "Gal" and "gal" are the same username,
     but it is shown exactly as the player typed it. The comparison key is
     the lower-cased form, the same as Postgres lower() for these characters
     (a unique index on lower(nickname) backs this up).
   - Reserved names (staff, the platform's own name) cannot be taken, also
     when dotted or underscored ("ad.min").
   - Changed at most once every 30 days; the first choice counts as a
     change. A username given up stays held for its previous owner for 30
     days, so nobody can take it straight away and impersonate them.

   Pure, so the rules are tested without a database. Taking a username and
   the holds live in controllers/playerController.ts.
   =========================================================================== */

export const NICKNAME_MIN_LENGTH = 3;
export const NICKNAME_MAX_LENGTH = 20;
export const NICKNAME_CHANGE_DAYS = 30;
export const NICKNAME_HOLD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// Every character must be one of these. א-ת is alef to tav with
// the five final forms; niqqud and cantillation marks are outside it.
const ALLOWED = /^[A-Za-z0-9_.א-ת]+$/;
const HAS_LETTER = /[A-Za-zא-ת]/;

// Compared after lower-casing and removing "_" and ".".
const RESERVED = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "helpdesk",
  "moderator",
  "mod",
  "staff",
  "team",
  "official",
  "security",
  "investments",
  "socialinvest",
  "stocktrack",
  "stocktracker",
  "anonymous",
  "everyone",
  "here",
  "me",
  "null",
  "undefined",
  "אדמין",
  "מנהל",
  "מנהלת",
  "מנהלה",
  "הנהלה",
  "תמיכה",
  "צוות",
  "מערכת",
  "רשמי",
  "מודרטור",
]);

export type NicknameErrorCode =
  | "NICKNAME_REQUIRED"
  | "NICKNAME_TOO_SHORT"
  | "NICKNAME_TOO_LONG"
  | "NICKNAME_INVALID_CHARACTERS"
  | "NICKNAME_INVALID_DOTS"
  | "NICKNAME_NEEDS_LETTER"
  | "NICKNAME_RESERVED";

export type NicknameValidation =
  | { ok: true; nickname: string; key: string }
  | { ok: false; code: NicknameErrorCode; error: string };

/** The form two usernames are compared in. */
export const nicknameKey = (nickname: string): string => nickname.toLowerCase();

const length = (s: string): number => [...s].length;

export const validateNickname = (raw: unknown): NicknameValidation => {
  if (typeof raw !== "string") {
    return { ok: false, code: "NICKNAME_REQUIRED", error: "A username is required, and it cannot be removed once chosen." };
  }
  // A leading "@" is how a username is written, not part of it.
  const nickname = raw.trim().normalize("NFC").replace(/^@/, "");

  if (nickname === "") {
    return { ok: false, code: "NICKNAME_REQUIRED", error: "A username is required, and it cannot be removed once chosen." };
  }
  if (!ALLOWED.test(nickname)) {
    return {
      ok: false,
      code: "NICKNAME_INVALID_CHARACTERS",
      error: 'A username may contain Hebrew or English letters, digits, "_" and "." only - no spaces.',
    };
  }
  if (length(nickname) < NICKNAME_MIN_LENGTH) {
    return { ok: false, code: "NICKNAME_TOO_SHORT", error: `A username must be at least ${NICKNAME_MIN_LENGTH} characters.` };
  }
  if (length(nickname) > NICKNAME_MAX_LENGTH) {
    return { ok: false, code: "NICKNAME_TOO_LONG", error: `A username must be ${NICKNAME_MAX_LENGTH} characters or fewer.` };
  }
  if (nickname.startsWith(".") || nickname.endsWith(".") || nickname.includes("..")) {
    return { ok: false, code: "NICKNAME_INVALID_DOTS", error: 'A username cannot start or end with ".", or have two in a row.' };
  }
  if (!HAS_LETTER.test(nickname)) {
    return { ok: false, code: "NICKNAME_NEEDS_LETTER", error: "A username must contain at least one letter." };
  }
  const key = nicknameKey(nickname);
  if (RESERVED.has(key.replace(/[._]/g, ""))) {
    return { ok: false, code: "NICKNAME_RESERVED", error: "That username is reserved." };
  }
  return { ok: true, nickname, key };
};

/**
 * When the player may change their username again, or null if they may now
 * (or have never chosen one).
 */
export const nextNicknameChangeAt = (changedAt: Date | null, now: Date): Date | null => {
  if (!changedAt) return null;
  const next = new Date(changedAt.getTime() + NICKNAME_CHANGE_DAYS * DAY_MS);
  return next.getTime() > now.getTime() ? next : null;
};

/** Hold releases older than this are free for anyone to take. */
export const holdCutoff = (now: Date): Date => new Date(now.getTime() - NICKNAME_HOLD_DAYS * DAY_MS);
