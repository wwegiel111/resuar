/**
 * Voice Assistant module — TTS playback + Web Speech API recognition.
 * 
 * Key design: audio.play() is called WITHOUT await to preserve the user-activation
 * context from SpeechRecognition's onresult callback. Using await would cause the
 * browser to lose the "user gesture" context, blocking subsequent audio playback
 * and speech recognition on mobile browsers.
 */
import { $ } from './dom.js';
import { state } from './state.js';
import { askMore, getAudioUrl } from './api.js';

export function toggleVoiceAssistant() {
    if (state.isVoiceActive) {
        if (!confirm('Are you sure you want to stop the Voice Assistant?')) return;
        stopVoiceAssistant();
        return;
    }

    state.isVoiceActive = true;
    const btnVoice = $('btnVoiceAssistant');
    btnVoice.classList.add('active');
    btnVoice.innerHTML = '<i class="fas fa-stop-circle"></i> Stop Voice Assistant';
    $('transcriptionCard').style.display = 'block';
    $('transcriptionText').textContent = 'Starting voice assistant...';

    state.currentScenarioIndex = 0;
    state.isChatMode = false;
    state.messageHistory.length = 0;
    readScenarioStepByStep();
}

export function stopVoiceAssistant() {
    state.isVoiceActive = false;
    state.isChatMode = false;

    if (state.currentAudio) {
        state.currentAudio.pause();
        state.currentAudio = null;
    }
    if (state.currentRecognition) {
        try { state.currentRecognition.abort(); } catch (e) { /* ignore */ }
        state.currentRecognition = null;
    }

    const btnVoice = $('btnVoiceAssistant');
    btnVoice.classList.remove('active');
    btnVoice.innerHTML = '<i class="fas fa-microphone"></i> Start Voice Assistant';
    $('transcriptionCard').style.display = 'none';
}

function readScenarioStepByStep() {
    if (!state.isVoiceActive) return;

    if (!state.scenarioArray || state.scenarioArray.length === 0) {
        $('transcriptionText').textContent = 'No scenario steps available.';
        return;
    }

    if (state.currentScenarioIndex >= state.scenarioArray.length) {
        $('transcriptionText').textContent = 'First aid procedure completed.';
        stopVoiceAssistant();
        return;
    }

    const text = state.scenarioArray[state.currentScenarioIndex];
    $('transcriptionText').textContent = text;
    playStepAudio(text);
}

/**
 * Plays TTS audio for a given text. After playback ends, starts voice recognition.
 * Uses fire-and-forget pattern (no await) to preserve user-activation context.
 */
function playStepAudio(promptText) {
    if (!state.isVoiceActive) return;

    const audio = new Audio(getAudioUrl(promptText));
    state.currentAudio = audio;

    // Fallback timer — if audio doesn't start within 8s, skip to recognition
    // This handles cases where the server is slow or audio fails silently
    const fallbackTimer = setTimeout(() => {
        console.warn('[Voice] Audio timeout — skipping to recognition');
        if (state.currentAudio === audio) {
            audio.pause();
            state.currentAudio = null;
            if (state.isVoiceActive) startLocalVoiceCommand();
        }
    }, 8000);

    audio.oncanplaythrough = () => {
        // Audio is ready — clear the fallback timer, let it play naturally
        clearTimeout(fallbackTimer);
    };

    audio.onended = () => {
        clearTimeout(fallbackTimer);
        state.currentAudio = null;
        if (state.isVoiceActive) startLocalVoiceCommand();
    };

    audio.onerror = (e) => {
        clearTimeout(fallbackTimer);
        console.warn('[Voice] Audio error:', e);
        state.currentAudio = null;
        // Simulate reading time before listening (for mock/silent audio)
        const words = promptText.split(/\s+/).length;
        const delay = Math.max(1500, words * 80);
        setTimeout(() => {
            if (state.isVoiceActive) startLocalVoiceCommand();
        }, delay);
    };

    audio.play().catch((err) => {
        clearTimeout(fallbackTimer);
        console.warn('[Voice] audio.play() rejected:', err.message);
        state.currentAudio = null;
        const words = promptText.split(/\s+/).length;
        const delay = Math.max(1500, words * 80);
        setTimeout(() => {
            if (state.isVoiceActive) startLocalVoiceCommand();
        }, delay);
    });
}

function startLocalVoiceCommand() {
    if (!state.isVoiceActive) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        $('transcriptionText').textContent = 'Speech recognition not supported in this browser.';
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    state.currentRecognition = recognition;

    let processed = false;

    recognition.onstart = () => {
        if (!state.isVoiceActive) { recognition.abort(); return; }
        $('transcriptionText').textContent = state.isChatMode
            ? '🎤 Q&A mode — Ask a question or say "next"...'
            : '🎤 Listening... (say: "next", "repeat", "more" or "stop")';
    };

    recognition.onresult = (event) => {
        if (processed || !state.isVoiceActive) return;
        processed = true;
        recognition.stop();
        state.currentRecognition = null;

        let transcript = event.results[0][0].transcript.toLowerCase().replace(/[.,!?]/g, '').trim();
        console.log('[Voice] Heard:', transcript);
        $('transcriptionText').textContent = `You said: "${transcript}"`;

        // Handle command — all in synchronous context to preserve user activation
        handleVoiceCommand(transcript);
    };

    recognition.onerror = (event) => {
        state.currentRecognition = null;
        if (event.error === 'aborted' || !state.isVoiceActive) return;

        console.warn('[Voice] Recognition error:', event.error);
        if (event.error === 'no-speech') {
            // Re-prompt: play audio then listen again
            const prompt = state.isChatMode
                ? 'Waiting for your question, or say next.'
                : 'Please say next, repeat, or more.';
            $('transcriptionText').textContent = prompt;
            if (state.isVoiceActive) playStepAudio(prompt);
        } else {
            $('transcriptionText').textContent = `Microphone error: ${event.error}`;
        }
    };

    recognition.onend = () => {
        state.currentRecognition = null;
    };

    try {
        recognition.start();
        console.log('[Voice] Recognition started');
    } catch (e) {
        console.error('[Voice] Failed to start recognition:', e);
        // Retry after a short delay
        setTimeout(() => {
            if (state.isVoiceActive) startLocalVoiceCommand();
        }, 500);
    }
}

/**
 * Process voice command. Kept synchronous to maintain user-activation context
 * for subsequent audio.play() calls.
 */
function handleVoiceCommand(transcript) {
    if (state.isChatMode) {
        if (transcript.includes('next')) {
            state.isChatMode = false;
            $('transcriptionText').textContent = 'Continuing to next step...';
            state.currentScenarioIndex++;
            readScenarioStepByStep();
        } else {
            // Q&A question — this is async but we fire-and-forget
            askGeminiQuestion(transcript);
        }
        return;
    }

    if (transcript.includes('next')) {
        state.currentScenarioIndex++;
        readScenarioStepByStep();
    } else if (transcript.includes('repeat')) {
        readScenarioStepByStep();
    } else if (transcript.includes('more')) {
        state.isChatMode = true;
        const info = 'Help mode activated. Ask your question, or say next to continue.';
        $('transcriptionText').textContent = info;
        playStepAudio(info);
    } else if (transcript.includes('stop')) {
        $('transcriptionText').textContent = 'Procedure stopped.';
        stopVoiceAssistant();
    } else {
        const fallback = "I didn't understand. Please say next, repeat, or more.";
        $('transcriptionText').textContent = fallback;
        playStepAudio(fallback);
    }
}

/**
 * Ask Gemini a question via /more endpoint.
 * Fire-and-forget async — doesn't block the voice command handler.
 */
async function askGeminiQuestion(userQuestion) {
    if (!state.isVoiceActive) return;

    try {
        $('transcriptionText').textContent = 'Thinking...';

        let questionForAI = userQuestion;
        if (state.messageHistory.length === 0) {
            const ctx = state.scenarioArray[state.currentScenarioIndex] || 'No context';
            questionForAI = `Context of current step: ${ctx}. My question is: ${userQuestion}`;
        }

        state.messageHistory.push({ role: 'user', parts: [questionForAI] });

        const answer = await askMore(state.messageHistory);
        state.messageHistory.push({ role: 'model', parts: [answer] });

        $('transcriptionText').textContent = answer;
        playStepAudio(answer);
    } catch (error) {
        console.error('[Voice] Q&A error:', error);
        const errText = 'Communication error. Try asking again or say next.';
        $('transcriptionText').textContent = errText;
        if (state.isVoiceActive) playStepAudio(errText);
    }
}

// Expose to global scope
window.toggleVoiceAssistant = toggleVoiceAssistant;
