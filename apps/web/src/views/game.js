import { cardBack, cardEl, cardLabel } from "../cards.js";
import { dismissResult, leave, play, resign, session, subscribe } from "../game-client.js";
import { h } from "../dom.js";
import { t } from "../i18n.js";
import { icon } from "../icons.js";
import { avatarEl } from "../layout.js";
import { navigate } from "../router.js";
import { app } from "../state.js";

export function gameView(main) {
  if (!session.room && session.status !== "finished") return navigate("/play");

  const root = h("div", { class: "board" });
  main.append(root);
  let confirming = false;
  let lastPileKey = "";
  let tick = null;

  const names = () => {
    const players = session.lobby?.players ?? [];
    const me = session.welcome?.you;
    const opp = players.find((p) => p.userId !== me?.userId);
    return { me, opp };
  };
  const nameOf = (id) => {
    const { me, opp } = names();
    return id === me?.userId ? t("game.you") : (opp?.username ?? t("game.opponent"));
  };

  function describeEvent(e) {
    switch (e.type) {
      case "play": return t("game.ev.play", { who: nameOf(e.playerId), card: cardLabel(e.card) });
      case "capture":
        return e.pishti === "double" ? t("game.ev.doublePishti", { who: nameOf(e.playerId) })
          : e.pishti === "single" ? t("game.ev.pishti", { who: nameOf(e.playerId) })
          : t("game.ev.capture", { who: nameOf(e.playerId), n: e.count });
      case "hand_end": return t("game.ev.handEnd");
      case "match_start": return t("game.ev.matchStart");
      default: return null;
    }
  }

  function seatBar(info, id, cardsLeft, align) {
    const v = session.view;
    const active = v?.turn === id && session.status === "playing";
    const away = session.presence[id]?.connected === false;
    return h("div", { class: `seat ${active ? "active" : ""} ${align === "end" ? "flex-row-reverse" : ""}` },
      avatarEl(info?.avatarId ?? 1, info?.username ?? "?"),
      h("div", { class: align === "end" ? "text-right" : "" },
        h("div", { class: "font-semibold" }, id === session.welcome?.you?.userId ? t("game.you") : (info?.username ?? t("game.opponent"))),
        h("div", { class: "text-sm text-sand-300" }, `${t("game.score")}: ${v?.scores?.[id] ?? 0}`, away ? ` · ${t("common.offline")}` : "")),
      cardsLeft !== null ? h("div", { class: "flex -space-x-8", "aria-label": `${cardsLeft}` }, Array.from({ length: cardsLeft }, () => cardBack("mini"))) : null);
  }

  function paint() {
    const v = session.view;
    if (!v) {
      root.replaceChildren(h("p", { class: "panel" }, t("common.loading")));
      return;
    }
    const { me, opp } = names();
    const myTurn = v.turn === v.you && session.status === "playing";
    const pileKey = `${v.pileTop}:${v.pileCount}:${v.moveCount}`;
    const pop = pileKey !== lastPileKey;
    lastPileKey = pileKey;

    const oppAway = session.presence[v.opponent]?.connected === false;
    const status = h("div", { class: "grid gap-1 text-center" },
      h("div", { class: "turn-banner", "aria-live": "polite" }, session.status === "finished" ? "" : myTurn ? t("game.yourTurn") : t("game.theirTurn")),
      h("div", { class: "text-sm text-sand-300 flex justify-center gap-4 flex-wrap" },
        h("span", {}, t("game.hand", { n: v.handNumber })), h("span", {}, t("game.target", { n: v.targetScore })),
        h("span", { class: "timer", id: "timer" })),
      session.connection === "reconnecting" ? h("div", { class: "badge badge-soon justify-self-center", role: "status" }, icon("wifiOff"), t("game.reconnecting")) : null,
      oppAway ? h("div", { class: "badge badge-soon justify-self-center", role: "status" }, icon("wifiOff"), t("game.opponentAway", { s: Math.max(0, Math.ceil(((session.presence[v.opponent].reconnectDeadline ?? 0) - Date.now()) / 1000)) })) : null);

    const centre = h("div", { class: "centre-zone" },
      h("div", { class: "pile" }, v.stockCount > 0 ? [cardBack(), h("span", { class: "count" }, t("game.stock", { n: v.stockCount }))] : [h("div", { class: "card", style: "opacity:.15", "aria-hidden": "true" }), h("span", { class: "count" }, t("game.stock", { n: 0 }))]),
      h("div", { class: "pile" },
        v.pileTop ? cardEl(v.pileTop, { extraClass: pop ? "pile-pop" : "" }) : h("div", { class: "card", style: "opacity:.15", "aria-hidden": "true" }),
        h("span", { class: "count" }, t("game.pile", { n: v.pileCount })),
        v.centreHiddenCount ? h("span", { class: "count" }, t("game.hidden", { n: v.centreHiddenCount })) : null));

    const hand = h("div", { class: "hand", role: "group", "aria-label": t("game.you") },
      v.yourHand.map((c) => cardEl(c, { onClick: play, playable: myTurn && v.legalCards.includes(c), disabled: !myTurn || !v.legalCards.includes(c) })));

    const log = h("div", { class: "log", role: "log", "aria-live": "off" }, [...session.events].reverse().map(describeEvent).filter(Boolean).slice(0, 12).map((l) => h("div", {}, l)));
    const notice = session.notice?.kind === "rejected" && Date.now() - session.notice.at < 4000
      ? h("p", { class: "text-center text-gold-400", role: "alert" }, t(`game.rejected.${session.notice.code}`)) : null;

    root.replaceChildren(
      seatBar(opp, v.opponent, v.opponentHandCount, "start"),
      h("div", { class: "felt grid gap-4" }, status, centre, notice),
      seatBar(me, v.you, null, "start"),
      hand,
      h("div", { class: "flex flex-wrap items-center justify-between gap-3" },
        log,
        session.status === "playing" ? h("button", { class: "btn btn-danger", type: "button", onclick: () => { confirming = true; paint(); } }, icon("flag"), t("game.resign")) : null),
      ...[confirming ? resignDialog() : null, session.matchEnd ? resultDialog() : null].filter(Boolean),
    );
    updateTimer();
  }

  function resignDialog() {
    return h("div", { class: "overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "resign-title" },
      h("div", { class: "panel dialog grid gap-4" },
        h("h2", { id: "resign-title", class: "heading text-xl font-bold" }, t("game.resign")),
        h("p", {}, t("game.resignConfirm")),
        h("div", { class: "flex gap-2 justify-end" },
          h("button", { class: "btn", type: "button", onclick: () => { confirming = false; paint(); } }, t("common.cancel")),
          h("button", { class: "btn btn-danger", type: "button", onclick: () => { confirming = false; resign(); } }, t("game.resign")))));
  }

  function resultDialog() {
    const end = session.matchEnd;
    const myId = session.welcome?.you?.userId;
    const o = end.outcome;
    const result = o.winnerIds.includes(myId) ? "win" : o.loserIds.includes(myId) ? "loss" : "draw";
    const change = end.ratingChanges.find((c) => c.userId === myId);
    const reasonKey = end.unratedReason ?? "unknown";
    return h("div", { class: "overlay", role: "dialog", "aria-modal": "true", "aria-labelledby": "result-title" },
      h("div", { class: "panel dialog grid gap-3 text-center" },
        h("h2", { id: "result-title", class: "heading text-3xl font-bold " + (result === "win" ? "text-gold-400" : "") }, t(`result.${result}`)),
        h("p", { class: "text-sand-300" }, t(`result.reasons.${o.endReason}`)),
        h("p", { class: "text-lg" }, Object.entries(o.scores).map(([id, s]) => `${nameOf(id)} ${s}`).join(" — ")),
        end.persistenceFailed ? h("p", { class: "error-text" }, t("result.persistenceFailed"))
          : end.rated ? h("p", {}, `${t("result.rated")}${change ? ` · ${t("result.rating")}: ${change.before} → ${change.after} (${change.after - change.before >= 0 ? "+" : ""}${change.after - change.before})` : ""}`)
          : h("p", { class: "hint" }, `${t("result.unrated")}. ${t(`result.unratedReasons.${reasonKey}`) === `result.unratedReasons.${reasonKey}` ? "" : t(`result.unratedReasons.${reasonKey}`)}`),
        h("div", { class: "flex gap-2 justify-center flex-wrap" },
          h("a", { class: "btn", href: "#/", onclick: () => dismissResult() }, t("result.backToGames")),
          h("button", { class: "btn btn-primary", type: "button", onclick: async () => { await leave(); dismissResult(); navigate("/play"); } }, t("result.playAgain")))));
  }

  function updateTimer() {
    const el = document.getElementById("timer");
    if (!el) return;
    if (!session.turnDeadline || session.status !== "playing") { el.textContent = ""; return; }
    const secs = Math.max(0, Math.ceil((session.turnDeadline - (Date.now() + session.clockSkew)) / 1000));
    el.textContent = t("game.timeLeft", { s: secs });
    el.classList.toggle("low", secs <= 10);
  }

  tick = setInterval(updateTimer, 500);
  const unsub = subscribe(() => {
    if (!session.room && session.status === "idle") return navigate("/play");
    paint();
  });
  paint();
  void app;
  return () => { clearInterval(tick); unsub(); };
}
