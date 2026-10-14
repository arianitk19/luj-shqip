import { createRemoteJWKSet, errors as joseErrors, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";

export interface AuthUser {
  userId: string;
  email?: string;
}

export type AuthErrorCode = "missing_token" | "invalid_token" | "expired_token";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function toAuthUser(run: () => Promise<{ payload: { sub?: string; email?: unknown } }>): Promise<AuthUser> {
  try {
    const { payload } = await run();
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) {
      throw new AuthError("invalid_token", "Token subject is not a valid user id.");
    }
    return { userId: payload.sub.toLowerCase(), email: typeof payload.email === "string" ? payload.email : undefined };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof joseErrors.JWTExpired) throw new AuthError("expired_token", "Token has expired.");
    // Deliberately uniform: never tell the caller *why* a signature/claim check failed.
    throw new AuthError("invalid_token", "Token is not valid.");
  }
}

/**
 * Production verifier: Supabase Auth access tokens, checked against the project's JWKS.
 *
 * Only asymmetric algorithms are accepted. Pinning the algorithm list is what blocks the
 * classic "alg: none" and HS256-signed-with-the-public-key confusion attacks.
 */
export function createJwksVerifier(options: {
  issuer: string;
  audience: string;
  jwksUrl: string;
  /** Test hook: supply keys directly instead of fetching a URL. */
  getKey?: JWTVerifyGetKey;
}): TokenVerifier {
  const getKey =
    options.getKey ??
    createRemoteJWKSet(new URL(options.jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
  return {
    verify: (token) =>
      toAuthUser(() =>
        jwtVerify(token, getKey, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ["ES256", "RS256", "EdDSA"],
          clockTolerance: 5,
          requiredClaims: ["sub", "exp"],
        }),
      ),
  };
}

export const DEV_ISSUER = "luj-shqip-dev";

/** LOCAL DEVELOPMENT / TEST ONLY (HS256 with a shared secret). Config refuses to enable it in production. */
export function createDevVerifier(options: { secret: string; audience: string }): TokenVerifier {
  const key = new TextEncoder().encode(options.secret);
  return {
    verify: (token) =>
      toAuthUser(() =>
        jwtVerify(token, key, {
          issuer: DEV_ISSUER,
          audience: options.audience,
          algorithms: ["HS256"],
          requiredClaims: ["sub", "exp"],
        }),
      ),
  };
}

export async function issueDevToken(options: {
  secret: string;
  audience: string;
  userId: string;
  ttlSeconds?: number;
}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(options.userId)
    .setIssuer(DEV_ISSUER)
    .setAudience(options.audience)
    .setIssuedAt()
    .setExpirationTime(`${options.ttlSeconds ?? 3600}s`)
    .sign(new TextEncoder().encode(options.secret));
}

/** Extracts the token from an `Authorization: Bearer <token>` header value. */
export function bearerToken(header: string | undefined): string {
  if (!header) throw new AuthError("missing_token", "Authentication required.");
  const match = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/.exec(header);
  if (!match) throw new AuthError("invalid_token", "Malformed Authorization header.");
  return match[1] as string;
}
