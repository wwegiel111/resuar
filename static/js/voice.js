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
        $('transcriptionText').textContent = 'Microphone access denied. Voice control unavailable.';
        return false;
    }
}

function teardownMic() {
    cancelVadLoop();
    stopRecording(true);
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
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
                const baseText = state.isChatMode
                    ? 'Q&A mode — Ask a question or say "next"'
                    : 'Listening... (say: "next", "repeat", "more" or "stop")';
                transcriptionEl.textContent = `${bars} ${baseText}`;
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

            $('vgStatusText').textContent = '⏳ Processing...';
            try {
                const transcript = await transcribeAudio(blob);
                console.log('[Voice] Transcribed:', transcript);
                if (!state.isVoiceActive) return;
                if (!transcript) {
                    // Empty transcript — resume listening
                    beginListening();
                    return;
                }
                setVgStatus(`You said: "${transcript}"`);
                handleVoiceCommand(transcript);
            } catch (err) {
                console.error('[Voice] Transcribe error:', err);
                if (state.isVoiceActive) beginListening();
            }
        };

        // Use timeslice to ensure ondataavailable fires on iOS Safari
        mediaRecorder.start(250);
        isRecording = true;
        setVgStatus('🔴 Recording...');
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
export async function toggleVoiceAssistant() {
    if (state.isVoiceActive) {
        if (!confirm('Are you sure you want to stop the Voice Assistant?')) return;
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
    btnVoice.innerHTML = '<i class="fas fa-stop-circle"></i> Stop Voice Assistant';
    $('transcriptionCard').style.display = 'block';
    $('transcriptionText').textContent = 'Starting voice assistant...';

    state.currentScenarioIndex = 0;
    state.isChatMode = false;
    state.messageHistory.length = 0;

    // Switch to dedicated voice guide screen
    const diagTitle = $('diagTitle');
    const title = diagTitle ? diagTitle.textContent : 'Voice Guidance';
    $('voiceGuideTitle').textContent = `${title} · Live`;
    switchScreen('voiceGuideScreen', null, -1);
    updateVoiceGuideUI();

    readScenarioStepByStep();
}

export function stopVoiceAssistant() {
    state.isVoiceActive = false;
    state.isChatMode = false;

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
        btnVoice.innerHTML = '<i class="fas fa-microphone"></i> Start Voice Assistant';
    }
    const tc = $('transcriptionCard');
    if (tc) tc.style.display = 'none';

    // Return to diagnosis screen
    switchScreen('diagnosisScreen', null, 2);
}

function readScenarioStepByStep() {
    if (!state.isVoiceActive) return;

    if (!state.scenarioArray || state.scenarioArray.length === 0) {
        setVgStatus('No scenario steps available.');
        return;
    }

    if (state.currentScenarioIndex >= state.scenarioArray.length) {
        setVgStatus('✅ First aid procedure completed.');
        setTimeout(() => stopVoiceAssistant(), 2000);
        return;
    }

    updateVoiceGuideUI();
    const text = state.scenarioArray[state.currentScenarioIndex];
    playStepAudio(text);
}

/** Update the voice guide screen UI with current step info */
function updateVoiceGuideUI() {
    const total = state.scenarioArray.length;
    const current = state.currentScenarioIndex;
    const text = state.scenarioArray[current] || '';

    // Step label (skip welcome message as "step 0")
    const stepNum = current + 1;
    const stepLabel = $('vgStepLabel');
    if (stepLabel) stepLabel.textContent = `STEP ${stepNum} OF ${total}`;

    // Step text
    const stepText = $('vgStepText');
    if (stepText) stepText.textContent = text;

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

    setVgStatus('🔊 Speaking...');
}

function setVgStatus(text) {
    const el = $('vgStatusText');
    if (el) el.textContent = text;
    // Also update old transcription card for backward compat
    const tc = $('transcriptionText');
    if (tc) tc.textContent = text;
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
    const statusText = state.isChatMode
        ? '🎤 Q&A mode — Ask a question or say "next"...'
        : '🎤 Listening... (say: "next", "repeat", "more" or "stop")';
    setVgStatus(statusText);
    startVadLoop();
}

function handleVoiceCommand(transcript) {
    const t = (transcript || '').toLowerCase();

    if (state.isChatMode) {
        if (t.includes('next')) {
            state.isChatMode = false;
            $('transcriptionText').textContent = 'Continuing to next step...';
            state.currentScenarioIndex++;
            readScenarioStepByStep();
        } else {
            askGeminiQuestion(t);
        }
        return;
    }

    if (t.includes('next')) {
        state.currentScenarioIndex++;
        readScenarioStepByStep();
    } else if (t.includes('repeat')) {
        readScenarioStepByStep();
    } else if (t.includes('more')) {
        state.isChatMode = true;
        const info = 'Help mode activated. Ask your question, or say next to continue.';
        $('transcriptionText').textContent = info;
        playStepAudio(info);
    } else if (t.includes('stop')) {
        $('transcriptionText').textContent = 'Procedure stopped.';
        stopVoiceAssistant();
    } else {
        // Unrecognized — keep listening without re-prompting (mic is still warm)
        beginListening();
    }
}

async function askGeminiQuestion(userQuestion) {
    if (!state.isVoiceActive) return;
    try {
        setVgStatus('🤔 Thinking...');
        let questionForAI = userQuestion;
        if (state.messageHistory.length === 0) {
            const ctx = state.scenarioArray[state.currentScenarioIndex] || 'No context';
            questionForAI = `Context of current step: ${ctx}. My question is: ${userQuestion}`;
        }
        state.messageHistory.push({ role: 'user', parts: [questionForAI] });
        const answer = await askMore(state.messageHistory);
        state.messageHistory.push({ role: 'model', parts: [answer] });

        // Show answer as the step text temporarily
        const stepText = $('vgStepText');
        if (stepText) stepText.textContent = answer;
        setVgStatus('🔊 Speaking...');
        playStepAudio(answer);
    } catch (error) {
        console.error('[Voice] Q&A error:', error);
        const errText = 'Communication error. Try asking again or say next.';
        setVgStatus(errText);
        if (state.isVoiceActive) playStepAudio(errText);
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
    handleVoiceCommand(cmd);
};
