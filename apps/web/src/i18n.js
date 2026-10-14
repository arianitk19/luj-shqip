import sq from "./locales/sq.js";

const locales = { sq };
let current = "sq";

export function setLocale(code) {
  if (locales[code]) {
    current = code;
    document.documentElement.lang = code;
  }
}

/** t("game.stock", { n: 3 }) — dotted keys, {placeholder} interpolation. Missing keys return the key (visible in QA). */
export function t(key, params) {
  let node = locales[current];
  for (const part of key.split(".")) node = node?.[part];
  if (typeof node !== "string") return typeof node === "undefined" ? key : node;
  return params ? node.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`)) : node;
}

export const tList = (key) => {
  let node = locales[current];
  for (const part of key.split(".")) node = node?.[part];
  return Array.isArray(node) ? node : [];
};
