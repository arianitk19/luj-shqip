import { createHash } from "node:crypto";

/**
 * Deterministic, cryptographically strong random stream: SHA-256 in counter mode.
 *
 * Given the same (seed, label) it always yields the same bytes, which makes
 * shuffles reproducible for tests and for reconstructing a match from its seed
 * plus its action log. Because the output is a hash stream (not an LCG/xorshift),
 * observing dealt cards does not let a player recover the internal state.
 *
 * The seed itself must be secret and come from a CSPRNG (crypto.randomBytes).
 */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). Unbiased (rejection sampling). */
  nextInt(maxExclusive: number): number;
}

export function createRng(seed: string, label = ""): Rng {
  let counter = 0;
  let buffer = Buffer.alloc(0);
  let offset = 0;

  const refill = () => {
    buffer = createHash("sha256").update(`${seed}\u0000${label}\u0000${counter++}`).digest();
    offset = 0;
  };

  const nextUint32 = (): number => {
    if (offset + 4 > buffer.length) refill();
    const value = buffer.readUInt32BE(offset);
    offset += 4;
    return value;
  };

  return {
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
        throw new RangeError(`nextInt: invalid bound ${maxExclusive}`);
      }
      const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
      let value = nextUint32();
      while (value >= limit) value = nextUint32();
      return value % maxExclusive;
    },
  };
}

/** Fisher–Yates shuffle returning a new array; input is not mutated. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}
