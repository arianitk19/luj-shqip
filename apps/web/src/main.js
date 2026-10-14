import "./styles.css";
import { authMode } from "./config.js";
import { getAccessToken, onAuthChange } from "./auth.js";
import { renderShell } from "./layout.js";
import { setLocale } from "./i18n.js";
import { currentPath, navigate, resolve, route, setNotFound } from "./router.js";
import { dismissResult, resumeIfPossible, session } from "./game-client.js";
import { app, hasProfile, refreshMe } from "./state.js";
import { authView } from "./views/auth.js";
import { gameView } from "./views/game.js";
import { homeView } from "./views/home.js";
import { leaderboardView } from "./views/leaderboard.js";
import { meView } from "./views/me.js";
import { playView } from "./views/play.js";
import { rulesView } from "./views/rules.js";
import { settingsView } from "./views/settings.js";
import { setupView } from "./views/setup.js";
import { h } from "./dom.js";
import { t } from "./i18n.js";

setLocale("sq");

route("/", homeView);
route("/login", authView);
route("/setup", setupView, { auth: true });
route("/play", playView, { auth: true, profile: true });
route("/game", gameView, { auth: true, profile: true });
route("/leaderboard", leaderboardView);
route("/me", meView, { auth: true, profile: true });
route("/settings", settingsView, { auth: true, profile: true });
route("/rules", rulesView);
setNotFound((container) => container.append(h("div", { class: "panel" }, h("p", {}, t("errors.notFound")), h("a", { class: "btn mt-4", href: "#/" }, t("nav.games")))));

const root = document.getElementById("app");
let cleanup = null;
let renderToken = 0;

async function render() {
  const token = ++renderToken;
  cleanup?.();
  cleanup = null;
  if (!app.loaded) await refreshMe();
  if (token !== renderToken) return;

  const r = resolve();
  if (r.auth && !app.signedIn) return navigate("/login");
  if ((r.profile || currentPath() === "/") && app.signedIn && !hasProfile() && !app.offline) return navigate("/setup");
  // An unfinished match always pulls the player back to the board.
  if (session.room && session.status === "playing" && currentPath() !== "/game") return navigate("/game");
  // Leaving a finished match's result screen by any route simply closes it.
  if (session.status === "finished" && currentPath() !== "/game") dismissResult();

  const main = renderShell(root);
  const out = await r.handler(main, { app, render });
  if (token === renderToken && typeof out === "function") cleanup = out;
  main.focus({ preventScroll: true });
}

window.addEventListener("hashchange", render);
onAuthChange(async () => {
  await refreshMe();
  render();
});

(async () => {
  if (authMode === "supabase") await getAccessToken(); // lets Supabase consume a confirmation/recovery redirect
  await refreshMe();
  if (app.signedIn && hasProfile()) await resumeIfPossible();
  await render();
  if (session.room && session.status !== "idle") navigate("/game");
})();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
