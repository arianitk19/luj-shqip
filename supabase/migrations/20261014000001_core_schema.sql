-- LUJ SHQIP core schema.
-- Depends on Supabase's auth.users. Rollback: supabase/rollback/20261014000001_core_schema.down.sql

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    citext not null unique,
  avatar_id   smallint not null default 1 check (avatar_id between 1 and 12),
  role        text not null default 'player' check (role in ('player', 'moderator', 'admin')),
  locale      text not null default 'sq' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_username_format check (username::text ~ '^[A-Za-z0-9_]{3,20}$')
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.player_preferences (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  reduced_motion        boolean not null default false,
  sound_enabled         boolean not null default true,
  show_online_status    boolean not null default true,
  allow_friend_requests boolean not null default true,
  updated_at            timestamptz not null default now()
);

create trigger player_preferences_set_updated_at
  before update on public.player_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Games and rule versions
-- ---------------------------------------------------------------------------
create table public.games (
  id           text primary key check (id ~ '^[a-z0-9_]+$'),
  name         text not null,
  status       text not null check (status in ('available', 'coming_soon')),
  min_players  smallint not null check (min_players >= 1),
  max_players  smallint not null check (max_players >= min_players),
  sort_order   smallint not null default 100
);

-- Reference data (not user data). Only games with a finished, tested engine are 'available'.
insert into public.games (id, name, status, min_players, max_players, sort_order) values
  ('pishpirik',    'Pishpirik',     'available',   2, 2, 10),
  ('mos_u_zemero', 'Mos u Zemëro',  'coming_soon', 2, 4, 20),
  ('domino',       'Domino',        'coming_soon', 2, 4, 30);

-- Every match records the exact rule version it was played under.
create table public.game_rule_versions (
  game_id              text not null references public.games (id),
  rule_version         text not null,
  confirmation_status  text not null check (confirmation_status in ('unconfirmed-regional', 'confirmed')),
  sources              text[] not null default '{}',
  config               jsonb not null,
  created_at           timestamptz not null default now(),
  primary key (game_id, rule_version)
);

create table public.seasons (
  id         integer generated always as identity primary key,
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  is_active  boolean not null default false,
  check (ends_at > starts_at)
);

-- At most one active season at any time.
create unique index seasons_single_active on public.seasons (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- Matches
-- ---------------------------------------------------------------------------
create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  game_id       text not null,
  rule_version  text not null,
  mode          text not null check (mode in ('public', 'private')),
  status        text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  end_reason    text check (end_reason in ('normal', 'forfeit', 'timeout', 'abandoned')),
  season_id     integer references public.seasons (id),
  -- Decided by the server when the match completes; NULL while in progress.
  rated         boolean,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz,
  foreign key (game_id, rule_version) references public.game_rule_versions (game_id, rule_version),
  constraint matches_completed_fields check (
    (status = 'completed') = (ended_at is not null)
    and (status = 'completed') = (end_reason is not null)
    and (status = 'completed') = (rated is not null)
  )
);

create index matches_in_progress_idx on public.matches (created_at) where status = 'in_progress';
create index matches_game_ended_idx on public.matches (game_id, ended_at desc) where status = 'completed';

-- Secret shuffle seed: required to rebuild an in-progress match after a crash.
-- Never exposed to clients (no grants, RLS enabled with no policies).
create table public.match_secrets (
  match_id  uuid primary key references public.matches (id) on delete cascade,
  seed      text not null check (length(seed) >= 16)
);

create table public.match_participants (
  match_id       uuid not null references public.matches (id) on delete cascade,
  user_id        uuid not null references public.profiles (id),
  seat           smallint not null check (seat >= 0),
  score          integer,
  result         text check (result in ('win', 'loss', 'draw')),
  rating_before  integer,
  rating_after   integer,
  primary key (match_id, user_id),
  unique (match_id, seat)
);

create index match_participants_user_idx on public.match_participants (user_id, match_id);

-- Accepted action log: lets us verify results and rebuild a match from its seed.
create table public.match_events (
  match_id    uuid not null references public.matches (id) on delete cascade,
  seq         integer not null check (seq >= 1),
  user_id     uuid references public.profiles (id),
  action      jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (match_id, seq)
);

-- ---------------------------------------------------------------------------
-- Ratings (only verified, rated, completed matches ever touch these tables)
-- ---------------------------------------------------------------------------
create table public.player_ratings (
  user_id          uuid not null references public.profiles (id),
  game_id          text not null references public.games (id),
  season_id        integer not null references public.seasons (id),
  rating           integer not null default 1200 check (rating >= 100),
  games_played     integer not null default 0 check (games_played >= 0),
  wins             integer not null default 0 check (wins >= 0),
  losses           integer not null default 0 check (losses >= 0),
  draws            integer not null default 0 check (draws >= 0),
  -- Positive = current win streak, negative = current loss streak.
  current_streak   integer not null default 0,
  best_win_streak  integer not null default 0 check (best_win_streak >= 0),
  updated_at       timestamptz not null default now(),
  primary key (user_id, game_id, season_id),
  constraint player_ratings_counts_consistent check (wins + losses + draws = games_played)
);

create index player_ratings_leaderboard_idx
  on public.player_ratings (game_id, season_id, rating desc, games_played desc);

create trigger player_ratings_set_updated_at
  before update on public.player_ratings
  for each row execute function public.set_updated_at();

-- The primary key (match_id, user_id) is the idempotency backstop: a participant's
-- rating can change at most once per match, even if completion is attempted twice.
create table public.rating_history (
  match_id       uuid not null references public.matches (id) on delete cascade,
  user_id        uuid not null references public.profiles (id),
  game_id        text not null references public.games (id),
  season_id      integer not null references public.seasons (id),
  rating_before  integer not null,
  rating_after   integer not null,
  created_at     timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index rating_history_user_idx on public.rating_history (user_id, created_at desc);
