-- Reverts 20261014000001_core_schema.sql
-- DESTRUCTIVE: deletes all game data (profiles, matches, ratings). Take a backup first.

drop table if exists public.rating_history;
drop table if exists public.player_ratings;
drop table if exists public.match_events;
drop table if exists public.match_participants;
drop table if exists public.match_secrets;
drop table if exists public.matches;
drop table if exists public.seasons;
drop table if exists public.game_rule_versions;
drop table if exists public.games;
drop table if exists public.player_preferences;
drop table if exists public.profiles;
drop function if exists public.set_updated_at();
-- The citext extension is intentionally left installed (it may be used elsewhere).
