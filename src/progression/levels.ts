/* ===========================================================================
   Levels and title tiers.
   ---------------------------------------------------------------------------
   Pure arithmetic over the configured thresholds (table level_thresholds).
   The XP needed for each level is a product decision that has not been
   made, so nothing here assumes a curve: with no thresholds every player is
   level 1, and the progress figures say so instead of inventing a target.

   Title tiers are fixed by the Player Title spec: tier n covers levels
   5n-4..5n and unlocks on its FIRST level (1, 6, 11, ... 96).
   =========================================================================== */

export const MAX_LEVEL = 100;
export const LEVELS_PER_TIER = 5;
export const MAX_TIER = MAX_LEVEL / LEVELS_PER_TIER;

export interface Threshold {
  level: number;
  xp_required: number;
  is_provisional?: boolean;
}

export const tierOfLevel = (level: number): number =>
  Math.min(MAX_TIER, Math.floor((Math.max(1, level) - 1) / LEVELS_PER_TIER) + 1);

export const tierUnlockLevel = (tier: number): number => LEVELS_PER_TIER * (tier - 1) + 1;

const byLevel = (thresholds: Threshold[]): Map<number, Threshold> =>
  new Map(thresholds.filter((t) => t.level >= 2 && t.level <= MAX_LEVEL).map((t) => [t.level, t]));

// The highest level whose threshold is met, walking up from 1. A missing
// level stops the walk, so a partly filled table never skips a level.
export const levelFor = (xp: number, thresholds: Threshold[]): number => {
  const map = byLevel(thresholds);
  let level = 1;
  for (let next = 2; next <= MAX_LEVEL; next++) {
    const t = map.get(next);
    if (!t || xp < t.xp_required) break;
    level = next;
  }
  return level;
};

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP at which the current level began; 0 at level 1. */
  current_level_xp: number;
  /** null at level 100, or when the next level has no threshold yet. */
  next_level: number | null;
  next_level_xp: number | null;
  /** False while level_thresholds is empty. */
  thresholds_configured: boolean;
  /** True when any configured threshold is still marked provisional. */
  thresholds_provisional: boolean;
  /** Level at which the next title tier unlocks; null after the last tier. */
  next_title_level: number | null;
}

export const progressFor = (xp: number, thresholds: Threshold[]): LevelProgress => {
  const map = byLevel(thresholds);
  const level = levelFor(xp, thresholds);
  const next = level < MAX_LEVEL ? map.get(level + 1) : undefined;
  const tier = tierOfLevel(level);
  return {
    level,
    xp,
    current_level_xp: level === 1 ? 0 : map.get(level)!.xp_required,
    next_level: next ? next.level : null,
    next_level_xp: next ? next.xp_required : null,
    thresholds_configured: map.size > 0,
    thresholds_provisional: [...map.values()].some((t) => t.is_provisional !== false),
    next_title_level: tier < MAX_TIER ? tierUnlockLevel(tier + 1) : null,
  };
};
