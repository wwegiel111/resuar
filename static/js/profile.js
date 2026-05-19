/**
 * Profile & theme management.
 */
import { $, $$ } from './dom.js';

export function updateProfile() {
    const firstName = $('profileFirstName').value.trim();
    const lastName = $('profileLastName').value.trim();

    $('greetingText').textContent = firstName ? `Hello, ${firstName}` : 'Hello';
    $('profileFullName').textContent = (firstName || lastName)
        ? `${firstName} ${lastName}`.trim()
        : 'User';

    const initials =
        (firstName ? firstName.charAt(0).toUpperCase() : '') +
        (lastName ? lastName.charAt(0).toUpperCase() : '');

    $$('.user-avatar').forEach(avatar => (avatar.textContent = initials || '?'));
}

export function toggleTheme() {
    document.body.classList.toggle('dark-mode', $('themeToggle').checked);
}

// Expose to global scope for inline handlers
window.updateProfile = updateProfile;
window.toggleTheme = toggleTheme;
