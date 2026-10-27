/**
 * Internationalization — Polish (default) and English.
 *
 * Static HTML text is tagged with data-i18n="key" (also data-i18n-placeholder
 * and data-i18n-alt). Dynamic text in JS uses t('key', {vars}).
 * Changing the language fires a 'langchange' event on window so modules can
 * re-render what they generated.
 */

const STORAGE_KEY = 'rescuar-lang';
const DEFAULT_LANG = 'pl';
export const LANGS = ['pl', 'en'];

const STRINGS = {
    pl: {
        'app.title': 'RescuAR – Pierwsza pomoc z AI',

        'nav.home': 'Start',
        'nav.chat': 'Czat',
        'nav.scan': 'Skanuj',
        'nav.sos': 'SOS',
        'nav.lang': 'English',  // label shows the language you switch TO

        'home.title': 'W czym możemy dziś pomóc?',
        'home.aiCamera': 'Kamera AI',
        'home.scanTitle': 'Zeskanuj uraz',
        'home.scanSub': 'Natychmiastowa ocena rany na podstawie zdjęcia',
        'home.cprTitle': 'Resuscytacja (RKO)',
        'home.cprSub': 'Przewodnik pierwszej pomocy z dźwiękiem i obrazem',
        'home.chatTitle': 'Zapytaj AI',
        'home.chatSub': 'Czat medyczny na żywo',
        'home.sosTitle': 'Numery alarmowe',
        'home.sosSub': 'Wezwij służby ratunkowe',

        'cpr.title': 'Pierwsza pomoc (RKO)',
        'cpr.ready': 'Przygotuj się do RKO',
        'cpr.readySub': 'Naciśnij start, aby podążać za rytmem.',
        'cpr.start': 'Rozpocznij RKO',
        'cpr.stop': 'Zatrzymaj RKO',
        'cpr.compressions': '30 uciśnięć',
        'cpr.compressionsSub': 'Uciskaj mocno i szybko (100–120 na minutę)',
        'cpr.breaths': '2 oddechy ratownicze',
        'cpr.breathsSub': 'Odchyl głowę do tyłu i wykonaj 2 wdechy',
        'cpr.getReady': 'Przygotuj się...',
        'cpr.prepCompressions': 'Za chwilę uciśnięcia',
        'cpr.prepBreaths': 'Za chwilę oddechy',
        'cpr.startingIn': 'Start za...',
        'cpr.recoveryBtn': 'Pozycja bezpieczna – instrukcja',
        'cpr.recoveryHint': 'Jeśli poszkodowany zacznie normalnie oddychać, ułóż go w pozycji bezpiecznej.',

        'recovery.title': 'Pozycja bezpieczna',
        'recovery.stepLabel': 'Krok {n} z {total}',
        'recovery.loading': 'Ładowanie...',
        'recovery.back': 'Wstecz',
        'recovery.next': 'Dalej',
        'recovery.done': 'Gotowe',

        'scan.title': 'Zeskanuj uraz',
        'scan.focus': 'OSTROŚĆ',
        'scan.previewAlt': 'Podgląd rany',
        'scan.analyzing': 'Trwa analiza...',
        'scan.hint': 'Uchwyć uraz w dobrym świetle. Zdjęcia są bezpiecznie analizowane przez AI.',
        'scan.takePhoto': 'Zrób zdjęcie',
        'scan.gallery': 'Z galerii',
        'scan.analyze': 'Analizuj zdjęcie',
        'scan.unknownError': 'Nieznany błąd',
        'scan.connectionError': 'Błąd połączenia z serwerem.',

        'diag.title': 'Diagnoza AI',
        'diag.imageAlt': 'Analizowana rana',
        'diag.placeholderTitle': 'Nazwa diagnozy',
        'diag.placeholderSub': 'Tutaj pojawią się szczegóły analizy.',
        'diag.startVoice': 'Uruchom asystenta głosowego',
        'diag.stopVoice': 'Zatrzymaj asystenta głosowego',
        'diag.whatThisMeans': 'Co to oznacza',
        'diag.firstAidSteps': 'Kroki pierwszej pomocy',
        'diag.liveTranscription': 'Transkrypcja na żywo',
        'diag.listening': 'Słucham...',
        'diag.detected': 'Wykryto: {name}. Wykonaj poniższe kroki pierwszej pomocy.',
        'diag.followVoice': 'Postępuj zgodnie ze wskazówkami asystenta głosowego.',
        'diag.confirmEnd': 'Czy na pewno chcesz zamknąć tę sprawę i zakończyć proces?',

        'sev.mild': 'ŁAGODNY',
        'sev.moderate': 'UMIARKOWANY',
        'sev.severe': 'CIĘŻKI',

        'wound.burn': 'Oparzenie',
        'wound.cut': 'Rozcięcie',
        'wound.bruise': 'Stłuczenie',
        'wound.scrape': 'Otarcie',
        'wound.puncture': 'Rana kłuta',
        'wound.sprain': 'Skręcenie',
        'wound.fracture': 'Złamanie',
        'wound.bite': 'Ugryzienie',

        'voice.title': 'Prowadzenie głosowe',
        'voice.live': 'Na żywo',
        'voice.stepLabel': 'Krok {n} z {total}',
        'voice.loadingStep': 'Ładowanie kroku...',
        'voice.heard': 'Rozpoznana mowa',
        'voice.listening': 'Słucham...',
        'voice.btnNext': 'Dalej',
        'voice.btnRepeat': 'Powtórz',
        'voice.btnMore': 'Pytanie',
        'voice.micDenied': 'Brak dostępu do mikrofonu. Sterowanie głosem jest niedostępne.',
        'voice.confirmStop': 'Czy na pewno chcesz zatrzymać asystenta głosowego?',
        'voice.starting': 'Uruchamiam asystenta głosowego...',
        'voice.hintSteps': 'Słucham... powiedz lub dotknij: „dalej”, „powtórz”, „pytanie”',
        'voice.hintQa': 'Tryb pytań — zadaj pytanie albo powiedz lub dotknij „dalej”',
        'voice.recording': 'Nagrywam...',
        'voice.processing': 'Przetwarzam...',
        'voice.youSaid': 'Rozpoznano: „{text}”',
        'voice.speaking': 'Mówię...',
        'voice.thinking': 'Myślę...',
        'voice.noSteps': 'Brak kroków pierwszej pomocy.',
        'voice.completed': 'Procedura pierwszej pomocy zakończona.',
        'voice.continuing': 'Przechodzę do następnego kroku...',
        'voice.stopped': 'Procedura zatrzymana.',
        // Spoken by TTS — no abbreviations, typographic quotes are not read aloud.
        // Kept short: on a 393px-wide phone a longer text pushes the voice buttons off screen.
        'voice.welcome': 'Rozpoznano {injury}. Poprowadzę cię krok po kroku. ' +
            'Po każdym kroku powiedz „dalej”. Masz pytanie? Powiedz „pytanie”. ' +
            'Aby powtórzyć, powiedz „powtórz”. Zaczynamy.',
        'voice.helpMode': 'Tryb pytań włączony. Zadaj pytanie albo powiedz „dalej”, aby kontynuować.',
        'voice.error': 'Błąd komunikacji. Zapytaj ponownie albo powiedz „dalej”.',
        'voice.context': 'Kontekst bieżącego kroku: {step}. Moje pytanie: {question}',
        'voice.noContext': 'Brak kontekstu',

        'chat.title': 'Czat medyczny AI',
        'chat.greeting': 'Cześć! Jestem asystentem medycznym AI. Opisz objawy lub zadaj pytanie o pierwszą pomoc, a postaram się pomóc.',
        'chat.placeholder': 'Napisz wiadomość...',
        'chat.thinking': 'Myślę...',
        'chat.error': 'Nie udało się połączyć z AI. Spróbuj ponownie.',

        'sos.title': 'Numery alarmowe',
        'sos.hint': 'Dotknij numeru, aby od razu zadzwonić.',
        'sos.112': 'Numer alarmowy',
        'sos.999': 'Pogotowie ratunkowe',
        'sos.998': 'Straż pożarna',
        'sos.997': 'Policja',

        'api.analysisFailed': 'Analiza nie powiodła się',
        'api.serverError': 'Błąd serwera',
        'api.transcriptionFailed': 'Transkrypcja nie powiodła się',
    },

    en: {
        'app.title': 'RescuAR - AI First Aid',

        'nav.home': 'Home',
        'nav.chat': 'Chat',
        'nav.scan': 'Scan',
        'nav.sos': 'SOS',
        'nav.lang': 'Polski',

        'home.title': 'How can we help you today?',
        'home.aiCamera': 'AI Camera',
        'home.scanTitle': 'Scan injury',
        'home.scanSub': 'Instant wound diagnosis from a photo',
        'home.cprTitle': 'Emergency CPR',
        'home.cprSub': 'First aid audio-visual guide',
        'home.chatTitle': 'Ask AI',
        'home.chatSub': 'Live medical chat',
        'home.sosTitle': 'Emergency SOS',
        'home.sosSub': 'Call emergency services',

        'cpr.title': 'First Aid (CPR)',
        'cpr.ready': 'Ready for CPR',
        'cpr.readySub': 'Press start to follow the rhythm.',
        'cpr.start': 'Start CPR',
        'cpr.stop': 'Stop CPR',
        'cpr.compressions': '30 Compressions',
        'cpr.compressionsSub': 'Push hard and fast (100-120 BPM)',
        'cpr.breaths': '2 Rescue Breaths',
        'cpr.breathsSub': 'Tilt head back, give 2 breaths',
        'cpr.getReady': 'Get Ready...',
        'cpr.prepCompressions': 'Prepare for Compressions',
        'cpr.prepBreaths': 'Prepare for Breaths',
        'cpr.startingIn': 'Starting in...',
        'cpr.recoveryBtn': 'Recovery Position Guide',
        'cpr.recoveryHint': 'If they start breathing normally, place them in the recovery position.',

        'recovery.title': 'Recovery Position',
        'recovery.stepLabel': 'Step {n} of {total}',
        'recovery.loading': 'Loading...',
        'recovery.back': 'Back',
        'recovery.next': 'Next',
        'recovery.done': 'Done',

        'scan.title': 'Scan injury',
        'scan.focus': 'FOCUS',
        'scan.previewAlt': 'Wound preview',
        'scan.analyzing': 'Analysis in progress...',
        'scan.hint': 'Frame the injury in good lighting. Photos are securely analyzed by AI.',
        'scan.takePhoto': 'Take photo',
        'scan.gallery': 'From gallery',
        'scan.analyze': 'Analyze result',
        'scan.unknownError': 'Unknown error',
        'scan.connectionError': 'Server connection error.',

        'diag.title': 'AI Diagnosis',
        'diag.imageAlt': 'Analyzed wound',
        'diag.placeholderTitle': 'Diagnosis Name',
        'diag.placeholderSub': 'Analyzed details will appear here.',
        'diag.startVoice': 'Start Voice Assistant',
        'diag.stopVoice': 'Stop Voice Assistant',
        'diag.whatThisMeans': 'What this means',
        'diag.firstAidSteps': 'First Aid Steps',
        'diag.liveTranscription': 'Live Transcription',
        'diag.listening': 'Listening...',
        'diag.detected': '{name} detected. Follow the first aid steps below.',
        'diag.followVoice': 'Follow the voice assistant for detailed guidance.',
        'diag.confirmEnd': 'Are you sure you want to close this case and end the process?',

        'sev.mild': 'MILD',
        'sev.moderate': 'MODERATE',
        'sev.severe': 'SEVERE',

        'wound.burn': 'Burn',
        'wound.cut': 'Cut',
        'wound.bruise': 'Bruise',
        'wound.scrape': 'Scrape',
        'wound.puncture': 'Puncture',
        'wound.sprain': 'Sprain',
        'wound.fracture': 'Fracture',
        'wound.bite': 'Bite',

        'voice.title': 'Voice Guidance',
        'voice.live': 'Live',
        'voice.stepLabel': 'Step {n} of {total}',
        'voice.loadingStep': 'Loading step...',
        'voice.heard': 'Recognized speech',
        'voice.listening': 'Listening...',
        'voice.btnNext': 'Next',
        'voice.btnRepeat': 'Repeat',
        'voice.btnMore': 'More',
        'voice.micDenied': 'Microphone access denied. Voice control unavailable.',
        'voice.confirmStop': 'Are you sure you want to stop the Voice Assistant?',
        'voice.starting': 'Starting voice assistant...',
        'voice.hintSteps': 'Listening... say or tap: "next", "repeat", "more"',
        'voice.hintQa': 'Q&A mode — Ask a question, or say/tap "next"',
        'voice.recording': 'Recording...',
        'voice.processing': 'Processing...',
        'voice.youSaid': 'You said: "{text}"',
        'voice.speaking': 'Speaking...',
        'voice.thinking': 'Thinking...',
        'voice.noSteps': 'No scenario steps available.',
        'voice.completed': 'First aid procedure completed.',
        'voice.continuing': 'Continuing to next step...',
        'voice.stopped': 'Procedure stopped.',
        'voice.welcome': 'I recognized a {injury}. I will guide you through the first aid steps. ' +
            'When you finish a step, say "Next". If you have a question, say "More". ' +
            'To hear the step again, say "Repeat". Let\'s begin.',
        'voice.helpMode': 'Help mode activated. Ask your question, or say next to continue.',
        'voice.error': 'Communication error. Try asking again or say next.',
        'voice.context': 'Context of current step: {step}. My question is: {question}',
        'voice.noContext': 'No context',

        'chat.title': 'Medical AI Chat',
        'chat.greeting': 'Hello! I am an AI medical assistant. Describe your symptoms or ask a first aid question, and I will try to help.',
        'chat.placeholder': 'Type a message...',
        'chat.thinking': 'Thinking...',
        'chat.error': 'Could not reach the AI. Please try again.',

        'sos.title': 'Emergency Numbers',
        'sos.hint': 'Tap a number to call immediately from your device.',
        'sos.112': 'Emergency Call Center',
        'sos.999': 'Ambulance',
        'sos.998': 'Fire Brigade',
        'sos.997': 'Police',

        'api.analysisFailed': 'Analysis failed',
        'api.serverError': 'Server error',
        'api.transcriptionFailed': 'Transcription failed',
    },
};

function readStoredLang() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (LANGS.includes(saved)) return saved;
    } catch (e) { /* storage unavailable (private mode) */ }
    return DEFAULT_LANG;
}

let currentLang = readStoredLang();

export function getLang() {
    return currentLang;
}

/** Translate a key, filling {placeholders} from vars. Falls back to English, then the key. */
export function t(key, vars = {}) {
    const template = STRINGS[currentLang][key] ?? STRINGS.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? vars[name] : match));
}

/** Display name of a wound type returned by the backend ("Burn", "Cut", ...) */
export function woundName(type) {
    return t(`wound.${(type || '').toLowerCase()}`);
}

// Polish needs the accusative form and an adjective that agrees with the noun's gender
const PL_INJURY = {
    burn: ['oparzenie', 'n'],
    cut: ['rozcięcie', 'n'],
    bruise: ['stłuczenie', 'n'],
    scrape: ['otarcie', 'n'],
    puncture: ['ranę kłutą', 'f'],
    sprain: ['skręcenie', 'n'],
    fracture: ['złamanie', 'n'],
    bite: ['ugryzienie', 'n'],
};
const PL_SEVERITY = {
    mild: { n: 'łagodne', f: 'łagodną' },
    moderate: { n: 'umiarkowane', f: 'umiarkowaną' },
    severe: { n: 'poważne', f: 'poważną' },
};

/** "moderate burn" / "umiarkowane oparzenie" — used in the spoken welcome message */
export function injuryPhrase(type, severity) {
    const typeKey = (type || '').toLowerCase();
    const sevKey = (severity || 'moderate').toLowerCase();
    if (currentLang === 'pl') {
        const [noun, gender] = PL_INJURY[typeKey] || [woundName(type).toLowerCase(), 'n'];
        const adjective = (PL_SEVERITY[sevKey] || PL_SEVERITY.moderate)[gender];
        return `${adjective} ${noun}`;
    }
    const sevText = sevKey === 'severe' ? 'serious' : sevKey;
    return `${sevText} ${typeKey}`;
}

/** Apply translations to all tagged elements in the static HTML */
export function applyTranslations(root = document) {
    document.documentElement.lang = currentLang;
    document.title = t('app.title');
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll('[data-i18n-alt]').forEach(el => {
        el.alt = t(el.dataset.i18nAlt);
    });
}

/**
 * Render the initial language: translate the static HTML, then let modules
 * render their dynamic text through the same 'langchange' event used on switch.
 */
export function initI18n() {
    applyTranslations();
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: currentLang } }));
}

export function setLang(lang) {
    if (!LANGS.includes(lang) || lang === currentLang) return;
    currentLang = lang;
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) { /* storage unavailable — language still applies for this session */ }
    applyTranslations();
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

export function toggleLanguage() {
    setLang(currentLang === 'pl' ? 'en' : 'pl');
}

// Expose to global scope for the inline onclick handler
window.toggleLanguage = toggleLanguage;
