import { api } from "../api.js";
import { h } from "../dom.js";
import { t } from "../i18n.js";
import { avatarColors, avatarEl } from "../layout.js";
import { navigate } from "../router.js";
import { hasProfile, refreshMe } from "../state.js";

export function setupView(main) {
  if (hasProfile()) return navigate("/");
  let avatarId = 1;
  const error = h("p", { class: "error-text", role: "alert" });
  const username = h("input", { class: "input", id: "username", name: "username", autocomplete: "username", required: true, minlength: 3, maxlength: 20, pattern: "[A-Za-z0-9_]{3,20}", "aria-describedby": "username-help" });
  const picker = h("div", { class: "flex flex-wrap gap-2", role: "radiogroup", "aria-label": t("setup.avatar") });
  const paint = () => picker.replaceChildren(...avatarColors.map((_, i) => {
    const id = i + 1;
    return h("button", { type: "button", role: "radio", "aria-checked": String(id === avatarId), "aria-label": `${t("setup.avatar")} ${id}`, class: `rounded-full p-1 ${id === avatarId ? "ring-4 ring-gold-400" : ""}`, onclick: () => { avatarId = id; paint(); } }, avatarEl(id, username.value || "?"));
  }));
  paint();
  username.addEventListener("input", paint);

  const submit = h("button", { class: "btn btn-primary", type: "submit" }, t("setup.submit"));
  const form = h("form", { class: "panel max-w-md grid gap-4", novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      try {
        await api("/api/profile", { method: "POST", body: { username: username.value.trim(), avatarId } });
        await refreshMe();
        navigate("/");
      } catch (err) {
        error.textContent = t(`setup.errors.${err.code}`) !== `setup.errors.${err.code}` ? t(`setup.errors.${err.code}`) : err.status === 0 ? t("common.offline") : t("common.unexpected");
      } finally {
        submit.disabled = false;
      }
    } },
    h("h1", { class: "heading text-2xl font-bold" }, t("setup.title")),
    h("div", { class: "field" }, h("label", { for: "username" }, t("setup.username")), username, h("p", { class: "hint", id: "username-help" }, t("setup.usernameHelp"))),
    h("div", { class: "field" }, h("span", { class: "text-sm text-sand-300" }, t("setup.avatar")), picker),
    error, submit);
  main.append(form);
}
