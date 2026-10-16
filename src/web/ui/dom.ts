import { AppError } from "../core/errors";

export const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new AppError("INTERNAL", `Element not found: ${selector}`);
  return element;
};

// Builds an element; text is always set with textContent, never as HTML.
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== "") element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = node("button", text, className);
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}

export function selectOf(options: Array<{ value: string; label: string }>, value: string): HTMLSelectElement {
  const element = node("select");
  for (const option of options) {
    const item = node("option", option.label);
    item.value = option.value;
    item.selected = option.value === value;
    element.append(item);
  }
  return element;
}
