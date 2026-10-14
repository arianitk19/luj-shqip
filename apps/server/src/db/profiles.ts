import type { Db } from "./pool.ts";

export interface Profile {
  id: string;
  username: string;
  avatarId: number;
  role: "player" | "moderator" | "admin";
  locale: string;
  createdAt: string;
}

interface ProfileRow {
  id: string;
  username: string;
  avatar_id: number;
  role: Profile["role"];
  locale: string;
  created_at: Date;
}

const COLUMNS = "id, username::text as username, avatar_id, role, locale, created_at";

function map(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    avatarId: row.avatar_id,
    role: row.role,
    locale: row.locale,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getProfile(db: Db, userId: string): Promise<Profile | null> {
  const { rows } = await db.query<ProfileRow>(`select ${COLUMNS} from public.profiles where id = $1`, [userId]);
  return rows[0] ? map(rows[0]) : null;
}

export async function getProfileByUsername(db: Db, username: string): Promise<Profile | null> {
  const { rows } = await db.query<ProfileRow>(
    `select ${COLUMNS} from public.profiles where username = $1`,
    [username],
  );
  return rows[0] ? map(rows[0]) : null;
}

export type CreateProfileResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: "username_taken" | "profile_exists" };

/** Creates the profile (and default preferences) for an authenticated user. */
export async function createProfile(
  db: Db,
  input: { userId: string; username: string; avatarId: number },
): Promise<CreateProfileResult> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<ProfileRow>(
      `insert into public.profiles (id, username, avatar_id)
       values ($1, $2, $3) returning ${COLUMNS}`,
      [input.userId, input.username, input.avatarId],
    );
    await client.query("insert into public.player_preferences (user_id) values ($1)", [input.userId]);
    await client.query("commit");
    return { ok: true, profile: map(rows[0] as ProfileRow) };
  } catch (error) {
    await client.query("rollback");
    const e = error as { code?: string; constraint?: string };
    if (e.code === "23505") {
      return { ok: false, reason: e.constraint === "profiles_pkey" ? "profile_exists" : "username_taken" };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateProfile(
  db: Db,
  userId: string,
  patch: { avatarId?: number; locale?: string },
): Promise<Profile | null> {
  const { rows } = await db.query<ProfileRow>(
    `update public.profiles
        set avatar_id = coalesce($2, avatar_id), locale = coalesce($3, locale)
      where id = $1 returning ${COLUMNS}`,
    [userId, patch.avatarId ?? null, patch.locale ?? null],
  );
  return rows[0] ? map(rows[0]) : null;
}

export interface Preferences {
  reducedMotion: boolean;
  soundEnabled: boolean;
  showOnlineStatus: boolean;
  allowFriendRequests: boolean;
}

export async function getPreferences(db: Db, userId: string): Promise<Preferences | null> {
  const { rows } = await db.query(
    `select reduced_motion, sound_enabled, show_online_status, allow_friend_requests
       from public.player_preferences where user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return r
    ? {
        reducedMotion: r.reduced_motion,
        soundEnabled: r.sound_enabled,
        showOnlineStatus: r.show_online_status,
        allowFriendRequests: r.allow_friend_requests,
      }
    : null;
}

export async function updatePreferences(
  db: Db,
  userId: string,
  patch: Partial<Preferences>,
): Promise<Preferences | null> {
  const { rows } = await db.query(
    `update public.player_preferences
        set reduced_motion = coalesce($2, reduced_motion),
            sound_enabled = coalesce($3, sound_enabled),
            show_online_status = coalesce($4, show_online_status),
            allow_friend_requests = coalesce($5, allow_friend_requests)
      where user_id = $1
  returning reduced_motion, sound_enabled, show_online_status, allow_friend_requests`,
    [userId, patch.reducedMotion ?? null, patch.soundEnabled ?? null, patch.showOnlineStatus ?? null, patch.allowFriendRequests ?? null],
  );
  const r = rows[0];
  return r
    ? {
        reducedMotion: r.reduced_motion,
        soundEnabled: r.sound_enabled,
        showOnlineStatus: r.show_online_status,
        allowFriendRequests: r.allow_friend_requests,
      }
    : null;
}
