const routes = new Map();
let notFound = () => {};

export const route = (path, handler, options = {}) => routes.set(path, { handler, ...options });
export const setNotFound = (fn) => (notFound = fn);
export const navigate = (path) => {
  if (location.hash === `#${path}`) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = path;
};
export const currentPath = () => {
  const raw = location.hash.slice(1).split("?")[0];
  // Anything that is not a path (e.g. Supabase auth tokens in the hash) is treated as the home page.
  return raw.startsWith("/") ? raw : "/";
};

export function resolve() {
  const path = currentPath();
  return routes.get(path) ?? { handler: notFound, auth: false, notFound: true };
}
