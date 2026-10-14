-- Reverts 20261014000002_rls_and_grants.sql
-- WARNING: after this, tables fall back to the platform's default (broad) privileges.

drop policy if exists rating_history_read_own on public.rating_history;
drop policy if exists ratings_read on public.player_ratings;
drop policy if exists events_read_after_completion on public.match_events;
drop policy if exists participants_read_same_match on public.match_participants;
drop policy if exists matches_read_participant on public.matches;
drop policy if exists preferences_update_own on public.player_preferences;
drop policy if exists preferences_insert_own on public.player_preferences;
drop policy if exists preferences_select_own on public.player_preferences;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_read on public.profiles;
drop policy if exists seasons_read on public.seasons;
drop policy if exists rule_versions_read on public.game_rule_versions;
drop policy if exists games_read on public.games;

drop function if exists public.is_match_participant(uuid);

alter table public.rating_history      disable row level security;
alter table public.player_ratings      disable row level security;
alter table public.match_events        disable row level security;
alter table public.match_participants  disable row level security;
alter table public.match_secrets       disable row level security;
alter table public.matches             disable row level security;
alter table public.seasons             disable row level security;
alter table public.game_rule_versions  disable row level security;
alter table public.games               disable row level security;
alter table public.player_preferences  disable row level security;
alter table public.profiles            disable row level security;
