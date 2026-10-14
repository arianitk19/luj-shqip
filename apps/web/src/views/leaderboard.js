import { api } from "../api.js";
import { clear, h } from "../dom.js";
import { t } from "../i18n.js";
import { avatarEl } from "../layout.js";

export async function leaderboardView(main) {
  const body = h("div", {}, h("p", { class: "hint" }, t("common.loading")));
  main.append(h("h1", { class: "heading text-3xl font-bold mb-4" }, t("board.title")), h("div", { class: "panel overflow-x-auto" }, body));
  try {
    const { entries } = await api("/api/leaderboard?game=pishpirik&limit=50", { auth: false });
    clear(body);
    if (!entries.length) return body.append(h("p", { class: "text-sand-300" }, t("board.empty")));
    body.append(
      h("table", { class: "table" },
        h("caption", { class: "sr-only" }, t("board.season")),
        h("thead", {}, h("tr", {}, h("th", { class: "num" }, t("board.rank")), h("th", {}, t("board.player")), h("th", { class: "num" }, t("board.rating")), h("th", { class: "num" }, t("board.played")), h("th", { class: "num" }, t("board.wins")), h("th", { class: "num" }, t("board.winRate")))),
        h("tbody", {}, entries.map((e) =>
          h("tr", {},
            h("td", { class: "num" }, e.rank),
            h("td", {}, h("span", { class: "flex items-center gap-2" }, avatarEl(e.avatarId, e.username), e.username)),
            h("td", { class: "num font-semibold" }, e.rating),
            h("td", { class: "num" }, e.gamesPlayed),
            h("td", { class: "num" }, e.wins),
            h("td", { class: "num" }, `${e.winRate}%`))))),
    );
  } catch {
    clear(body);
    body.append(h("p", {}, t("common.offline")), h("button", { class: "btn mt-3", type: "button", onclick: () => location.reload() }, t("common.retry")));
  }
}
