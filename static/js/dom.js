/**
 * DOM utility helpers.
 */

/** Shorthand for getElementById */
export function $(id) {
    return document.getElementById(id);
}

/** Shorthand for querySelectorAll */
export function $$(selector) {
    return document.querySelectorAll(selector);
}

/** Haptic feedback if available */
export function vibrate(pattern = 50) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}
