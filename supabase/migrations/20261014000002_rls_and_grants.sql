-- Row Level Security and least-privilege grants.
-- Rollback: supabase/rollback/20261014000002_rls_and_grants.down.sql
--
-- IMPORTANT: RLS only protects direct database access (e.g. the Supabase client with a
-- user JWT). The Fastify server connects with a privileged role and therefore performs
-- its own authorization on every operation; RLS is defence in depth, not the only gate.

alter table public.profiles            enable row level security;
alter table public.player_preferences  enable row level security;
alter table public.games               enable row level security;
alter table public.game_rule_versions  enable row level security;
alter table public.seasons             enable row level security;
alter table public.matches             enable row level security;
alter table public.match_secrets       enable row level security;
alter table public.match_participants  enable row level security;
alter table public.match_events        enable row level security;
alter table public.player_ratings      enable row level security;
alter table public.rating_history      enable row level security;

-- Start from nothing, then grant only what is needed.
revoke all on
  public.profiles, public.player_preferences, public.games, public.game_rule_versions,
  public.seasons, public.matches, public.match_secrets, public.match_participants,
  public.match_events, public.player_ratings, public.rating_history
from anon, authenticated;

-- Helper that avoids recursive policies on match_participants.
create or replace function public.is_match_participant(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_participants mp
    where mp.match_id = p_match_id and mp.user_id = auth.uid()
  )
$$;

revoke all on function public.is_match_participant(uuid) from public;
grant execute on function public.is_match_participant(uuid) to authenticated;

-- Public reference data -----------------------------------------------------
grant select on public.games, public.game_rule_versions, public.seasons to anon, authenticated;
create policy games_read on public.games for select to anon, authenticated using (true);
create policy rule_versions_read on public.game_rule_versions for select to anon, authenticated using (true);
create policy seasons_read on public.seasons for select to anon, authenticated using (true);

-- Profiles: readable by signed-in players; users may change only avatar and locale
-- of their own row (column-level grant). Username/role changes go through the server.
grant select on public.profiles to authenticated;
grant update (avatar_id, locale) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Preferences: strictly private to the owner.
grant select, insert, update on public.player_preferences to authenticated;
create policy preferences_select_own on public.player_preferences for select to authenticated
  using (user_id = auth.uid());
create policy preferences_insert_own on public.player_preferences for insert to authenticated
  with check (user_id = auth.uid());
create policy preferences_update_own on public.player_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Matches: participants may read their own matches; nobody writes from the client.
grant select on public.matches, public.match_participants to authenticated;
create policy matches_read_participant on public.matches for select to authenticated
  using (public.is_match_participant(id));
create policy participants_read_same_match on public.match_participants for select to authenticated
  using (public.is_match_participant(match_id));

-- Event log (reveals cards played): participants only, and only after the match ended.
grant select on public.match_events to authenticated;
create policy events_read_after_completion on public.match_events for select to authenticated
  using (
    public.is_match_participant(match_id)
    and exists (select 1 from public.matches m where m.id = match_id and m.status = 'completed')
  );

-- Ratings: leaderboard data is visible to signed-in players; history is private.
grant select on public.player_ratings to authenticated;
create policy ratings_read on public.player_ratings for select to authenticated using (true);

grant select on public.rating_history to authenticated;
create policy rating_history_read_own on public.rating_history for select to authenticated
  using (user_id = auth.uid());

-- match_secrets: RLS enabled, no policies, no grants => unreachable from clients.
