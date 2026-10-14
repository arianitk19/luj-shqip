import { z } from "zod";

/** Names that could be mistaken for staff or the platform itself. Compared case-insensitively. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "moderator", "mod", "support", "system", "root", "staff", "official",
  "lujshqip", "luj_shqip", "luj", "bot", "null", "undefined", "anonymous", "guest", "help",
]);

export const usernameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{3,20}$/, "Emri i përdoruesit duhet të ketë 3–20 karaktere: shkronja, numra ose _.")
  .refine((v) => !RESERVED_USERNAMES.has(v.toLowerCase()), "Ky emër përdoruesi është i rezervuar.");

export const avatarIdSchema = z.number().int().min(1).max(12);

export const createProfileBody = z.object({ username: usernameSchema, avatarId: avatarIdSchema.default(1) }).strict();

export const updateMeBody = z
  .object({ avatarId: avatarIdSchema.optional(), locale: z.enum(["sq", "en"]).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nuk ka asnjë ndryshim për t'u ruajtur.");

export const updatePreferencesBody = z
  .object({
    reducedMotion: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    showOnlineStatus: z.boolean().optional(),
    allowFriendRequests: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nuk ka asnjë ndryshim për t'u ruajtur.");

export const gameIdSchema = z.string().regex(/^[a-z0-9_]{1,32}$/);

export const leaderboardQuery = z.object({
  game: gameIdSchema.default("pishpirik"),
  season: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.iso.datetime().optional(),
});

export const usernameParam = z.object({ username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/) });

export const devLoginBody = z.object({ username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/) }).strict();

export const roomCodeBody = z
  .object({ code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/, "Kodi nuk është i vlefshëm.") })
  .strict();
