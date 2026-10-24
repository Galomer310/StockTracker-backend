/* ===========================================================================
   Player profile edits.
   ---------------------------------------------------------------------------
   What a player may change about themselves on the Player Card (spec 3.5,
   11): the bio, the first name and the avatar. Pure, so the rules can be
   tested without a database.

   The avatar is chosen from a fixed gallery (AVATAR_IDS); the artwork lives
   in the frontend and only its id is stored, in users.avatar_id.

   Deliberately NOT editable here:
   - nickname: mandatory and unique, but its rules (case sensitivity,
     allowed characters, length, how often it may change) are undecided;
   - avatar_url: an uploaded picture needs file storage, which does not
     exist yet;
   - level, title, XP, and everything else the system sets - the spec says
     the player can never edit those.
   A request naming any of them is refused with the reason, rather than the
   field being silently dropped.
   =========================================================================== */

// The spec's limit (3.5). The database enforces it too.
export const BIO_MAX_LENGTH = 100;

// Not in the spec, which gives the first name no limit. A cap is needed so
// the field cannot hold arbitrary text; 50 is a placeholder to revisit.
export const FIRST_NAME_MAX_LENGTH = 50;

// The avatar gallery. Ids only: each must have artwork in the frontend
// (src/components/avatars). Add new ones at the end; never rename or remove
// one a player may have chosen.
export const AVATAR_IDS = [
  "businessperson",
  "warrior",
  "entrepreneur",
  "investor",
  "freelancer",
  "astronaut",
  "student",
  "princess",
  "king",
  "space-warrior",
  "groot",
  "darth-vader",
  "jedi",
  "captain-america",
  "kim-jong-un",
  "genghis-khan",
  "samurai",
  "mario",
  "harry-potter",
  "hermione",
  "r2-d2",
  "bb-8",
  "hagrid",
  "gandalf",
  "einstein",
  "tesla",
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export type ProfileErrorCode =
  | "INVALID_BODY"
  | "NOT_EDITABLE"
  | "NOTHING_TO_UPDATE"
  | "INVALID_TYPE"
  | "INVALID_CHARACTERS"
  | "BIO_TOO_LONG"
  | "FIRST_NAME_TOO_LONG"
  | "INVALID_AVATAR";

export interface ProfileUpdate {
  bio?: string;
  /** null clears it: the first name is optional (spec 3.2). */
  first_name?: string | null;
  /** null returns to the default picture (the nickname's initial). */
  avatar_id?: AvatarId | null;
}

export type ProfileValidation =
  | { ok: true; update: ProfileUpdate }
  | { ok: false; code: ProfileErrorCode; field?: string; error: string };

const EDITABLE = new Set(["bio", "first_name", "avatar_id"]);

const NOT_EDITABLE_REASON: Record<string, string> = {
  nickname: "The nickname cannot be changed yet; its rules are still being decided.",
  avatar_url: "The profile picture cannot be changed yet.",
};

// Characters as a person counts them, matching Postgres char_length: a
// Hebrew letter or an emoji is one.
const length = (s: string): number => [...s].length;

// Control characters, line breaks included. Both fields are shown on a
// single line or a single paragraph, where they would be invisible or break
// the layout.
const hasControlCharacters = (s: string): boolean => /\p{Cc}/u.test(s);

const fail = (code: ProfileErrorCode, error: string, field?: string): ProfileValidation => ({
  ok: false,
  code,
  error,
  ...(field ? { field } : {}),
});

export const validateProfileUpdate = (body: unknown): ProfileValidation => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("INVALID_BODY", "Send the fields to change as a JSON object.");
  }
  const fields = body as Record<string, unknown>;

  for (const key of Object.keys(fields)) {
    if (!EDITABLE.has(key)) {
      return fail(
        "NOT_EDITABLE",
        NOT_EDITABLE_REASON[key] ?? `"${key}" cannot be changed. Only bio, first_name and avatar_id can.`,
        key
      );
    }
  }

  const update: ProfileUpdate = {};

  if ("bio" in fields) {
    if (typeof fields.bio !== "string") return fail("INVALID_TYPE", "The bio must be text.", "bio");
    const bio = fields.bio.trim();
    if (hasControlCharacters(bio)) {
      return fail("INVALID_CHARACTERS", "The bio cannot contain line breaks or control characters.", "bio");
    }
    if (length(bio) > BIO_MAX_LENGTH) {
      return fail("BIO_TOO_LONG", `The bio must be ${BIO_MAX_LENGTH} characters or fewer.`, "bio");
    }
    update.bio = bio;
  }

  if ("first_name" in fields) {
    const raw = fields.first_name;
    if (raw !== null && typeof raw !== "string") {
      return fail("INVALID_TYPE", "The first name must be text, or null to remove it.", "first_name");
    }
    const name = raw === null ? "" : raw.trim();
    if (hasControlCharacters(name)) {
      return fail("INVALID_CHARACTERS", "The first name cannot contain line breaks or control characters.", "first_name");
    }
    if (length(name) > FIRST_NAME_MAX_LENGTH) {
      return fail("FIRST_NAME_TOO_LONG", `The first name must be ${FIRST_NAME_MAX_LENGTH} characters or fewer.`, "first_name");
    }
    update.first_name = name === "" ? null : name;
  }

  if ("avatar_id" in fields) {
    const id = fields.avatar_id;
    if (id !== null && !AVATAR_IDS.includes(id as AvatarId)) {
      return fail("INVALID_AVATAR", `The avatar must be one of: ${AVATAR_IDS.join(", ")}; or null for the default.`, "avatar_id");
    }
    update.avatar_id = id as AvatarId | null;
  }

  if (Object.keys(update).length === 0) {
    return fail("NOTHING_TO_UPDATE", "Nothing to change. Send bio, first_name or avatar_id.");
  }
  return { ok: true, update };
};
