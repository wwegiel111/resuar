/**
 * Diagnosis screen — populate results + manage process lifecycle.
 * Supports expanded wound types and severity levels from the backend.
 */
import { $ } from './dom.js';
import { state } from './state.js';
import { stopVoiceAssistant } from './voice.js';
import { switchScreen } from './navigation.js';

// Severity → CSS class + label mapping
const SEVERITY_CONFIG = {
    mild:     { class: 'severity-badge mild',     icon: 'fa-exclamation-circle',   label: 'MILD' },
    moderate: { class: 'severity-badge moderate', icon: 'fa-exclamation-triangle', label: 'MODERATE' },
    severe:   { class: 'severity-badge severe',   icon: 'fa-skull-crossbones',     label: 'SEVERE' },
};

// Wound type → subtitle descriptions per severity
const WOUND_DESCRIPTIONS = {
    burn:     { mild: 'Superficial burn. Redness without blisters.', moderate: 'Partial-thickness burn. Blistering may be present.', severe: 'Deep burn requiring immediate emergency care.' },
    cut:      { mild: 'Minor cut. Minimal bleeding.', moderate: 'Moderate laceration. Steady bleeding.', severe: 'Deep wound with heavy bleeding. Seek emergency help.' },
    bruise:   { mild: 'Minor bruise. Should heal on its own.', moderate: 'Significant bruising with swelling.', severe: 'Severe bruising — may indicate internal injury.' },
    scrape:   { mild: 'Minor scrape. Surface-level abrasion.', moderate: 'Moderate abrasion with exposed skin layers.', severe: 'Large or deep abrasion (road rash). May need medical care.' },
    puncture: { mild: 'Shallow puncture wound.', moderate: 'Moderate puncture. Infection risk present.', severe: 'Deep puncture wound. Emergency care needed.' },
    sprain:   { mild: 'Mild sprain. Minor stretching of ligament.', moderate: 'Partial ligament tear. Significant swelling.', severe: 'Possible complete ligament tear. Immobilize immediately.' },
    fracture: { mild: 'Suspected hairline fracture. Needs X-ray.', moderate: 'Likely fracture. Do not move the area.', severe: 'Obvious fracture or deformity. Call emergency services.' },
    bite:     { mild: 'Minor bite. Skin barely broken.', moderate: 'Bite wound with broken skin. Infection risk.', severe: 'Severe bite with tissue damage. Emergency care needed.' },
};

// Quick first-aid summary steps shown in the UI card (separate from voice scenario)
const QUICK_STEPS = {
    burn:     ['Cool under running water for 20 minutes.', 'Remove tight clothing near the area.', 'Do not pop blisters or apply ice.'],
    cut:      ['Apply direct pressure to stop bleeding.', 'Clean the wound with running water.', 'Apply a sterile bandage or dressing.'],
    bruise:   ['Apply ice wrapped in cloth for 15-20 min.', 'Elevate the area above heart level.', 'Rest and avoid further impact.'],
    scrape:   ['Rinse under clean running water.', 'Apply antibiotic ointment.', 'Cover with a non-stick bandage.'],
    puncture: ['Let it bleed slightly to flush bacteria.', 'Wash with soap and water.', 'Cover and monitor for infection.'],
    sprain:   ['R.I.C.E.: Rest, Ice, Compression, Elevation.', 'Apply ice for 15-20 minutes.', 'Use compression bandage for support.'],
    fracture: ['Do NOT move the injured area.', 'Immobilize with a splint if possible.', 'Call for medical help immediately.'],
    bite:     ['Wash thoroughly with soap and water.', 'Apply pressure if bleeding.', 'Seek medical attention for infection risk.'],
};

export function populateDiagnosisScreen(diagnosisText, scenarioArr, severity) {
    $('diagImageResult').src = $('imagePreview').src;
    $('diagTitle').textContent = diagnosisText;

    const titleLower = diagnosisText.toLowerCase();
    const sevLower = (severity || 'moderate').toLowerCase();
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
        const sevText = sevLower === 'severe' ? 'serious' : sevLower;
        state.scenarioArray.unshift(
            `I recognized a ${sevText} ${titleLower}. I will guide you through the first aid steps. ` +
            `When you finish a step, say "Next". If you have a question, say "More". ` +
            `To hear the step again, say "Repeat". Let's begin.`
        );
    }

    // Set severity badge
    const sevConfig = SEVERITY_CONFIG[sevLower] || SEVERITY_CONFIG.moderate;
    badge.className = sevConfig.class;
    badge.innerHTML = `<i class="fas ${sevConfig.icon}"></i> ${sevConfig.label}`;

    // Set subtitle
    const descriptions = WOUND_DESCRIPTIONS[titleLower] || {};
    subtitle.textContent = descriptions[sevLower] || `${diagnosisText} detected. Follow the first aid steps below.`;

    // Set quick steps
    const steps = QUICK_STEPS[titleLower] || ['Follow the voice assistant for detailed guidance.'];
    const iconColor = sevLower === 'severe' ? 'var(--danger-color)' : 'var(--success-color)';
    const iconClass = sevLower === 'severe' ? 'fa-exclamation-circle' : 'fa-check-circle';
    stepsList.innerHTML = steps.map(step =>
        `<li><i class="fas ${iconClass}" style="color:${iconColor};"></i> <span>${step}</span></li>`
    ).join('');

    // Show emergency banner for severe cases
    if (sevLower === 'severe') {
        subtitle.innerHTML = `<strong style="color:var(--danger-color);">⚠️ ${subtitle.textContent}</strong>`;
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

    const { resetScanUI } = await import('./scan.js');
    resetScanUI();
    switchScreen('homeScreen', null, 0);
}

// Expose to global scope
window.toggleCollapsedSteps = toggleCollapsedSteps;
window.endProcess = endProcess;
