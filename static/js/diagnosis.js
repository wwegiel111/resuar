/**
 * Diagnosis screen — populate results + manage process lifecycle.
 * Supports expanded wound types and severity levels from the backend.
 */
import { $ } from './dom.js';
import { state } from './state.js';
import { stopVoiceAssistant, refreshVoiceGuide, renderVoiceButton } from './voice.js';
import { switchScreen } from './navigation.js';
import { getLang, t, woundName, injuryPhrase } from './i18n.js';

// Severity → CSS class + icon mapping (label comes from i18n)
const SEVERITY_CONFIG = {
    mild:     { class: 'severity-badge mild',     icon: 'fa-exclamation-circle' },
    moderate: { class: 'severity-badge moderate', icon: 'fa-exclamation-triangle' },
    severe:   { class: 'severity-badge severe',   icon: 'fa-skull-crossbones' },
};

// Wound type → subtitle descriptions per severity
const WOUND_DESCRIPTIONS = {
    en: {
        burn:     { mild: 'Superficial burn. Redness without blisters.', moderate: 'Partial-thickness burn. Blistering may be present.', severe: 'Deep burn requiring immediate emergency care.' },
        cut:      { mild: 'Minor cut. Minimal bleeding.', moderate: 'Moderate laceration. Steady bleeding.', severe: 'Deep wound with heavy bleeding. Seek emergency help.' },
        bruise:   { mild: 'Minor bruise. Should heal on its own.', moderate: 'Significant bruising with swelling.', severe: 'Severe bruising — may indicate internal injury.' },
        scrape:   { mild: 'Minor scrape. Surface-level abrasion.', moderate: 'Moderate abrasion with exposed skin layers.', severe: 'Large or deep abrasion (road rash). May need medical care.' },
        puncture: { mild: 'Shallow puncture wound.', moderate: 'Moderate puncture. Infection risk present.', severe: 'Deep puncture wound. Emergency care needed.' },
        sprain:   { mild: 'Mild sprain. Minor stretching of ligament.', moderate: 'Partial ligament tear. Significant swelling.', severe: 'Possible complete ligament tear. Immobilize immediately.' },
        fracture: { mild: 'Suspected hairline fracture. Needs X-ray.', moderate: 'Likely fracture. Do not move the area.', severe: 'Obvious fracture or deformity. Call emergency services.' },
        bite:     { mild: 'Minor bite. Skin barely broken.', moderate: 'Bite wound with broken skin. Infection risk.', severe: 'Severe bite with tissue damage. Emergency care needed.' },
    },
    pl: {
        burn:     { mild: 'Oparzenie powierzchowne. Zaczerwienienie bez pęcherzy.', moderate: 'Oparzenie drugiego stopnia. Mogą pojawić się pęcherze.', severe: 'Głębokie oparzenie wymagające natychmiastowej pomocy medycznej.' },
        cut:      { mild: 'Drobne skaleczenie. Niewielkie krwawienie.', moderate: 'Rana cięta. Utrzymujące się krwawienie.', severe: 'Głęboka rana z obfitym krwawieniem. Wezwij pomoc.' },
        bruise:   { mild: 'Niewielkie stłuczenie. Powinno zagoić się samo.', moderate: 'Wyraźne stłuczenie z obrzękiem.', severe: 'Rozległe stłuczenie — może świadczyć o urazie wewnętrznym.' },
        scrape:   { mild: 'Drobne, powierzchowne otarcie naskórka.', moderate: 'Otarcie z odsłonięciem głębszych warstw skóry.', severe: 'Rozległe lub głębokie otarcie, np. po upadku na asfalt. Może wymagać pomocy lekarza.' },
        puncture: { mild: 'Płytka rana kłuta.', moderate: 'Rana kłuta. Istnieje ryzyko zakażenia.', severe: 'Głęboka rana kłuta. Potrzebna pilna pomoc medyczna.' },
        sprain:   { mild: 'Lekkie skręcenie. Niewielkie naciągnięcie więzadła.', moderate: 'Częściowe naderwanie więzadła. Wyraźny obrzęk.', severe: 'Możliwe całkowite zerwanie więzadła. Natychmiast unieruchom staw.' },
        fracture: { mild: 'Podejrzenie pęknięcia kości. Potrzebne prześwietlenie.', moderate: 'Prawdopodobne złamanie. Nie ruszaj urażonego miejsca.', severe: 'Wyraźne złamanie lub zniekształcenie. Wezwij służby ratunkowe.' },
        bite:     { mild: 'Niewielkie ugryzienie. Skóra ledwo naruszona.', moderate: 'Ugryzienie z przerwaniem skóry. Ryzyko zakażenia.', severe: 'Ciężkie ugryzienie z uszkodzeniem tkanek. Potrzebna pilna pomoc medyczna.' },
    },
};

// Quick first-aid summary steps shown in the UI card (separate from voice scenario)
const QUICK_STEPS = {
    en: {
        burn:     ['Cool under running water for 20 minutes.', 'Remove tight clothing near the area.', 'Do not pop blisters or apply ice.'],
        cut:      ['Apply direct pressure to stop bleeding.', 'Clean the wound with running water.', 'Apply a sterile bandage or dressing.'],
        bruise:   ['Apply ice wrapped in cloth for 15-20 min.', 'Elevate the area above heart level.', 'Rest and avoid further impact.'],
        scrape:   ['Rinse under clean running water.', 'Apply antibiotic ointment.', 'Cover with a non-stick bandage.'],
        puncture: ['Let it bleed slightly to flush bacteria.', 'Wash with soap and water.', 'Cover and monitor for infection.'],
        sprain:   ['R.I.C.E.: Rest, Ice, Compression, Elevation.', 'Apply ice for 15-20 minutes.', 'Use compression bandage for support.'],
        fracture: ['Do NOT move the injured area.', 'Immobilize with a splint if possible.', 'Call for medical help immediately.'],
        bite:     ['Wash thoroughly with soap and water.', 'Apply pressure if bleeding.', 'Seek medical attention for infection risk.'],
    },
    pl: {
        burn:     ['Schładzaj pod bieżącą wodą przez 20 minut.', 'Zdejmij obcisłe ubranie z okolicy oparzenia.', 'Nie przekłuwaj pęcherzy i nie przykładaj lodu.'],
        cut:      ['Uciśnij ranę, aby zatamować krwawienie.', 'Przemyj ranę bieżącą wodą.', 'Załóż jałowy opatrunek.'],
        bruise:   ['Przyłóż lód owinięty w materiał na 15–20 min.', 'Unieś to miejsce powyżej poziomu serca.', 'Odpoczywaj i unikaj kolejnych uderzeń.'],
        scrape:   ['Przepłucz czystą bieżącą wodą.', 'Nałóż maść z antybiotykiem.', 'Przykryj nieprzywierającym opatrunkiem.'],
        puncture: ['Pozwól ranie lekko pokrwawić, by wypłukać bakterie.', 'Umyj mydłem i wodą.', 'Przykryj i obserwuj, czy nie ma zakażenia.'],
        sprain:   ['Odpoczynek, lód, ucisk, uniesienie.', 'Przykładaj lód na 15–20 minut.', 'Załóż bandaż uciskowy dla podparcia.'],
        fracture: ['NIE ruszaj urażonego miejsca.', 'Jeśli możesz, unieruchom je szyną.', 'Natychmiast wezwij pomoc medyczną.'],
        bite:     ['Dokładnie umyj mydłem i wodą.', 'Jeśli krwawi, uciśnij ranę.', 'Zgłoś się do lekarza — ryzyko zakażenia.'],
    },
};

/** Voice scenario for the current language: welcome message + first aid steps */
function buildScenarioSteps() {
    const diagnosis = state.diagnosis;
    if (!diagnosis) return [];
    const steps = diagnosis.scenarios[getLang()] || diagnosis.scenarios.en || [];
    if (steps.length === 0) return [];
    const welcome = t('voice.welcome', { injury: injuryPhrase(diagnosis.type, diagnosis.severity) });
    return [welcome, ...steps];
}

/** Render the diagnosis texts in the current language */
function renderDiagnosis() {
    const { type, severity } = state.diagnosis;
    const typeKey = type.toLowerCase();
    const sevKey = severity.toLowerCase();
    const lang = getLang();

    $('diagTitle').textContent = woundName(type);

    // Severity badge
    const badgeKey = SEVERITY_CONFIG[sevKey] ? sevKey : 'moderate';
    const sevConfig = SEVERITY_CONFIG[badgeKey];
    const badge = $('diagSeverityBadge');
    badge.className = sevConfig.class;
    badge.innerHTML = `<i class="fas ${sevConfig.icon}"></i> ${t(`sev.${badgeKey}`)}`;

    // Subtitle — with an emergency banner for severe cases
    const subtitle = $('diagSubtitle');
    const descriptions = WOUND_DESCRIPTIONS[lang][typeKey] || {};
    const description = descriptions[sevKey] || t('diag.detected', { name: woundName(type) });
    if (sevKey === 'severe') {
        subtitle.innerHTML = `<strong style="color:var(--danger-color);">⚠️ ${description}</strong>`;
    } else {
        subtitle.textContent = description;
    }

    // Quick steps
    const steps = QUICK_STEPS[lang][typeKey] || [t('diag.followVoice')];
    const iconColor = sevKey === 'severe' ? 'var(--danger-color)' : 'var(--success-color)';
    const iconClass = sevKey === 'severe' ? 'fa-exclamation-circle' : 'fa-check-circle';
    $('stepsList').innerHTML = steps.map(step =>
        `<li><i class="fas ${iconClass}" style="color:${iconColor};"></i> <span>${step}</span></li>`
    ).join('');

    renderVoiceButton();
}

/** Fill the diagnosis screen from an /analyze response */
export function populateDiagnosisScreen(data) {
    const severity = data.severity || 'Moderate';
    state.diagnosis = {
        type: data.diagnosis,
        severity,
        // Older backends only send scenario_array in the requested language
        scenarios: data.scenarios || { [getLang()]: data.scenario_array || [] },
    };

    $('diagImageResult').src = $('imagePreview').src;

    // Store scenario for voice assistant
    state.scenarioArray = buildScenarioSteps();
    state.currentScenarioIndex = 0;
    state.isChatMode = false;
    state.messageHistory.length = 0;

    state.isVoiceActive = false;
    $('btnVoiceAssistant').classList.remove('active');
    renderDiagnosis();
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
    if (!confirm(t('diag.confirmEnd'))) return;

    state.isProcessActive = false;
    stopVoiceAssistant();
    state.diagnosis = null;
    state.scenarioArray = [];
    state.currentScenarioIndex = 0;
    state.messageHistory.length = 0;

    const { resetScanUI } = await import('./scan.js');
    resetScanUI();
    switchScreen('homeScreen', null, 0);
}

// Re-render in the new language. The scenario is rebuilt here (not in voice.js)
// so the voice guide always refreshes after state.scenarioArray is up to date.
window.addEventListener('langchange', () => {
    if (state.diagnosis) {
        state.scenarioArray = buildScenarioSteps();
        renderDiagnosis();
    }
    refreshVoiceGuide();
});

// Expose to global scope
window.toggleCollapsedSteps = toggleCollapsedSteps;
window.endProcess = endProcess;
