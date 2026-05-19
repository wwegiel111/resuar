/**
 * Diagnosis screen — populate results + manage process lifecycle.
 */
import { $ } from './dom.js';
import { state } from './state.js';
import { stopVoiceAssistant } from './voice.js';
import { switchScreen } from './navigation.js';

export function populateDiagnosisScreen(diagnosisText, scenarioArr) {
    $('diagImageResult').src = $('imagePreview').src;
    $('diagTitle').textContent = diagnosisText;

    const titleLower = diagnosisText.toLowerCase();
    const stepsList = $('stepsList');
    const badge = $('diagSeverityBadge');
    const subtitle = $('diagSubtitle');

    // Store scenario for voice assistant
    state.scenarioArray = scenarioArr || [];
    state.currentScenarioIndex = 0;
    state.isChatMode = false;
    state.messageHistory.length = 0;

    // Prepend welcome message
    if (state.scenarioArray.length > 0) {
        const woundType = (titleLower.includes('poparzenie') || titleLower.includes('burn')) ? 'burn' : 'cut';
        state.scenarioArray.unshift(
            `I recognized a ${woundType}. I will guide you through the first aid steps. ` +
            `When you finish a step, say "Next". If you have a question, say "More". ` +
            `To hear the step again, say "Repeat". Let's begin.`
        );
    }

    if (titleLower.includes('poparzenie') || titleLower.includes('burn')) {
        badge.className = 'severity-badge moderate';
        badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> MODERATE';
        subtitle.textContent = 'Not life-threatening. Blistering might be present.';
        stepsList.innerHTML = `
            <li><i class="fas fa-check-circle" style="color:var(--success-color);"></i> <span>Cool under running water for 20 minutes.</span></li>
            <li><i class="fas fa-check-circle" style="color:var(--success-color);"></i> <span>Remove tight clothing near the burnt area.</span></li>
            <li><i class="fas fa-times-circle" style="color:var(--danger-color);"></i> <span>Do not pop blisters or apply ice.</span></li>`;
    } else {
        badge.className = 'severity-badge mild';
        badge.innerHTML = '<i class="fas fa-exclamation-circle"></i> MILD TO MODERATE';
        subtitle.textContent = 'Clean the area carefully to prevent infection.';
        stepsList.innerHTML = `
            <li><i class="fas fa-check-circle" style="color:var(--success-color);"></i> <span>Stop bleeding by applying direct pressure.</span></li>
            <li><i class="fas fa-check-circle" style="color:var(--success-color);"></i> <span>Clean the wound with running water.</span></li>
            <li><i class="fas fa-check-circle" style="color:var(--success-color);"></i> <span>Apply a sterile bandage or dressing.</span></li>`;
    }

    state.isVoiceActive = false;
    $('btnVoiceAssistant').classList.remove('active');
    $('btnVoiceAssistant').innerHTML = '<i class="fas fa-microphone"></i> Start Voice Assistant';
    $('stepsCard').style.display = 'block';
    $('btnCollapsedSteps').style.display = 'none';
    $('transcriptionCard').style.display = 'none';
}

export function toggleCollapsedSteps() {
    const stepsCard = $('stepsCard');
    const btn = $('btnCollapsedSteps');
    if (stepsCard.style.display === 'none') {
        stepsCard.style.display = 'block';
        btn.style.display = 'none';
    } else {
        stepsCard.style.display = 'none';
        btn.style.display = 'flex';
    }
}

export async function endProcess() {
    if (!confirm('Are you sure you want to close this case and end the process?')) return;

    state.isProcessActive = false;
    stopVoiceAssistant();
    state.scenarioArray = [];
    state.currentScenarioIndex = 0;
    state.messageHistory.length = 0;

    // Lazy import to avoid circular dependency
    const { resetScanUI } = await import('./scan.js');
    resetScanUI();
    switchScreen('homeScreen', null, 0);
}

// Expose to global scope
window.toggleCollapsedSteps = toggleCollapsedSteps;
window.endProcess = endProcess;
