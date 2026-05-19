/**
 * Application entry point — imports all modules and initializes the app.
 */
import { initScan } from './scan.js';
import { updateProfile } from './profile.js';

// Side-effect imports: these modules register global handlers on import
import './navigation.js';
import './cpr.js';
import './voice.js';
import './chat.js';
import './diagnosis.js';

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initScan();
    updateProfile();
});
