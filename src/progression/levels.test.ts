import { describe, expect, it } from "vitest";
import { levelFor, progressFor, Threshold, tierOfLevel, tierUnlockLevel } from "./levels";

// Test thresholds only: 100 XP per level. Not a production curve.
const linear: Threshold[] = Array.from({ length: 99 }, (_, i) => ({ level: i + 2, xp_required: (i + 1) * 100 }));

describe("title tiers", () => {
  it("unlocks on levels 1, 6, 11 ... 96, not 5, 10, 15", () => {
    expect([1, 5, 6, 10, 11, 26, 30, 56, 96, 100].map(tierOfLevel)).toEqual([1, 1, 2, 2, 3, 6, 6, 12, 20, 20]);
    expect([1, 2, 6, 12, 20].map(tierUnlockLevel)).toEqual([1, 6, 26, 56, 96]);
  });
});

describe("levelFor", () => {
  it("keeps everyone at level 1 while no thresholds are configured", () => {
    expect(levelFor(0, [])).toBe(1);
    expect(levelFor(1_000_000, [])).toBe(1);
  });

  it("reaches a level exactly at its threshold", () => {
    expect(levelFor(99, linear)).toBe(1);
    expect(levelFor(100, linear)).toBe(2);
    expect(levelFor(2900, linear)).toBe(30);
  });

  it("caps at level 100", () => {
    expect(levelFor(10_000_000, linear)).toBe(100);
  });

  it("stops at a gap instead of skipping levels", () => {
    const gappy = linear.filter((t) => t.level !== 5);
    expect(levelFor(10_000, gappy)).toBe(4);
  });
});

describe("progressFor", () => {
  it("reports unconfigured thresholds instead of inventing a target", () => {
    expect(progressFor(250, [])).toEqual({
      level: 1,
      xp: 250,
      current_level_xp: 0,
      next_level: null,
      next_level_xp: null,
      thresholds_configured: false,
      thresholds_provisional: false,
      next_title_level: 6,
    });
  });

  it("gives the current band and the next title tier", () => {
    expect(progressFor(2950, linear)).toMatchObject({
      level: 30,
      current_level_xp: 2900,
      next_level: 31,
      next_level_xp: 3000,
      thresholds_configured: true,
      thresholds_provisional: true,
      next_title_level: 31,
    });
  });

  it("has no next level or tier at level 100", () => {
    expect(progressFor(10_000_000, linear)).toMatchObject({ level: 100, next_level: null, next_title_level: null });
  });

  it("is not provisional once every threshold is confirmed", () => {
    const confirmed = linear.map((t) => ({ ...t, is_provisional: false }));
    expect(progressFor(0, confirmed).thresholds_provisional).toBe(false);
  });
});
