/* ===========================================================================
   Game achievement evaluation.
   ---------------------------------------------------------------------------
   Pure: given the catalog, what is known about a player, and what they have
   already unlocked, decide each achievement's state and which ones unlock
   now. The service (service.ts) loads the facts and writes the grants.

   Each achievement names a condition_type; its target and params are data
   from the catalog, so a threshold changes without touching this file.

   Several conditions depend on systems the platform does not have yet:
   following, subscriptions and competitions. Their facts are left undefined
   until those systems exist, and the evaluator then reports the achievement
   as blocked by that dependency rather than pretending progress is zero.
   When a system ships, its loader fills the fact and these start working
   with no change here.
   =========================================================================== */

export type Dependency = "nicknames" | "follows" | "subscriptions" | "competitions";

export interface AchievementDef {
  id: string;
  category_id: string;
  condition_type: string;
  target_value: number | null;
  condition_params: Record<string, unknown>;
  prerequisite_ids: string[];
  xp_reward: number;
}

export interface PlayerFacts {
  created_at: Date;
  nickname: string | null;
  first_name: string | null;
  bio: string;
  /** Every portfolio ever opened, open or closed. */
  portfolios: { created_at: Date; closed_at: Date | null }[];
  title_selected: boolean;
  // Systems not built yet: undefined until they exist.
  following?: number;
  followers?: number;
  paying_subscribers?: number;
  subscriptions?: {
    /** Distinct players with a valid paid subscription, ever. */
    distinct_players: number;
    /** Distinct players subscribed to after already following them. */
    after_following: number;
    /** Longest run of consecutive paid billing months to one player. */
    max_consecutive_months: number;
  };
  competitions?: {
    entered: number;
    completed: number;
    /** Entered a new competition after completing one. */
    entered_after_completing: boolean;
    distinct_months: number;
  };
}

export interface FoundingPeriod {
  /** ISO date (YYYY-MM-DD) or null. Inclusive. */
  start: string | null;
  end: string | null;
}

export interface EvaluationContext {
  defs: AchievementDef[];
  facts: PlayerFacts;
  unlocked: ReadonlySet<string>;
  founding: FoundingPeriod;
  now: Date;
}

export interface Evaluation {
  met: boolean;
  /** Measurable progress, for the collection's progress bars. */
  progress: { current: number; target: number } | null;
  /** Systems that must exist before this can be earned; empty when none. */
  blocked_by: Dependency[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const count = (current: number, target: number): Evaluation => ({
  met: current >= target,
  progress: { current: Math.min(current, target), target },
  blocked_by: [],
});

const flag = (met: boolean): Evaluation => ({ met, progress: null, blocked_by: [] });

const blocked = (...deps: Dependency[]): Evaluation => ({ met: false, progress: null, blocked_by: deps });

// Whole days a portfolio has been open: until now, or until it was closed.
const daysOpen = (p: PlayerFacts["portfolios"][number], now: Date): number =>
  Math.floor(((p.closed_at ?? now).getTime() - p.created_at.getTime()) / DAY_MS);

const inFoundingPeriod = (createdAt: Date, period: FoundingPeriod): boolean => {
  if (!period.end) return false; // no launch period set yet: nobody qualifies
  const afterStart = !period.start || createdAt.getTime() >= Date.parse(`${period.start}T00:00:00Z`);
  const beforeEnd = createdAt.getTime() < Date.parse(`${period.end}T00:00:00Z`) + DAY_MS;
  return afterStart && beforeEnd;
};

export const evaluate = (def: AchievementDef, ctx: EvaluationContext): Evaluation => {
  const { facts, unlocked, now } = ctx;
  const target = def.target_value ?? 1;

  switch (def.condition_type) {
    case "account_created":
      return flag(true);

    case "nickname_chosen":
      // The nickname column exists but nothing sets it yet.
      return facts.nickname ? flag(true) : blocked("nicknames");

    case "profile_completed":
      // The basic profile is what the player can fill in today: first name and bio.
      return count(Number(!!facts.first_name?.trim()) + Number(!!facts.bio.trim()), 2);

    case "portfolios_opened":
      return count(facts.portfolios.length, target);

    case "title_selected":
      return flag(facts.title_selected);

    case "portfolio_open_days": {
      const need = Number(def.condition_params.portfolios ?? 1);
      const ages = facts.portfolios.map((p) => daysOpen(p, now));
      if (need <= 1) return count(Math.max(0, ...ages), target);
      return count(ages.filter((d) => d >= target).length, need);
    }

    case "founding_member":
      return flag(inFoundingPeriod(facts.created_at, ctx.founding));

    case "prerequisites": {
      // Waits for whatever its unmet prerequisites wait for, so Ready, Set,
      // Invest! says it needs follows and usernames rather than look reachable.
      const ids = def.prerequisite_ids;
      const result = count(ids.filter((id) => unlocked.has(id)).length, ids.length);
      const waiting = new Set<Dependency>();
      for (const id of ids) {
        const prereq = ctx.defs.find((d) => d.id === id);
        if (!prereq || unlocked.has(id) || prereq.condition_type === "prerequisites") continue;
        evaluate(prereq, ctx).blocked_by.forEach((dep) => waiting.add(dep));
      }
      return { ...result, blocked_by: result.met ? [] : [...waiting] };
    }

    case "achievements_unlocked":
      return count(unlocked.size, target);

    case "categories_covered": {
      const categoryOf = new Map(ctx.defs.map((d) => [d.id, d.category_id]));
      const covered = new Set(
        [...unlocked].map((id) => categoryOf.get(id)).filter((c) => c && c !== def.category_id)
      );
      return count(covered.size, target);
    }

    case "players_followed":
      return facts.following === undefined ? blocked("follows") : count(facts.following, target);

    case "followers":
      return facts.followers === undefined ? blocked("follows") : count(facts.followers, target);

    case "paying_subscribers":
      return facts.paying_subscribers === undefined
        ? blocked("subscriptions")
        : count(facts.paying_subscribers, target);

    case "subscriptions_purchased":
      return facts.subscriptions === undefined
        ? blocked("subscriptions")
        : count(facts.subscriptions.distinct_players, target);

    case "subscribed_after_following":
      if (facts.subscriptions === undefined || facts.following === undefined) {
        return blocked(...(facts.following === undefined ? ["follows" as const] : []), "subscriptions");
      }
      return count(facts.subscriptions.after_following, target);

    case "subscription_consecutive_months":
      return facts.subscriptions === undefined
        ? blocked("subscriptions")
        : count(facts.subscriptions.max_consecutive_months, target);

    case "competitions_entered":
      return facts.competitions === undefined ? blocked("competitions") : count(facts.competitions.entered, target);

    case "competitions_completed":
      return facts.competitions === undefined ? blocked("competitions") : count(facts.competitions.completed, target);

    case "competition_reentry":
      return facts.competitions === undefined
        ? blocked("competitions")
        : flag(facts.competitions.entered_after_completing);

    case "competition_months":
      return facts.competitions === undefined
        ? blocked("competitions")
        : count(facts.competitions.distinct_months, target);

    case "full_experience": {
      const missing: Dependency[] = [];
      if (facts.subscriptions === undefined) missing.push("subscriptions");
      if (facts.competitions === undefined) missing.push("competitions");
      if (missing.length) return blocked(...missing);
      const parts = [
        facts.portfolios.length > 0,
        facts.subscriptions!.distinct_players > 0,
        facts.competitions!.entered > 0,
      ];
      return count(parts.filter(Boolean).length, parts.length);
    }

    case "both_sides":
      if (facts.subscriptions === undefined || facts.paying_subscribers === undefined) return blocked("subscriptions");
      return count(
        Number(facts.subscriptions.distinct_players > 0) + Number(facts.paying_subscribers > 0),
        2
      );

    default:
      // An unknown type in the database must never grant anything.
      return { met: false, progress: null, blocked_by: [] };
  }
};

// Achievements that unlock now, in catalog order. Repeats until nothing new
// unlocks, because one unlock can complete another (The First Five, The Grand
// Tour, Ready, Set, Invest!). Each pass adds at least one id or stops, so it
// ends within defs.length passes and can never grant the same id twice.
export const newlyUnlocked = (ctx: EvaluationContext): string[] => {
  const unlocked = new Set(ctx.unlocked);
  const added: string[] = [];
  for (let pass = 0; pass <= ctx.defs.length; pass++) {
    const fresh = ctx.defs.filter((d) => !unlocked.has(d.id) && evaluate(d, { ...ctx, unlocked }).met);
    if (fresh.length === 0) break;
    for (const d of fresh) {
      unlocked.add(d.id);
      added.push(d.id);
    }
  }
  return added;
};
