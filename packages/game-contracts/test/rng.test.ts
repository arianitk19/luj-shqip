import { describe, expect, it } from "vitest";
import { createRng, shuffled } from "../src/index.ts";

describe("createRng", () => {
  it("is deterministic for the same seed and label", () => {
    const a = createRng("seed-1", "x");
    const b = createRng("seed-1", "x");
    const seqA = Array.from({ length: 50 }, () => a.nextInt(1000));
    const seqB = Array.from({ length: 50 }, () => b.nextInt(1000));
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds and labels", () => {
    const base = Array.from({ length: 20 }, (_, i) => i);
    const s1 = shuffled(base, createRng("seed-1", "x"));
    const s2 = shuffled(base, createRng("seed-2", "x"));
    const s3 = shuffled(base, createRng("seed-1", "y"));
    expect(s1).not.toEqual(s2);
    expect(s1).not.toEqual(s3);
  });

  it("stays within bounds and rejects invalid bounds", () => {
    const rng = createRng("bounds");
    for (let i = 0; i < 2000; i++) {
      const v = rng.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-1)).toThrow(RangeError);
    expect(() => rng.nextInt(1.5)).toThrow(RangeError);
  });

  it("is roughly uniform", () => {
    const rng = createRng("uniform");
    const counts = new Array<number>(6).fill(0);
    const n = 60000;
    for (let i = 0; i < n; i++) counts[rng.nextInt(6)]! += 1;
    for (const c of counts) expect(Math.abs(c - n / 6)).toBeLessThan(n * 0.02);
  });
});

describe("shuffled", () => {
  it("returns a permutation and does not mutate the input", () => {
    const input = Array.from({ length: 52 }, (_, i) => i);
    const copy = input.slice();
    const out = shuffled(input, createRng("perm"));
    expect(input).toEqual(copy);
    expect([...out].sort((a, b) => a - b)).toEqual(copy);
    expect(out).not.toEqual(copy);
  });
});
