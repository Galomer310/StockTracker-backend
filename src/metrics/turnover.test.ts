import { describe, expect, it } from "vitest";
import { turnoverEvent } from "./turnover";

describe("turnoverEvent", () => {
  it("is 100% when the whole portfolio is swapped", () => {
    expect(turnoverEvent({ A: 1 }, { B: 1 })).toBeCloseTo(1, 12);
  });

  it("is 0 when nothing changes", () => {
    expect(turnoverEvent({ A: 0.6, B: 0.4 }, { A: 0.6, B: 0.4 })).toBe(0);
  });

  it("counts a partial rebalance once, not twice", () => {
    // 10% moved from A to B: |−0.1| + |+0.1| = 0.2, halved to 10%.
    expect(turnoverEvent({ A: 0.6, B: 0.4 }, { A: 0.5, B: 0.5 })).toBeCloseTo(0.1, 12);
  });

  it("depends on whether cash is one of the weights", () => {
    // From 50% AAPL / 50% cash, buy 25% MSFT. The undecided rule, both readings:
    const withCash = turnoverEvent({ AAPL: 0.5, CASH: 0.5 }, { AAPL: 0.5, MSFT: 0.25, CASH: 0.25 });
    const investedOnly = turnoverEvent({ AAPL: 1 }, { AAPL: 0.5 / 0.75, MSFT: 0.25 / 0.75 });
    expect(withCash).toBeCloseTo(0.25, 12);
    expect(investedOnly).toBeCloseTo(1 / 3, 12);
  });
});
