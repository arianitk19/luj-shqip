import { api } from "../api.js";
import { h } from "../dom.js";
import { t } from "../i18n.js";
import { icon } from "../icons.js";
import { app } from "../state.js";

export async function homeView(main) {
  const list = h("div", { class: "grid gap-4 md:grid-cols-2 lg:grid-cols-3" }, h("p", { class: "hint" }, t("common.loading")));
  main.append(
    h("section", { class: "mb-8" },
      h("h1", { class: "heading text-3xl md:text-5xl font-bold text-sand-50" }, t("app.tagline")),
      h("p", { class: "mt-2 text-sand-300" }, t("home.subtitle"))),
    list,
  );

  try {
    const { games } = await api("/api/games", { auth: false });
    list.replaceChildren(...games.map(gameCard));
  } catch {
    list.replaceChildren(h("div", { class: "panel-muted" }, h("p", {}, t("home.backendDown")), h("button", { class: "btn mt-3", type: "button", onclick: () => location.reload() }, t("common.retry"))));
  }
}

function gameCard(game) {
  const available = game.status === "available";
  return h("article", { class: `panel flex flex-col gap-3 ${available ? "" : "opacity-80"}` },
    h("div", { class: "flex items-start justify-between gap-3" },
      h("h2", { class: "heading text-2xl font-bold" }, game.name),
      h("span", { class: `badge ${available ? "badge-ok" : "badge-soon"}` }, available ? t("home.available") : t("home.comingSoon"))),
    h("p", { class: "text-sm text-sand-300 flex items-center gap-2" }, icon("users"), game.minPlayers === game.maxPlayers ? t("home.playersExact", { min: game.minPlayers }) : t("home.players", { min: game.minPlayers, max: game.maxPlayers })),
    available
      ? [
          game.rules ? h("p", { class: "hint" }, t(`home.rulesStatus.${game.rules.confirmationStatus}`)) : null,
          h("div", { class: "mt-auto flex flex-wrap gap-2" },
            h("a", { class: "btn btn-primary", href: app.signedIn ? "#/play" : "#/login" }, icon("swords"), t("home.play")),
            h("a", { class: "btn", href: "#/rules" }, icon("bookOpen"), t("nav.rules"))),
        ]
      : h("p", { class: "hint mt-auto" }, t("home.comingSoonNote")),
  );
}
