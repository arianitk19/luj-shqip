import { h } from "./dom.js";

const SUITS = { S: "♠", H: "♥", D: "♦", C: "♣" };
const SUIT_NAMES = { S: "maç", H: "kupa", D: "karo", C: "spathi" };
const RANK_NAMES = { A: "As", K: "Mbreti", Q: "Dama", J: "Fanti" };

export function parseCard(id) {
  return { rank: id.slice(0, -1), suit: id.slice(-1) };
}

export function cardLabel(id) {
  const { rank, suit } = parseCard(id);
  return `${RANK_NAMES[rank] ?? rank} ${SUIT_NAMES[suit] ?? suit}`;
}

/** A face-up card. Pass `onClick` to make it a button (the hand); otherwise it is a static image. */
export function cardEl(id, { onClick, playable = false, disabled = false, extraClass = "" } = {}) {
  const { rank, suit } = parseCard(id);
  const red = suit === "H" || suit === "D";
  const inner = [
    h("span", { class: "corner", "aria-hidden": "true" }, h("span", {}, rank), h("small", {}, SUITS[suit])),
    h("span", { class: "centre", "aria-hidden": "true" }, SUITS[suit]),
  ];
  const cls = `card ${red ? "red" : ""} ${playable ? "playable" : ""} ${extraClass}`.trim();
  if (onClick) {
    return h("button", { class: cls, type: "button", "aria-label": cardLabel(id), disabled, onclick: () => onClick(id) }, inner);
  }
  return h("div", { class: cls, role: "img", "aria-label": cardLabel(id) }, inner);
}

export const cardBack = (extraClass = "") => h("div", { class: `card back ${extraClass}`.trim(), "aria-hidden": "true" });
