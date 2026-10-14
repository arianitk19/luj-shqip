import { api } from "../api.js";
import { h } from "../dom.js";
import { t } from "../i18n.js";
import { toast } from "../layout.js";

export async function settingsView(main) {
  const box = h("div", { class: "panel max-w-lg grid gap-4" }, h("p", { class: "hint" }, t("common.loading")));
  main.append(h("h1", { class: "heading text-3xl font-bold mb-4" }, t("settings.title")), box);
  try {
    const { preferences } = await api("/api/me/preferences");
    const apply = (p) => document.documentElement.dataset.reducedMotion = String(p.reducedMotion);
    apply(preferences);
    const row = (key, label) => {
      const input = h("input", { type: "checkbox", id: `pref-${key}`, checked: preferences[key], class: "size-5 accent-[var(--color-flag-500)]",
        onchange: async () => {
          try {
            const res = await api("/api/me/preferences", { method: "PATCH", body: { [key]: input.checked } });
            Object.assign(preferences, res.preferences);
            apply(preferences);
            toast(t("settings.saved"));
          } catch {
            input.checked = !input.checked;
            toast(t("common.unexpected"));
          }
        } });
      return h("label", { class: "flex items-center justify-between gap-4 min-h-11", for: `pref-${key}` }, h("span", {}, label), input);
    };
    box.replaceChildren(
      row("reducedMotion", t("settings.reducedMotion")),
      row("soundEnabled", t("settings.sound")),
      row("showOnlineStatus", t("settings.showOnline")),
      row("allowFriendRequests", t("settings.friendRequests")),
      h("p", { class: "hint" }, t("settings.note")));
  } catch {
    box.replaceChildren(h("p", {}, t("common.offline")));
  }
}
