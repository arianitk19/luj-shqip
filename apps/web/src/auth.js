import { api } from "./api.js";
import { authMode, config } from "./config.js";

// Two adapters behind one interface:
//  - "supabase": real accounts (sign-up, e-mail verification, password recovery) — production.
//  - "dev": passwordless fixture against the server's /api/dev/login — local development only.
// The access token is the only credential the app ever holds; it is sent as a Bearer header.

let supabase = null;
let devToken = null;
const listeners = new Set();

try {
  devToken = sessionStorage.getItem("ls_dev_token");
} catch {
  /* storage unavailable (private mode): stay signed out across reloads */
}

async function sb() {
  if (!supabase) {
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    supabase.auth.onAuthStateChange(() => listeners.forEach((fn) => fn()));
  }
  return supabase;
}

export const onAuthChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export async function getAccessToken() {
  if (authMode === "dev") return devToken;
  if (authMode === "supabase") {
    const { data } = await (await sb()).auth.getSession();
    return data.session?.access_token ?? null;
  }
  return null;
}

export async function isSignedIn() {
  return Boolean(await getAccessToken());
}

export async function devLogin(username) {
  const { token } = await api("/api/dev/login", { method: "POST", body: { username }, auth: false });
  devToken = token;
  try {
    sessionStorage.setItem("ls_dev_token", token);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export async function signUp(email, password) {
  const { data, error } = await (await sb()).auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) throw error;
  return { needsEmailConfirmation: !data.session };
}

export async function signIn(email, password) {
  const { error } = await (await sb()).auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const { error } = await (await sb()).auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) throw error;
}

export async function signOut() {
  if (authMode === "dev") {
    devToken = null;
    try {
      sessionStorage.removeItem("ls_dev_token");
    } catch {
      /* ignore */
    }
  } else if (authMode === "supabase") {
    await (await sb()).auth.signOut();
  }
  listeners.forEach((fn) => fn());
}
