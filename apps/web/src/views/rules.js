import { h } from "../dom.js";
import { t, tList } from "../i18n.js";

export function rulesView(main) {
  main.append(
    h("div", { class: "panel max-w-3xl" },
      h("h1", { class: "heading text-3xl font-bold" }, t("rules.title")),
      h("p", { class: "mt-3 text-gold-400" }, t("rules.status")),
      h("ul", { class: "mt-4 grid gap-3 list-disc pl-5 text-sand-100" }, tList("rules.items").map((r) => h("li", {}, r)))),
  );
}
