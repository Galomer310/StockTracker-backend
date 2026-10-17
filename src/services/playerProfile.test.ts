import { describe, expect, it } from "vitest";
import { validateProfileUpdate } from "./playerProfile";

describe("validateProfileUpdate", () => {
  it("accepts a bio and a first name, trimmed", () => {
    expect(validateProfileUpdate({ bio: "  Growth investor.  ", first_name: " Dana " })).toEqual({
      ok: true,
      update: { bio: "Growth investor.", first_name: "Dana" },
    });
  });

  it("accepts either field alone", () => {
    expect(validateProfileUpdate({ bio: "Hi" })).toEqual({ ok: true, update: { bio: "Hi" } });
    expect(validateProfileUpdate({ first_name: "Dana" })).toEqual({ ok: true, update: { first_name: "Dana" } });
  });

  it("allows an empty bio", () => {
    expect(validateProfileUpdate({ bio: "   " })).toEqual({ ok: true, update: { bio: "" } });
  });

  it("clears the first name with null or an empty string", () => {
    expect(validateProfileUpdate({ first_name: null })).toEqual({ ok: true, update: { first_name: null } });
    expect(validateProfileUpdate({ first_name: "  " })).toEqual({ ok: true, update: { first_name: null } });
  });

  it("counts characters, not bytes, at the 100-character bio limit", () => {
    expect(validateProfileUpdate({ bio: "א".repeat(100) }).ok).toBe(true);
    expect(validateProfileUpdate({ bio: "😀".repeat(100) }).ok).toBe(true);
    expect(validateProfileUpdate({ bio: "א".repeat(101) })).toMatchObject({ ok: false, code: "BIO_TOO_LONG", field: "bio" });
  });

  it("measures the limit after trimming", () => {
    expect(validateProfileUpdate({ bio: `  ${"x".repeat(100)}  ` }).ok).toBe(true);
  });

  it("caps the first name at 50 characters", () => {
    expect(validateProfileUpdate({ first_name: "n".repeat(50) }).ok).toBe(true);
    expect(validateProfileUpdate({ first_name: "n".repeat(51) })).toMatchObject({ ok: false, code: "FIRST_NAME_TOO_LONG" });
  });

  it("refuses line breaks and control characters", () => {
    expect(validateProfileUpdate({ bio: "one\ntwo" })).toMatchObject({ ok: false, code: "INVALID_CHARACTERS", field: "bio" });
    expect(validateProfileUpdate({ first_name: "Da\u0000na" })).toMatchObject({ ok: false, code: "INVALID_CHARACTERS", field: "first_name" });
  });

  it("refuses fields the player may not edit, saying which", () => {
    expect(validateProfileUpdate({ nickname: "taken" })).toMatchObject({ ok: false, code: "NOT_EDITABLE", field: "nickname" });
    expect(validateProfileUpdate({ bio: "ok", level: 99 })).toMatchObject({ ok: false, code: "NOT_EDITABLE", field: "level" });
  });

  it("refuses wrong types", () => {
    expect(validateProfileUpdate({ bio: 5 })).toMatchObject({ ok: false, code: "INVALID_TYPE", field: "bio" });
    expect(validateProfileUpdate({ bio: null })).toMatchObject({ ok: false, code: "INVALID_TYPE" });
    expect(validateProfileUpdate({ first_name: ["Dana"] })).toMatchObject({ ok: false, code: "INVALID_TYPE" });
  });

  it("refuses an empty request and a non-object body", () => {
    expect(validateProfileUpdate({})).toMatchObject({ ok: false, code: "NOTHING_TO_UPDATE" });
    expect(validateProfileUpdate(null)).toMatchObject({ ok: false, code: "INVALID_BODY" });
    expect(validateProfileUpdate([])).toMatchObject({ ok: false, code: "INVALID_BODY" });
    expect(validateProfileUpdate("bio")).toMatchObject({ ok: false, code: "INVALID_BODY" });
  });
});
