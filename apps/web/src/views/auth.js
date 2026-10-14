import { devLogin, requestPasswordReset, signIn, signUp } from "../auth.js";
import { authMode } from "../config.js";
import { h } from "../dom.js";
import { t } from "../i18n.js";
import { navigate } from "../router.js";
import { app } from "../state.js";

export function authView(main) {
  if (app.signedIn) return navigate("/");
  if (authMode === "none") return main.append(h("div", { class: "panel max-w-lg" }, h("p", {}, t("auth.notConfigured"))));
  if (authMode === "dev") return main.append(devForm());
  main.append(supabaseForm());
}

function devForm() {
  const error = h("p", { class: "error-text", role: "alert" });
  const username = h("input", { class: "input", id: "dev-username", required: true, pattern: "[A-Za-z0-9_]{3,20}", minlength: 3, maxlength: 20, autocomplete: "username" });
  return h("form", { class: "panel max-w-md grid gap-4",
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = "";
      try {
        await devLogin(username.value.trim());
        navigate("/");
      } catch {
        error.textContent = t("auth.errors.generic");
      }
    } },
    h("h1", { class: "heading text-2xl font-bold" }, t("auth.title")),
    h("p", { class: "badge badge-soon" }, t("auth.devNotice")),
    h("div", { class: "field" }, h("label", { for: "dev-username" }, t("auth.devUsername")), username),
    error,
    h("button", { class: "btn btn-primary", type: "submit" }, t("auth.devEnter")));
}

function supabaseForm() {
  let mode = "signin";
  const message = h("p", { role: "status", class: "text-gold-400" });
  const error = h("p", { class: "error-text", role: "alert" });
  const email = h("input", { class: "input", id: "email", type: "email", autocomplete: "email", required: true });
  const password = h("input", { class: "input", id: "password", type: "password", autocomplete: "current-password", required: true, minlength: 8 });
  const submit = h("button", { class: "btn btn-primary", type: "submit" });
  const toggle = h("button", { class: "btn btn-ghost", type: "button" });
  const forgot = h("button", { class: "btn btn-ghost", type: "button" }, t("auth.forgot"));
  const title = h("h1", { class: "heading text-2xl font-bold" });
  const paint = () => {
    title.textContent = t("auth.title");
    submit.textContent = mode === "signin" ? t("auth.signIn") : t("auth.signUp");
    toggle.textContent = mode === "signin" ? t("auth.switchToSignUp") : t("auth.switchToSignIn");
    password.autocomplete = mode === "signin" ? "current-password" : "new-password";
  };
  toggle.onclick = () => { mode = mode === "signin" ? "signup" : "signin"; paint(); };
  forgot.onclick = async () => {
    error.textContent = ""; message.textContent = "";
    if (!email.value) return email.focus();
    try { await requestPasswordReset(email.value.trim()); } catch { /* same message either way: no account enumeration */ }
    message.textContent = t("auth.resetSent");
  };
  paint();
  return h("form", { class: "panel max-w-md grid gap-4",
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = ""; message.textContent = "";
      submit.disabled = true;
      try {
        if (mode === "signup") {
          const { needsEmailConfirmation } = await signUp(email.value.trim(), password.value);
          if (needsEmailConfirmation) return void (message.textContent = t("auth.checkEmail"));
        } else {
          await signIn(email.value.trim(), password.value);
        }
        navigate("/");
      } catch {
        error.textContent = t("auth.errors.generic");
      } finally {
        submit.disabled = false;
      }
    } },
    title,
    h("div", { class: "field" }, h("label", { for: "email" }, t("auth.email")), email),
    h("div", { class: "field" }, h("label", { for: "password" }, t("auth.password")), password),
    message, error, submit,
    h("div", { class: "flex flex-wrap justify-between" }, toggle, forgot));
}
