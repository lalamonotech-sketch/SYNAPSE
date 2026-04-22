/**
 * Tiny DOM helpers — keep it small and unopinionated.
 * Centralises the `el(id)` shortcut that was duplicated across
 * meta/screens.js, meta/flow.js, ui/actionFlow.js.
 */

/** document.getElementById shortcut. */
export const el = (id) => document.getElementById(id);

/** querySelector shortcut. */
export const qs = (sel, root = document) => root.querySelector(sel);

/** querySelectorAll shortcut returning an Array. */
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
