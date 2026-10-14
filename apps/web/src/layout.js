import { signOut } from "./auth.js";
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";
import { currentPath, navigate } from "./router.js";
import { app } from "./state.js";

const NAV = [
  { path: "/", label: "nav.games", icon: "swords" },
  { path: "/leaderboard", label: "nav.leaderboard", icon: "trophy" },
  { path: "/me", label: "nav.profile", icon: "user", auth: true },
  { path: "/settings", label: "nav.settings", icon: "settings", auth: true },
];

function link(item, className = "nav-link") {
  const current = currentPath() === item.path;
  return h("a", { class: className, href: `#${item.path}`, "aria-current": current ? "page" : undefined }, icon(item.icon), h("span", {}, t(item.label)));
}

export function renderShell(root) {
  const items = NAV.filter((n) => !n.auth || app.signedIn);
  const main = h("main", { id: "main", class: "shell page", tabindex: "-1" });
  const userArea = app.signedIn
    ? h("button", { class: "btn btn-ghost", type: "button", onclick: async () => { await signOut(); navigate("/"); } }, icon("logOut"), h("span", { class: "sr-only md:not-sr-only" }, t("nav.logout")))
    : h("a", { class: "btn btn-primary", href: "#/login" }, t("nav.login"));

  root.replaceChildren(
    h("header", { class: "topbar" },
      h("div", { class: "shell topbar-inner" },
        h("a", { class: "brand", href: "#/" }, icon("layers"), h("span", {}, "Luj ", h("b", {}, "Shqip"))),
        h("nav", { class: "nav-desktop", "aria-label": "Kryesore" }, items.map((i) => link(i))),
        h("div", { class: "ml-auto flex items-center gap-2" },
          app.me?.profile ? h("span", { class: "text-sm text-sand-300 hidden sm:inline" }, app.me.profile.username) : null,
          userArea))),
    main,
    h("nav", { class: "tabbar", "aria-label": "Kryesore (celular)" }, items.map((i) => link(i, ""))),
  );
  return main;
}

export function toast(message, ms = 3500) {
  const el = h("div", { class: "toast", role: "status" }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

export const avatarColors = ["#e8bd5c", "#d4202c", "#7fd1b9", "#8fb8ff", "#f29e4c", "#c59bff", "#9be564", "#ff8fab", "#5fd3f3", "#ffd166", "#b8c0ff", "#ef8354"];
export function avatarEl(avatarId, name, large = false) {
  return h("span", { class: `avatar ${large ? "avatar-lg" : ""}`, style: `background:${avatarColors[(avatarId - 1) % avatarColors.length]}`, role: "img", "aria-label": name }, (name?.[0] ?? "?").toUpperCase());
}
