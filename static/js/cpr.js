/**
 * CPR (RKO) timer module — metronome, breath sounds, cycle logic.
 */
import { $, vibrate } from './dom.js';
import { state } from './state.js';
import { t } from './i18n.js';

const CPR_STEPS = [
    { title: 'cpr.compressions', sub: 'cpr.compressionsSub', time: 18, class: 'pulsing' },
    { title: 'cpr.breaths', sub: 'cpr.breathsSub', time: 5, class: 'breathing pulsing' },
];

function getAudioCtx() {
    if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    return state.audioCtx;
}

function playBeep() {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
}

function playBreath() {
    const ctx = getAudioCtx();
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.6);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 1.6);
}

function manageMetronome(forceStop = false) {
    if (forceStop || state.cprPhase !== 0 || state.isTransitioning || !state.isCprRunning) {
        clearInterval(state.beepInterval);
        state.beepInterval = null;
    } else if (!state.beepInterval && state.cprPhase === 0 && !state.isTransitioning && state.isCprRunning) {
        playBeep();
        state.beepInterval = setInterval(playBeep, 600);
    }
}

function updateCprUI() {
    const step = CPR_STEPS[state.cprPhase];
    $('cprTimerDisplay').textContent = state.cprTime.toString().padStart(2, '0');
    $('cprInstruction').textContent = t(step.title);
    $('cprSubInstruction').textContent = t(step.sub);
    $('cprPulseCircle').className = 'cpr-circle ' + step.class;
}

function beginCprCycle() {
    state.cprPhase = 0;
    state.cprTime = CPR_STEPS[0].time;
    state.isTransitioning = false;
    updateCprUI();
    manageMetronome();

    state.cprInterval = setInterval(() => {
        if (state.isTransitioning) {
            state.transitionTime--;
            if (state.transitionTime < 0) {
                state.isTransitioning = false;
                state.cprPhase = (state.cprPhase + 1) % 2;
                state.cprTime = CPR_STEPS[state.cprPhase].time;
                updateCprUI();
                manageMetronome();
            } else {
                $('cprTimerDisplay').textContent = state.transitionTime.toString().padStart(2, '0');
            }
        } else {
            state.cprTime--;
            if (state.cprTime < 0) {
                state.isTransitioning = true;
                state.transitionTime = 3;
                vibrate([200, 100, 200]);
                manageMetronome(true);

                const nextPhase = (state.cprPhase + 1) % 2;
                $('cprInstruction').textContent = t('cpr.getReady');
                $('cprSubInstruction').textContent = t(nextPhase === 0 ? 'cpr.prepCompressions' : 'cpr.prepBreaths');
                $('cprPulseCircle').className = 'cpr-circle transition-mode';
                $('cprTimerDisplay').textContent = state.transitionTime.toString().padStart(2, '0');
            } else {
                updateCprUI();
                if (state.cprPhase === 1 && (state.cprTime === 4 || state.cprTime === 2)) {
                    playBreath();
                }
            }
        }
    }, 1000);
}

export function stopCpr() {
    state.isCprRunning = false;
    clearInterval(state.cprInterval);
    manageMetronome(true);

    $('btnCprToggle').style.background = 'var(--danger-color)';
    $('cprTimerDisplay').textContent = '00';
    $('cprPulseCircle').className = 'cpr-circle';
    renderIdleText();
}

function renderIdleText() {
    $('btnCprToggle').innerHTML = `<i class="fas fa-play"></i> ${t('cpr.start')}`;
    $('cprInstruction').textContent = t('cpr.ready');
    $('cprSubInstruction').textContent = t('cpr.readySub');
}

function startCprCountdown() {
    state.isCprRunning = true;
    let prepTime = 3;
    getAudioCtx();

    $('btnCprToggle').innerHTML = `<i class="fas fa-stop"></i> ${t('cpr.stop')}`;
    $('btnCprToggle').style.background = 'var(--text-muted)';
    $('cprInstruction').textContent = t('cpr.getReady');
    $('cprSubInstruction').textContent = t('cpr.startingIn');
    $('cprPulseCircle').className = 'cpr-circle transition-mode';
    $('cprTimerDisplay').textContent = '0' + prepTime;
    vibrate(100);

    state.cprInterval = setInterval(() => {
        if (prepTime > 1) {
            prepTime--;
            $('cprTimerDisplay').textContent = '0' + prepTime;
            vibrate(100);
        } else {
            clearInterval(state.cprInterval);
            vibrate([200, 100, 200]);
            beginCprCycle();
        }
    }, 1000);
}

export function toggleCpr() {
    if (state.isCprRunning) stopCpr();
    else startCprCountdown();
}

// While CPR runs the instruction refreshes on the next tick; only the button needs it now
window.addEventListener('langchange', () => {
    if (state.isCprRunning) {
        $('btnCprToggle').innerHTML = `<i class="fas fa-stop"></i> ${t('cpr.stop')}`;
    } else {
        renderIdleText();
    }
});

// Expose to global scope
window.toggleCpr = toggleCpr;
window.stopCpr = stopCpr;
