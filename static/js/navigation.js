/**
 * Screen navigation logic.
 */
import { $, $$, vibrate } from './dom.js';
import { state } from './state.js';
import { stopCpr } from './cpr.js';

export function switchScreen(screenId, navElement = null, navIndex = 0) {
    vibrate(20);

    if (screenId !== 'cprScreen' && state.isCprRunning) {
        stopCpr();
    }

    $$('.screen').forEach(el => el.classList.remove('active'));
    $(screenId).classList.add('active');
    $$('.nav-item').forEach(el => el.classList.remove('active'));

    if (navElement) {
        navElement.classList.add('active');
    } else if (navIndex >= 0) {
        const navItems = $$('.nav-item');
        if (navItems[navIndex]) navItems[navIndex].classList.add('active');
    }
}

export function goToScan(navElement = null, navIndex = 2) {
    if (state.isProcessActive) {
        switchScreen('diagnosisScreen', navElement, navIndex);
    } else {
        switchScreen('scanScreen', navElement, navIndex);
    }
}

// Expose to global scope for inline onclick handlers
window.switchScreen = switchScreen;
window.goToScan = goToScan;
