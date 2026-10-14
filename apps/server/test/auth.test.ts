import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuthError,
  bearerToken,
  createDevVerifier,
  createJwksVerifier,
  DEV_ISSUER,
  issueDevToken,
  type TokenVerifier,
} from "../src/auth/verifier.ts";

const ISSUER = "https://example-project.supabase.co/auth/v1";
const AUDIENCE = "authenticated";

let jwksServer: http.Server;
let verifier: TokenVerifier;
let signingKey: PrivateKey;
let otherKey: PrivateKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  const other = await generateKeyPair("ES256");
  signingKey = pair.privateKey;
  otherKey = other.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "ES256", use: "sig" };

  // A real HTTP JWKS endpoint, so the production code path (remote key set) is what is tested.
  jwksServer = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", r));
  const { port } = jwksServer.address() as AddressInfo;
  verifier = createJwksVerifier({ issuer: ISSUER, audience: AUDIENCE, jwksUrl: `http://127.0.0.1:${port}/jwks.json` });
});
afterAll(async () => {
  await new Promise<void>((r) => jwksServer.close(() => r()));
});

async function token(
  overrides: { sub?: string; iss?: string; aud?: string; exp?: string | number; key?: PrivateKey; kid?: string } = {},
) {
  const jwt = new SignJWT({ email: "player@example.test" })
    .setProtectedHeader({ alg: "ES256", kid: overrides.kid ?? "test-key" })
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? "1h");
  if (overrides.sub !== "") jwt.setSubject(overrides.sub ?? randomUUID());
  return jwt.sign(overrides.key ?? signingKey);
}

const rejects = (promise: Promise<unknown>, code: AuthError["code"]) =>
  expect(promise).rejects.toMatchObject({ name: "AuthError", code });

describe("Supabase JWKS verifier", () => {
  it("accepts a valid token and returns the user id", async () => {
    const sub = randomUUID();
    await expect(verifier.verify(await token({ sub }))).resolves.toEqual({ userId: sub, email: "player@example.test" });
  });

  it("rejects an expired token with a distinct code", async () => {
    await rejects(verifier.verify(await token({ exp: Math.floor(Date.now() / 1000) - 3600 })), "expired_token");
  });

  it("rejects the wrong issuer and the wrong audience", async () => {
    await rejects(verifier.verify(await token({ iss: "https://evil.example/auth/v1" })), "invalid_token");
    await rejects(verifier.verify(await token({ aud: "anon" })), "invalid_token");
  });

  it("rejects a token signed by a different key, even with the right key id", async () => {
    await rejects(verifier.verify(await token({ key: otherKey })), "invalid_token");
  });

  it("rejects a missing or non-UUID subject", async () => {
    await rejects(verifier.verify(await token({ sub: "" })), "invalid_token");
    await rejects(verifier.verify(await token({ sub: "admin" })), "invalid_token");
  });

  it("rejects alg=none tokens", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ sub: randomUUID(), iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
    await rejects(verifier.verify(`${header}.${body}.`), "invalid_token");
  });

  it("rejects HS256 algorithm-confusion tokens signed with the public key material", async () => {
    const publicJwkJson = JSON.stringify({ kty: "EC", crv: "P-256" });
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: "test-key" })
      .setSubject(randomUUID())
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(publicJwkJson));
    await rejects(verifier.verify(forged), "invalid_token");
  });

  it("rejects garbage and tampered tokens without leaking the reason", async () => {
    await rejects(verifier.verify("not.a.jwt"), "invalid_token");
    await rejects(verifier.verify(""), "invalid_token");
    const good = await token();
    const [h, , s] = good.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ sub: randomUUID(), iss: ISSUER, aud: AUDIENCE, exp: 9999999999 })).toString("base64url");
    await rejects(verifier.verify(`${h}.${forgedBody}.${s}`), "invalid_token");
  });
});

describe("dev verifier (local only)", () => {
  const secret = "d".repeat(40);
  const dev = createDevVerifier({ secret, audience: AUDIENCE });

  it("round-trips a dev token", async () => {
    const userId = randomUUID();
    const t = await issueDevToken({ secret, audience: AUDIENCE, userId });
    await expect(dev.verify(t)).resolves.toMatchObject({ userId });
  });

  it("rejects tokens signed with a different secret, and Supabase-style tokens", async () => {
    const forged = await issueDevToken({ secret: "e".repeat(40), audience: AUDIENCE, userId: randomUUID() });
    await rejects(dev.verify(forged), "invalid_token");
    await rejects(dev.verify(await token()), "invalid_token");
  });

  it("is not accepted by the production verifier", async () => {
    const t = await issueDevToken({ secret, audience: AUDIENCE, userId: randomUUID() });
    await rejects(verifier.verify(t), "invalid_token");
    expect(DEV_ISSUER).not.toBe(ISSUER);
  });
});

describe("bearerToken", () => {
  it("extracts a well-formed bearer token", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });
  it("rejects missing and malformed headers", () => {
    expect(() => bearerToken(undefined)).toThrow(AuthError);
    for (const bad of ["", "Basic abc", "Bearer", "Bearer a b", "bearer abc", "Bearer abc; drop table"]) {
      expect(() => bearerToken(bad), bad).toThrow(AuthError);
    }
  });
});
