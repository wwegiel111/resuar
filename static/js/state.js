/**
 * Shared application state.
 * Imported by other modules that need to read/write global flags.
 */

export const state = {
    isProcessActive: false,
    selectedFile: null,

    // Last diagnosis: { type, severity, scenarios: { pl: [...], en: [...] } }
    diagnosis: null,

    // Voice assistant — scenarioArray is the welcome message + steps in the current language
    scenarioArray: [],
    currentScenarioIndex: 0,
    isChatMode: false,
    messageHistory: [],
    currentAudio: null,
    currentRecognition: null,
    isVoiceActive: false,

    // CPR
    isCprRunning: false,
    cprPhase: 0,       // 0 = compressions, 1 = breaths
    cprTime: 0,
    isTransitioning: false,
    transitionTime: 3,
    cprInterval: null,
    audioCtx: null,
    beepInterval: null,
};
