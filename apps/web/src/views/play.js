import { createPrivate, describeError, joinPrivate, leave, ready, session, startPublic, subscribe } from "../game-client.js";
import { h } from "../dom.js";
import { t } from "../i18n.js";
import { icon } from "../icons.js";
import { avatarEl, toast } from "../layout.js";
import { navigate } from "../router.js";

export function playView(main) {
  const body = h("div", { class: "grid gap-4" });
  main.append(h("h1", { class: "heading text-3xl font-bold mb-4" }, t("play.title")), body);
  let busy = false;
  let error = "";

  const run = async (fn) => {
    if (busy) return;
    busy = true; error = ""; paint();
    try { await fn(); } catch (err) { error = describeError(err); }
    busy = false; paint();
  };

  function paint() {
    if (session.status === "playing" || session.status === "finished") return navigate("/game");
    body.replaceChildren(session.room ? waiting() : chooser());
  }

  function chooser() {
    const code = h("input", { class: "input uppercase tracking-widest", id: "room-code", maxlength: 6, autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: t("play.codePlaceholder"), "aria-label": t("play.code") });
    return h("div", { class: "grid gap-4 md:grid-cols-2" },
      h("section", { class: "panel grid gap-3 content-start" },
        h("h2", { class: "heading text-xl font-bold flex items-center gap-2" }, icon("swords"), t("play.quick")),
        h("p", { class: "text-sand-300 text-sm" }, t("play.quickHelp")),
        h("button", { class: "btn btn-primary", type: "button", disabled: busy, onclick: () => run(startPublic) }, t("play.quick"))),
      h("section", { class: "panel grid gap-3 content-start" },
        h("h2", { class: "heading text-xl font-bold flex items-center gap-2" }, icon("lock"), t("play.privateTitle")),
        h("p", { class: "text-sand-300 text-sm" }, t("play.privateHelp")),
        h("button", { class: "btn", type: "button", disabled: busy, onclick: () => run(createPrivate) }, t("play.createRoom")),
        h("form", { class: "grid gap-2", onsubmit: (e) => { e.preventDefault(); if (code.value.trim()) run(() => joinPrivate(code.value)); } },
          h("label", { for: "room-code", class: "text-sm text-sand-300" }, t("play.code")), code,
          h("button", { class: "btn", type: "submit", disabled: busy }, t("play.joinRoom")))),
      error ? h("p", { class: "error-text md:col-span-2", role: "alert" }, error) : null,
    );
  }

  function waiting() {
    const lobby = session.lobby?.players ?? [];
    const me = session.welcome?.you?.userId;
    const mine = lobby.find((p) => p.userId === me);
    const isPrivate = session.mode === "private";
    return h("section", { class: "panel grid gap-4 max-w-xl", "aria-live": "polite" },
      lobby.length < 2
        ? h("p", { class: "text-lg" }, isPrivate ? t("play.waitingFriend") : t("play.searching"))
        : h("p", { class: "text-lg" }, mine?.ready ? t("play.waitingReady") : null),
      isPrivate && session.welcome?.code ? codeBox(session.welcome.code) : null,
      h("ul", { class: "grid gap-2" }, lobby.map((p) => h("li", { class: "flex items-center gap-3" }, avatarEl(p.avatarId, p.username), h("span", {}, p.username), p.ready ? h("span", { class: "badge badge-ok" }, "✓") : null))),
      isPrivate && lobby.length === 2 && !mine?.ready ? h("button", { class: "btn btn-primary", type: "button", onclick: ready }, t("play.ready")) : null,
      h("button", { class: "btn", type: "button", onclick: () => leave() }, isPrivate ? t("play.leaveRoom") : t("play.cancelSearch")),
    );
  }

  function codeBox(code) {
    return h("div", { class: "flex items-center gap-3" },
      h("output", { class: "heading text-4xl font-bold tracking-[0.3em] text-gold-400", "aria-label": `${t("play.code")}: ${code.split("").join(" ")}` }, code),
      h("button", { class: "btn", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(code); toast(t("common.copied")); } catch { /* clipboard blocked */ } } }, icon("copy"), t("common.copy")));
  }

  paint();
  return subscribe(paint);
}
