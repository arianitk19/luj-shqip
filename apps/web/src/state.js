import { api } from "./api.js";
import { getAccessToken } from "./auth.js";

/** Cached account state for the signed-in user. `me` is null when signed out or backend unreachable. */
export const app = { loaded: false, signedIn: false, me: null, offline: false };

export async function refreshMe() {
  app.signedIn = Boolean(await getAccessToken());
  app.offline = false;
  app.me = null;
  if (app.signedIn) {
    try {
      const res = await api("/api/me");
      app.me = res.profile ? res : { profile: null };
    } catch (err) {
      if (err.status === 401) app.signedIn = false;
      else if (err.status === 0) app.offline = true;
    }
  }
  app.loaded = true;
}

export const hasProfile = () => Boolean(app.me?.profile);
