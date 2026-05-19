/**
 * Theme management — dark mode toggle.
 */
import { $ } from './dom.js';

let isDarkMode = false;

export function toggleTheme() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode', isDarkMode);

    const icon = $('themeIcon');
    if (icon) {
        icon.className = isDarkMode ? 'fas fa-sun' : 'fas fa-moon';
    }
}

// No longer needed but kept as no-op for safety
export function updateProfile() {}

// Expose to global scope
window.toggleTheme = toggleTheme;
window.updateProfile = updateProfile;
