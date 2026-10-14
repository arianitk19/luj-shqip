import { api } from "../api.js";
import { clear, h } from "../dom.js";
import { t } from "../i18n.js";
import { avatarEl } from "../layout.js";
import { app } from "../state.js";

export async function meView(main) {
  // Always fetch fresh stats: matches may have finished since the page loaded.
  try {
    app.me = await api("/api/me");
  } catch {
    /* fall back to the cached copy */
  }
  const profile = app.me.profile;
  const stats = app.me.stats;
  const hist = h("div", {}, h("p", { class: "hint" }, t("common.loading")));
  const stat = (label, value) => h("div", { class: "panel text-center" }, h("div", { class: "heading text-3xl font-bold text-gold-400" }, value), h("div", { class: "text-sm text-sand-300" }, label));

  main.append(
    h("div", { class: "flex items-center gap-4 mb-6" }, avatarEl(profile.avatarId, profile.username, true), h("h1", { class: "heading text-3xl font-bold" }, profile.username)),
    h("h2", { class: "heading text-xl font-bold mb-3" }, t("profile.stats")),
    h("div", { class: "grid grid-cols-2 md:grid-cols-4 gap-3 mb-8" },
      stat(t("profile.rating"), stats?.rating?.rating ?? "—"),
      stat(t("profile.played"), stats?.gamesPlayed ?? 0),
      stat(t("profile.wins"), stats?.wins ?? 0),
      stat(t("profile.winRate"), `${stats?.winRate ?? 0}%`),
      stat(t("profile.losses"), stats?.losses ?? 0),
      stat(t("profile.draws"), stats?.draws ?? 0),
      stat(t("profile.streak"), stats?.rating?.currentStreak ?? 0),
      stat(t("profile.best"), stats?.rating?.bestWinStreak ?? 0)),
    h("h2", { class: "heading text-xl font-bold mb-3" }, t("profile.history")),
    h("div", { class: "panel overflow-x-auto" }, hist),
  );

  try {
    const { matches } = await api("/api/me/matches?limit=20");
    clear(hist);
    if (!matches.length) return hist.append(h("p", { class: "text-sand-300" }, t("profile.noHistory")));
    hist.append(h("ul", { class: "grid gap-2" }, matches.map((m) => h("li", { class: "flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-700 pt-2 first:border-0 first:pt-0" },
      h("span", { class: m.result === "win" ? "badge badge-ok" : "badge" }, t(`profile.result.${m.result ?? "draw"}`)),
      h("span", {}, m.opponent ? t("profile.vs", { name: m.opponent.username }) : "—"),
      h("span", { class: "tabular-nums" }, m.score !== null && m.opponent?.score !== null ? `${m.score}–${m.opponent.score}` : ""),
      h("span", { class: "hint tabular-nums" }, m.rated && m.ratingBefore !== null ? `${m.ratingBefore} → ${m.ratingAfter}` : t("result.unrated")),
      h("span", { class: "hint ml-auto" }, new Date(m.endedAt).toLocaleDateString("sq-AL"))))));
  } catch {
    clear(hist);
    hist.append(h("p", {}, t("common.offline")));
  }
}
