/**
 * CPR (RKO) timer module — metronome, breath sounds, cycle logic.
 */
import { $, vibrate } from './dom.js';
import { state } from './state.js';

const CPR_STEPS = [
    { title: '30 Compressions', sub: 'Push hard and fast (100-120 BPM)', time: 18, class: 'pulsing' },
    { title: '2 Rescue Breaths', sub: 'Tilt head back, give 2 breaths', time: 5, class: 'breathing pulsing' },
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
    $('cprInstruction').textContent = step.title;
    $('cprSubInstruction').textContent = step.sub;
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
                $('cprInstruction').textContent = 'Get Ready...';
                $('cprSubInstruction').textContent = nextPhase === 0 ? 'Prepare for Compressions' : 'Prepare for Breaths';
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

    $('btnCprToggle').innerHTML = '<i class="fas fa-play"></i> Start CPR';
    $('btnCprToggle').style.background = 'var(--danger-color)';
    $('cprTimerDisplay').textContent = '00';
    $('cprInstruction').textContent = 'Ready for CPR';
    $('cprSubInstruction').textContent = 'Press start to follow the rhythm.';
    $('cprPulseCircle').className = 'cpr-circle';
}

function startCprCountdown() {
    state.isCprRunning = true;
    let prepTime = 3;
    getAudioCtx();

    $('btnCprToggle').innerHTML = '<i class="fas fa-stop"></i> Stop CPR';
    $('btnCprToggle').style.background = 'var(--text-muted)';
    $('cprInstruction').textContent = 'Get Ready...';
    $('cprSubInstruction').textContent = 'Starting in...';
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

// Expose to global scope
window.toggleCpr = toggleCpr;
window.stopCpr = stopCpr;
