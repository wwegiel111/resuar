/**
 * Voice Assistant — iOS-friendly continuous listening with VAD (Voice Activity Detection).
 *
 * Why not Web Speech API? It's broken on iOS Safari — works inconsistently and
 * blocks new sessions outside of user gestures. Instead we:
 *   1. Acquire mic permission ONCE on the initial user click ("Start Voice Assistant").
 *   2. Keep the mic stream alive for the entire session.
 *   3. Use AnalyserNode to detect speech (energy above threshold).
 *   4. Record only while the user is speaking; stop after sustained silence.
 *   5. Send the recorded blob to /transcribe (Gemini multimodal STT) and act on it.
 *
 * The user can answer after seconds OR minutes — VAD waits indefinitely.
 */
import { $ } from './dom.js';
import { state } from './state.js';
import { askMore, getAudioUrl, transcribeAudio } from './api.js';
import { switchScreen } from './navigation.js';
import { t, woundName } from './i18n.js';

// --- Single Audio element reused across the session (iOS unlock) ---
let sharedAudio = null;

// --- Persistent mic resources, set up once on first user click ---
let micStream = null;
let audioCtx = null;
let analyser = null;
let dataArray = null;
let mediaRecorder = null;
let recorderMime = '';

// --- VAD state ---
let vadRafId = null;
let isRecording = false;
let speechDetectedAt = 0;
let silenceStartedAt = 0;
let recordingChunks = [];

// VAD tuning constants
const VAD_THRESHOLD = 0.004;     // RMS threshold; very sensitive to catch quiet speech
const SPEECH_MIN_MS = 100;       // start recording almost immediately when speech detected
const SILENCE_END_MS = 1800;     // wait longer before cutting off (user might pause between words)
const MAX_RECORDING_MS = 20000;  // safety cap per utterance
const VAD_INTERVAL_MS = 30;      // check every 30ms for responsiveness

// Voice commands in both languages, matched as whole words on text without
// diacritics ("powtórz" → "powtorz"), so e.g. "stopa" (foot) is not "stop".
const COMMAND_PATTERNS = {
    next: /\b(next|dalej|nastepn\w*|kolejn\w*)\b/,
    repeat: /\b(repeat|powtorz\w*|jeszcze raz)\b/,
    more: /\b(more|question|pytani\w*|wiecej)\b/,
    stop: /\b(stop|zakoncz\w*|koniec)\b/,
};
// In Q&A mode only a short utterance counts as "next" — a question such as
// "co robić dalej po schłodzeniu?" goes to the AI instead.
const MAX_COMMAND_WORDS_IN_QA = 3;

// Current status line, kept as a key so it can be re-rendered on language change
let status = null;
// True while the step text area shows an AI answer instead of the current step
let showingAnswer = false;

function ensureAudioUnlocked() {
    if (sharedAudio) return sharedAudio;
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
    return sharedAudio;
}

function pickRecorderMime() {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',          // iOS Safari
        'audio/mp4;codecs=mp4a.40.2',
        'audio/ogg;codecs=opus',
    ];
    if (typeof MediaRecorder === 'undefined') return '';
    for (const m of candidates) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
            return m;
        }
    }
    return '';
}

async function initMic() {
    if (micStream) return true;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();

        const source = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);
        dataArray = new Float32Array(analyser.fftSize);

        recorderMime = pickRecorderMime();
        return true;
    } catch (err) {
        console.error('[Voice] Mic init failed:', err);
        $('transcriptionText').textContent = t('voice.micDenied');
        return false;
    }
}

function teardownMic() {
    cancelVadLoop();
    stopRecording(true);
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    if (audioCtx) {
        try { audioCtx.close(); } catch (e) { /* ignore */ }
        audioCtx = null;
    }
    analyser = null;
    dataArray = null;
}

function cancelVadLoop() {
    if (vadRafId) {
        clearInterval(vadRafId);
        vadRafId = null;
    }
}

function listeningHint() {
    return t(state.isChatMode ? 'voice.hintQa' : 'voice.hintSteps');
}

// --- VAD loop: continuously analyze mic input, start/stop recording on energy ---
function startVadLoop() {
    cancelVadLoop();
    speechDetectedAt = 0;
    silenceStartedAt = 0;

    // Start recording immediately — we'll discard if no speech detected
    startRecording();

    vadRafId = setInterval(() => {
        if (!state.isVoiceActive || !analyser) {
            cancelVadLoop();
            return;
        }

        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const now = Date.now();

        // Update visual indicator
        const transcriptionEl = $('vgStatusText');
        if (transcriptionEl && state.isVoiceActive) {
            const bars = rms > VAD_THRESHOLD ? '🟢' : '⚪';
            if (!speechDetectedAt && !isRecording) {
                transcriptionEl.textContent = `${bars} ${listeningHint()}`;
            }
        }

        if (rms > VAD_THRESHOLD) {
            // Speech energy detected
            silenceStartedAt = 0;
            if (!speechDetectedAt) speechDetectedAt = now;
        } else {
            // Silence
            if (speechDetectedAt && isRecording) {
                // We had speech and now it's quiet
                if (!silenceStartedAt) silenceStartedAt = now;
                if (now - silenceStartedAt >= SILENCE_END_MS) {
                    // Enough silence after speech — stop and send
                    stopRecording(false);
                    return; // VAD loop will be restarted after processing
                }
            }

            // Safety cap
            if (isRecording && mediaRecorder && mediaRecorder._startedAt) {
                if (now - mediaRecorder._startedAt >= MAX_RECORDING_MS) {
                    if (speechDetectedAt) {
                        stopRecording(false);
                    } else {
                        // No speech detected in max time — discard and restart
                        stopRecording(true);
                        if (state.isVoiceActive) startVadLoop();
                    }
                    return;
                }
            }
        }
    }, VAD_INTERVAL_MS);
}

function startRecording() {
    if (isRecording || !micStream) return;
    try {
        const opts = recorderMime ? { mimeType: recorderMime } : {};
        mediaRecorder = new MediaRecorder(micStream, opts);
        mediaRecorder._startedAt = Date.now();
        recordingChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) recordingChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            isRecording = false;
            cancelVadLoop(); // Stop VAD during processing
            const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || recorderMime || 'audio/mp4' });
            recordingChunks = [];
            const hadSpeech = !!speechDetectedAt;
            speechDetectedAt = 0;
            silenceStartedAt = 0;

            if (!hadSpeech || blob.size < 500) {
                // No speech was detected — restart listening
                if (state.isVoiceActive) beginListening();
                return;
            }

            setVgStatus('voice.processing', {}, '⏳');
            try {
                const transcript = await transcribeAudio(blob);
                console.log('[Voice] Transcribed:', transcript);
                if (!state.isVoiceActive) return;
                if (!transcript) {
                    // Empty transcript — resume listening
                    beginListening();
                    return;
                }
                showHeard(transcript);
                setVgStatus('voice.youSaid', { text: transcript });
                handleVoiceCommand(transcript);
            } catch (err) {
                console.error('[Voice] Transcribe error:', err);
                if (state.isVoiceActive) beginListening();
            }
        };

        // Use timeslice to ensure ondataavailable fires on iOS Safari
        mediaRecorder.start(250);
        isRecording = true;
        setVgStatus('voice.recording', {}, '🔴');
    } catch (err) {
        console.error('[Voice] startRecording error:', err);
        isRecording = false;
    }
}

function stopRecording(silent) {
    if (!isRecording || !mediaRecorder) return;
    try {
        if (silent) {
            // Discard, don't transcribe
            mediaRecorder.onstop = null;
            mediaRecorder.stop();
            recordingChunks = [];
            isRecording = false;
        } else {
            mediaRecorder.stop();
        }
    } catch (e) { /* ignore */ }
}

// --- Public API ---

/** Start/Stop label of the button on the diagnosis screen */
export function renderVoiceButton() {
    const btn = $('btnVoiceAssistant');
    if (!btn) return;
    btn.innerHTML = state.isVoiceActive
        ? `<i class="fas fa-stop-circle"></i> ${t('diag.stopVoice')}`
        : `<i class="fas fa-microphone"></i> ${t('diag.startVoice')}`;
}

export async function toggleVoiceAssistant() {
    if (state.isVoiceActive) {
        if (!confirm(t('voice.confirmStop'))) return;
        stopVoiceAssistant();
        return;
    }

    // User gesture: unlock audio + acquire mic
    ensureAudioUnlocked();
    const ok = await initMic();
    if (!ok) return;

    state.isVoiceActive = true;
    const btnVoice = $('btnVoiceAssistant');
    btnVoice.classList.add('active');
    renderVoiceButton();
    $('transcriptionCard').style.display = 'block';
    $('transcriptionText').textContent = t('voice.starting');

    state.currentScenarioIndex = 0;
    state.isChatMode = false;
    state.messageHistory.length = 0;
    hideHeard();
    updateVoiceControlsUI();

    // Switch to dedicated voice guide screen
    $('voiceGuideTitle').textContent = guideTitle();
    switchScreen('voiceGuideScreen', null, -1);
    updateVoiceGuideUI();

    readScenarioStepByStep();
}

export function stopVoiceAssistant() {
    state.isVoiceActive = false;
    state.isChatMode = false;
    status = null;

    if (sharedAudio) {
        try {
            sharedAudio.pause();
            sharedAudio.removeAttribute('src');
            sharedAudio.load();
        } catch (e) { /* ignore */ }
    }
    state.currentAudio = null;

    teardownMic();

    const btnVoice = $('btnVoiceAssistant');
    if (btnVoice) {
        btnVoice.classList.remove('active');
        renderVoiceButton();
    }
    const tc = $('transcriptionCard');
    if (tc) tc.style.display = 'none';
    hideHeard();
    updateVoiceControlsUI();

    // Return to diagnosis screen
    switchScreen('diagnosisScreen', null, 2);
}

/** Re-render the voice guide in the current language (called on language change) */
export function refreshVoiceGuide() {
    renderVoiceButton();
    if (!state.isVoiceActive) return;
    $('voiceGuideTitle').textContent = guideTitle();
    renderStepInfo(!showingAnswer);
    renderStatus();
}

function guideTitle() {
    const name = state.diagnosis ? woundName(state.diagnosis.type) : t('voice.title');
    return `${name} · ${t('voice.live')}`;
}

function readScenarioStepByStep() {
    if (!state.isVoiceActive) return;

    if (!state.scenarioArray || state.scenarioArray.length === 0) {
        setVgStatus('voice.noSteps');
        return;
    }

    if (state.currentScenarioIndex >= state.scenarioArray.length) {
        setVgStatus('voice.completed', {}, '✅');
        setTimeout(() => stopVoiceAssistant(), 2000);
        return;
    }

    updateVoiceGuideUI();
    const text = state.scenarioArray[state.currentScenarioIndex];
    playStepAudio(text);
}

/** Step label, progress dots and (optionally) the step text */
function renderStepInfo(includeText = true) {
    const total = state.scenarioArray.length;
    const current = state.currentScenarioIndex;

    // Step label (skip welcome message as "step 0")
    const stepLabel = $('vgStepLabel');
    if (stepLabel) stepLabel.textContent = t('voice.stepLabel', { n: current + 1, total });

    // Step text
    const stepText = $('vgStepText');
    if (stepText && includeText) {
        stepText.textContent = state.scenarioArray[current] || '';
        showingAnswer = false;
    }

    // Progress dots
    const progressEl = $('vgProgress');
    if (progressEl) {
        let dots = '';
        for (let i = 0; i < total; i++) {
            if (i < current) dots += '<div class="vg-progress-dot done"></div>';
            else if (i === current) dots += '<div class="vg-progress-dot active"></div>';
            else dots += '<div class="vg-progress-dot"></div>';
        }
        progressEl.innerHTML = dots;
    }
}

/** Update the voice guide screen UI with current step info */
function updateVoiceGuideUI() {
    renderStepInfo();
    setVgStatus('voice.speaking', {}, '🔊');
}

function setVgStatus(key, vars = {}, icon = '') {
    status = { key, vars, icon };
    renderStatus();
}

function renderStatus() {
    if (!status) return;
    const text = (status.icon ? `${status.icon} ` : '') + t(status.key, status.vars);
    const el = $('vgStatusText');
    if (el) el.textContent = text;
    // Also update old transcription card for backward compat
    const tc = $('transcriptionText');
    if (tc) tc.textContent = text;
}

/** Show what the speech recognition actually understood */
function showHeard(text) {
    const box = $('vgHeard');
    const el = $('vgHeardText');
    if (!box || !el) return;
    el.textContent = `"${text}"`;
    box.style.display = 'block';
}

function hideHeard() {
    const box = $('vgHeard');
    if (box) box.style.display = 'none';
}

/** Keep the More button in sync with Q&A (chat) mode */
function updateVoiceControlsUI() {
    const btnMore = $('btnVcMore');
    if (btnMore) btnMore.disabled = state.isChatMode;
}

/**
 * Plays TTS audio. After playback ends, switches to listening mode (VAD).
 * Reuses the single sharedAudio element to bypass iOS autoplay restrictions.
 */
function playStepAudio(promptText) {
    if (!state.isVoiceActive) return;

    // Pause VAD while audio is playing to avoid recording our own TTS
    cancelVadLoop();
    stopRecording(true);

    const audio = ensureAudioUnlocked();
    state.currentAudio = audio;

    audio.onended = null;
    audio.onerror = null;
    audio.oncanplaythrough = null;

    const fallbackTimer = setTimeout(() => {
        console.warn('[Voice] Audio timeout — switching to listening');
        try { audio.pause(); } catch (e) { /* ignore */ }
        if (state.isVoiceActive) beginListening();
    }, 8000);

    audio.oncanplaythrough = () => clearTimeout(fallbackTimer);

    audio.onended = () => {
        clearTimeout(fallbackTimer);
        if (state.isVoiceActive) beginListening();
    };

    audio.onerror = () => {
        clearTimeout(fallbackTimer);
        // Simulate reading time for silent/missing audio, then listen
        const words = promptText.split(/\s+/).length;
        const delay = Math.max(1500, words * 80);
        setTimeout(() => {
            if (state.isVoiceActive) beginListening();
        }, delay);
    };

    audio.src = getAudioUrl(promptText);
    audio.load();
    const p = audio.play();
    if (p && p.catch) {
        p.catch(() => {
            clearTimeout(fallbackTimer);
            const words = promptText.split(/\s+/).length;
            const delay = Math.max(1500, words * 80);
            setTimeout(() => {
                if (state.isVoiceActive) beginListening();
            }, delay);
        });
    }
}

function beginListening() {
    if (!state.isVoiceActive) return;
    setVgStatus(state.isChatMode ? 'voice.hintQa' : 'voice.hintSteps', {}, '🎤');
    startVadLoop();
}

/** Lowercase and strip diacritics so commands match however STT spells them */
function normalizeSpeech(text) {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ł/g, 'l');
}

function handleVoiceCommand(transcript) {
    const text = normalizeSpeech(transcript);

    if (state.isChatMode) {
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        if (wordCount <= MAX_COMMAND_WORDS_IN_QA && COMMAND_PATTERNS.next.test(text)) {
            state.isChatMode = false;
            updateVoiceControlsUI();
            $('transcriptionText').textContent = t('voice.continuing');
            state.currentScenarioIndex++;
            readScenarioStepByStep();
        } else {
            askGeminiQuestion(transcript);
        }
        return;
    }

    if (COMMAND_PATTERNS.next.test(text)) {
        state.currentScenarioIndex++;
        readScenarioStepByStep();
    } else if (COMMAND_PATTERNS.repeat.test(text)) {
        readScenarioStepByStep();
    } else if (COMMAND_PATTERNS.more.test(text)) {
        state.isChatMode = true;
        updateVoiceControlsUI();
        const info = t('voice.helpMode');
        $('transcriptionText').textContent = info;
        playStepAudio(info);
    } else if (COMMAND_PATTERNS.stop.test(text)) {
        $('transcriptionText').textContent = t('voice.stopped');
        stopVoiceAssistant();
    } else {
        // Unrecognized — keep listening without re-prompting (mic is still warm)
        beginListening();
    }
}

async function askGeminiQuestion(userQuestion) {
    if (!state.isVoiceActive) return;
    try {
        setVgStatus('voice.thinking', {}, '🤔');
        let questionForAI = userQuestion;
        if (state.messageHistory.length === 0) {
            const ctx = state.scenarioArray[state.currentScenarioIndex] || t('voice.noContext');
            questionForAI = t('voice.context', { step: ctx, question: userQuestion });
        }
        state.messageHistory.push({ role: 'user', parts: [questionForAI] });
        const answer = await askMore(state.messageHistory);
        state.messageHistory.push({ role: 'model', parts: [answer] });

        // Show answer as the step text temporarily
        const stepText = $('vgStepText');
        if (stepText) {
            stepText.textContent = answer;
            showingAnswer = true;
        }
        setVgStatus('voice.speaking', {}, '🔊');
        playStepAudio(answer);
    } catch (error) {
        console.error('[Voice] Q&A error:', error);
        setVgStatus('voice.error');
        if (state.isVoiceActive) playStepAudio(t('voice.error'));
    }
}

// Expose to global scope
window.toggleVoiceAssistant = toggleVoiceAssistant;
window.exitVoiceGuide = function() {
    stopVoiceAssistant();
};
window.voiceCommand = function(cmd) {
    if (!state.isVoiceActive) return;
    cancelVadLoop();
    stopRecording(true);

    if (state.isChatMode) {
        if (cmd === 'more') {
            // Already in help mode — just keep listening
            beginListening();
            return;
        }
        if (cmd === 'repeat') {
            // Leave Q&A mode and re-read the current step
            state.isChatMode = false;
            updateVoiceControlsUI();
            readScenarioStepByStep();
            return;
        }
    }
    handleVoiceCommand(cmd);
};
