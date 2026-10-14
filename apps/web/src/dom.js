// Tiny DOM helper. Text is always inserted as text nodes (never HTML), so user-controlled values
// such as usernames cannot inject markup.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "disabled" || key === "checked" || key === "hidden" || key === "required") el[key] = Boolean(value);
    else if (key === "value") el.value = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Inserts a trusted, build-time SVG string (lucide icons imported with ?raw). Never pass user data here. */
export function svg(markup, className = "") {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  const el = tpl.content.firstElementChild;
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  el.removeAttribute("width");
  el.removeAttribute("height");
  el.setAttribute("class", `icon ${className}`.trim());
  return el;
}
