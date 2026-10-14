import { describe, expect, it } from "vitest";
import { h } from "../src/dom.js";
import { cardEl, cardLabel, parseCard } from "../src/cards.js";
import { setLocale, t } from "../src/i18n.js";
import sq from "../src/locales/sq.js";

describe("DOM helper", () => {
  it("never interprets text as HTML (usernames cannot inject markup)", () => {
    const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';
    const el = h("div", {}, evil);
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toBe(evil);
  });
  it("drops null/false children instead of printing them", () => {
    expect(h("div", {}, null, false, undefined, "x").textContent).toBe("x");
  });
});

describe("cards", () => {
  it("parses ids with a two-digit rank", () => {
    expect(parseCard("10D")).toEqual({ rank: "10", suit: "D" });
    expect(cardLabel("JC")).toBe("Fanti spathi");
  });
  it("renders hand cards as buttons that call back with the card id", () => {
    let got = null;
    const el = cardEl("AS", { onClick: (id) => (got = id), playable: true });
    el.click();
    expect(el.tagName).toBe("BUTTON");
    expect(got).toBe("AS");
  });
});

describe("i18n", () => {
  setLocale("sq");
  it("interpolates and flags missing keys visibly", () => {
    expect(t("game.stock", { n: 7 })).toBe("Shtylla: 7");
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
  it("has no empty strings in the Albanian dictionary", () => {
    const walk = (o, path = "") => Object.entries(o).flatMap(([k, v]) => typeof v === "string" ? (v.trim() === "" ? [`${path}${k}`] : []) : Array.isArray(v) ? [] : walk(v, `${path}${k}.`));
    expect(walk(sq)).toEqual([]);
  });
});
