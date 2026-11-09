import { describe, expect, it } from "vitest";
import { holdCutoff, nextNicknameChangeAt, nicknameKey, validateNickname } from "./nickname";
import { validateProfileUpdate } from "./playerProfile";

const code = (raw: unknown) => {
  const r = validateNickname(raw);
  return r.ok ? "OK" : r.code;
};

describe("validateNickname", () => {
  it("accepts English, Hebrew, digits, _ and . and keeps the case as typed", () => {
    expect(validateNickname("Gal_Omer.92")).toEqual({ ok: true, nickname: "Gal_Omer.92", key: "gal_omer.92" });
    expect(validateNickname("גל_עומר")).toEqual({ ok: true, nickname: "גל_עומר", key: "גל_עומר" });
    expect(code("דנהK7")).toBe("OK");
    expect(code("שלום")).toBe("OK"); // final mem
  });

  it("trims spaces and drops one leading @", () => {
    expect(validateNickname("  @dana  ")).toMatchObject({ ok: true, nickname: "dana" });
  });

  it("measures length in characters, Hebrew included", () => {
    expect(code("ab")).toBe("NICKNAME_TOO_SHORT");
    expect(code("גל")).toBe("NICKNAME_TOO_SHORT");
    expect(code("abc")).toBe("OK");
    expect(code("א".repeat(20))).toBe("OK");
    expect(code("a".repeat(21))).toBe("NICKNAME_TOO_LONG");
  });

  it("refuses spaces, symbols, niqqud and other scripts", () => {
    expect(code("gal omer")).toBe("NICKNAME_INVALID_CHARACTERS");
    expect(code("gal-omer")).toBe("NICKNAME_INVALID_CHARACTERS");
    expect(code("gal@x")).toBe("NICKNAME_INVALID_CHARACTERS");
    expect(code("שָׁלוֹם")).toBe("NICKNAME_INVALID_CHARACTERS");
    expect(code("Gаl")).toBe("NICKNAME_INVALID_CHARACTERS"); // Cyrillic a, a look-alike
    expect(code("gal😀")).toBe("NICKNAME_INVALID_CHARACTERS");
  });

  it("refuses dots at either end or doubled", () => {
    expect(code(".gal")).toBe("NICKNAME_INVALID_DOTS");
    expect(code("gal.")).toBe("NICKNAME_INVALID_DOTS");
    expect(code("g..al")).toBe("NICKNAME_INVALID_DOTS");
    expect(code("g.a.l")).toBe("OK");
  });

  it("needs at least one letter", () => {
    expect(code("12345")).toBe("NICKNAME_NEEDS_LETTER");
    expect(code("1_2.3")).toBe("NICKNAME_NEEDS_LETTER");
  });

  it("refuses reserved names in any case, dotted or underscored", () => {
    expect(code("Admin")).toBe("NICKNAME_RESERVED");
    expect(code("ad.min")).toBe("NICKNAME_RESERVED");
    expect(code("_support_")).toBe("NICKNAME_RESERVED");
    expect(code("מנהל")).toBe("NICKNAME_RESERVED");
    expect(code("admin2")).toBe("OK");
  });

  it("refuses an empty or non-text username: it cannot be removed", () => {
    expect(code(null)).toBe("NICKNAME_REQUIRED");
    expect(code("  ")).toBe("NICKNAME_REQUIRED");
    expect(code("@")).toBe("NICKNAME_REQUIRED");
    expect(code(42)).toBe("NICKNAME_REQUIRED");
  });

  it("compares without regard to case", () => {
    expect(nicknameKey("GaL")).toBe(nicknameKey("gal"));
  });
});

describe("nextNicknameChangeAt", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  it("is null before a first choice and once 30 days have passed", () => {
    expect(nextNicknameChangeAt(null, now)).toBeNull();
    expect(nextNicknameChangeAt(new Date("2026-10-10T12:00:00Z"), now)).toBeNull();
  });
  it("is 30 days after the last change while that is still ahead", () => {
    expect(nextNicknameChangeAt(new Date("2026-11-01T08:00:00Z"), now)?.toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });
  it("holds a given-up name for 30 days", () => {
    expect(holdCutoff(now).toISOString()).toBe("2026-10-10T12:00:00.000Z");
  });
});

describe("validateProfileUpdate with a username", () => {
  it("passes the cleaned username on, with the other fields", () => {
    expect(validateProfileUpdate({ nickname: "@Dana_K", bio: "hi" })).toEqual({ ok: true, update: { nickname: "Dana_K", bio: "hi" } });
  });
  it("names the field and the rule when it is refused", () => {
    expect(validateProfileUpdate({ nickname: "a b" })).toMatchObject({ ok: false, code: "NICKNAME_INVALID_CHARACTERS", field: "nickname" });
    expect(validateProfileUpdate({ nickname: null })).toMatchObject({ ok: false, code: "NICKNAME_REQUIRED", field: "nickname" });
  });
});
