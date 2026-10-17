import { describe, expect, it } from "vitest";
import {
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validatePassword,
} from "./credentials";

describe("validatePassword", () => {
  it("accepts a long phrase", () => {
    expect(validatePassword("correct horse battery staple")).toBeNull();
  });

  it("gives each refusal its own code, so a client can explain it in its own language", () => {
    expect(validatePassword(42)?.code).toBe("PASSWORD_NOT_TEXT");
    expect(validatePassword("a1b2c3d4".slice(0, MIN_PASSWORD_LENGTH - 1))?.code).toBe("PASSWORD_TOO_SHORT");
    expect(validatePassword("x".repeat(MAX_PASSWORD_BYTES + 1))?.code).toBe("PASSWORD_TOO_LONG");
    expect(validatePassword("Stocktracker")?.code).toBe("PASSWORD_TOO_COMMON");
    expect(validatePassword("abababababab")?.code).toBe("PASSWORD_TOO_SIMPLE");
  });

  it("measures the upper limit in bytes: a Hebrew letter takes two", () => {
    const half = MAX_PASSWORD_BYTES / 2;
    expect(validatePassword("אבגדהוזחטיכלמנסעפצקרשת".repeat(2).slice(0, half))).toBeNull();
    expect(validatePassword("אבגדהוזחטיכלמנסעפצקרשת".repeat(2).slice(0, half + 1))?.code).toBe("PASSWORD_TOO_LONG");
  });
});

describe("validateEmail", () => {
  it("accepts an ordinary address", () => {
    expect(validateEmail("dana@example.co.il")).toBeNull();
  });

  it("gives each refusal its own code", () => {
    expect(validateEmail(null)?.code).toBe("EMAIL_NOT_TEXT");
    expect(validateEmail("a@" + "b".repeat(MAX_EMAIL_LENGTH) + ".com")?.code).toBe("EMAIL_TOO_LONG");
    expect(validateEmail("not an address")?.code).toBe("EMAIL_INVALID");
  });
});
