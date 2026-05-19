/**
 * Voice Assistant module — TTS playback + Web Speech API recognition.
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

async function readScenarioStepByStep() {
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
    await playStepAudio(text);
}

async function playStepAudio(promptText) {
    if (!state.isVoiceActive) return;

    try {
        const audio = new Audio(getAudioUrl(promptText));
        state.currentAudio = audio;

        audio.onended = () => {
            state.currentAudio = null;
            if (state.isVoiceActive) startLocalVoiceCommand();
        };

        audio.onerror = () => {
            state.currentAudio = null;
            if (state.isVoiceActive) startLocalVoiceCommand();
        };

        await audio.play();
    } catch (error) {
        console.error('Audio playback error:', error);
        if (state.isVoiceActive) startLocalVoiceCommand();
    }
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

    recognition.onresult = async (event) => {
        if (processed || !state.isVoiceActive) return;
        processed = true;
        recognition.stop();
        state.currentRecognition = null;

        let transcript = event.results[0][0].transcript.toLowerCase().replace(/[.,!?]/g, '').trim();
        $('transcriptionText').textContent = `You said: "${transcript}"`;

        if (state.isChatMode) {
            if (transcript.includes('next')) {
                state.isChatMode = false;
                $('transcriptionText').textContent = 'Continuing to next step...';
                state.currentScenarioIndex++;
                readScenarioStepByStep();
            } else {
                await askGeminiQuestion(transcript);
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
            await playStepAudio(info);
        } else if (transcript.includes('stop')) {
            $('transcriptionText').textContent = 'Procedure stopped.';
            stopVoiceAssistant();
        } else {
            const fallback = "I didn't understand. Please say next, repeat, or more.";
            $('transcriptionText').textContent = fallback;
            await playStepAudio(fallback);
        }
    };

    recognition.onerror = async (event) => {
        state.currentRecognition = null;
        if (event.error === 'aborted' || !state.isVoiceActive) return;

        if (event.error === 'no-speech') {
            const prompt = state.isChatMode
                ? 'Waiting for your question, or say next.'
                : 'Please say next, repeat, or more.';
            $('transcriptionText').textContent = prompt;
            if (state.isVoiceActive) await playStepAudio(prompt);
        } else {
            $('transcriptionText').textContent = `Microphone error: ${event.error}`;
        }
    };

    recognition.onend = () => { state.currentRecognition = null; };
    recognition.start();
}

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
        await playStepAudio(answer);
    } catch (error) {
        console.error('Q&A error:', error);
        const errText = 'Communication error. Try asking again or say next.';
        $('transcriptionText').textContent = errText;
        if (state.isVoiceActive) await playStepAudio(errText);
    }
}

// Expose to global scope
window.toggleVoiceAssistant = toggleVoiceAssistant;
