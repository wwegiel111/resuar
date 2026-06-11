/**
 * Recovery position (pozycja bezpieczna) — step-by-step visual guide.
 * Each step renders an inline SVG illustration themed via CSS variables.
 */
import { $, vibrate } from './dom.js';
import { switchScreen } from './navigation.js';

/* ---- Palette (CSS variables so dark mode just works) ---- */
const BODY = 'var(--text-muted)';
const ACTIVE = 'var(--blue-card)';
const MOVE = 'var(--danger-color)';
const MAT = 'var(--bg-main)';

/* ---- Shared SVG fragments ---- */
const SVG_OPEN = '<svg viewBox="0 0 400 228" xmlns="http://www.w3.org/2000/svg">';
const SVG_CLOSE = '</svg>';

const ARROW_DEFS = `
    <defs>
        <marker id="arrMove" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="${MOVE}"/>
        </marker>
        <marker id="arrAct" viewBox="0 0 10 10" refX="8" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="${ACTIVE}"/>
        </marker>
    </defs>`;

const FLOOR_MAT = `<rect x="14" y="16" width="372" height="198" rx="24" fill="${MAT}"/>`;

/* Top-down view of the person lying on their back (head on the left,
   rescuer kneels at the bottom edge of the picture). */
const TD_HEAD = (c = BODY) =>
    `<circle cx="80" cy="112" r="23" fill="none" stroke="${c}" stroke-width="8"/>`;
const TD_TORSO =
    `<line x1="116" y1="112" x2="226" y2="112" stroke="${BODY}" stroke-width="34" stroke-linecap="round"/>`;
const TD_LEG_FAR =
    `<line x1="238" y1="103" x2="348" y2="90" stroke="${BODY}" stroke-width="13" stroke-linecap="round"/>`;
const TD_LEG_NEAR =
    `<line x1="238" y1="121" x2="348" y2="134" stroke="${BODY}" stroke-width="13" stroke-linecap="round"/>`;
const TD_ARM_FAR =
    `<line x1="124" y1="95" x2="210" y2="87" stroke="${BODY}" stroke-width="12" stroke-linecap="round"/>`;
const TD_ARM_NEAR =
    `<line x1="124" y1="129" x2="210" y2="137" stroke="${BODY}" stroke-width="12" stroke-linecap="round"/>`;

const TD_ARM_NEAR_BENT = (c = BODY) => `
    <line x1="124" y1="129" x2="124" y2="178" stroke="${c}" stroke-width="12" stroke-linecap="round"/>
    <line x1="124" y1="178" x2="76" y2="178" stroke="${c}" stroke-width="12" stroke-linecap="round"/>
    <circle cx="66" cy="178" r="9" fill="${c}"/>`;

const TD_ARM_FAR_CHEEK = (c = BODY) => `
    <path d="M 128 96 Q 178 108 110 131" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/>
    <circle cx="104" cy="134" r="9" fill="${c}"/>`;

const TD_LEG_FAR_BENT = (c = BODY) => `
    <line x1="238" y1="103" x2="298" y2="62" stroke="${c}" stroke-width="13" stroke-linecap="round"/>
    <line x1="298" y1="62" x2="250" y2="46" stroke="${c}" stroke-width="13" stroke-linecap="round"/>
    <circle cx="243" cy="44" r="8" fill="${c}"/>`;

/* Side view of the person already on their side (final position). */
const SIDE_FIGURE = (headColor = BODY) => `
    <line x1="36" y1="192" x2="364" y2="192" stroke="var(--border-color)" stroke-width="5" stroke-linecap="round"/>
    <circle cx="86" cy="158" r="21" fill="none" stroke="${headColor}" stroke-width="8"/>
    <circle cx="80" cy="180" r="8" fill="${BODY}"/>
    <line x1="120" y1="168" x2="235" y2="170" stroke="${BODY}" stroke-width="30" stroke-linecap="round"/>
    <line x1="132" y1="172" x2="98" y2="187" stroke="${BODY}" stroke-width="11" stroke-linecap="round"/>
    <line x1="245" y1="166" x2="192" y2="178" stroke="${BODY}" stroke-width="13" stroke-linecap="round"/>
    <line x1="192" y1="178" x2="216" y2="190" stroke="${BODY}" stroke-width="13" stroke-linecap="round"/>
    <line x1="245" y1="172" x2="348" y2="180" stroke="${BODY}" stroke-width="13" stroke-linecap="round"/>`;

const BREATH_MARKS = (c = ACTIVE) => `
    <path d="M 54 150 q -9 8 0 16" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M 42 146 q -12 12 0 24" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`;

/* ---- Guide steps ---- */
const RECOVERY_STEPS = [
    {
        title: 'Arm at a Right Angle',
        sub: 'Kneel beside the person. Place the arm nearest to you at a right angle to their body, elbow bent, palm facing up.',
        svg: SVG_OPEN + ARROW_DEFS + FLOOR_MAT +
            TD_LEG_FAR + TD_LEG_NEAR + TD_TORSO + TD_ARM_FAR + TD_HEAD() +
            TD_ARM_NEAR_BENT(ACTIVE) +
            `<path d="M 200 152 Q 175 196 100 194" fill="none" stroke="${MOVE}"
                   stroke-width="3.5" stroke-dasharray="6 7" marker-end="url(#arrMove)"/>` +
            SVG_CLOSE,
    },
    {
        title: 'Hand Against the Cheek',
        sub: 'Bring the far arm across the chest and hold the back of their hand against the cheek nearest to you.',
        svg: SVG_OPEN + ARROW_DEFS + FLOOR_MAT +
            TD_LEG_FAR + TD_LEG_NEAR + TD_TORSO + TD_HEAD() +
            TD_ARM_NEAR_BENT() +
            TD_ARM_FAR_CHEEK(ACTIVE) +
            `<path d="M 205 76 Q 150 42 112 98" fill="none" stroke="${MOVE}"
                   stroke-width="3.5" stroke-dasharray="6 7" marker-end="url(#arrMove)"/>` +
            SVG_CLOSE,
    },
    {
        title: 'Bend the Far Knee',
        sub: 'With your other hand, pull the far knee up so the leg is bent and the foot stays flat on the ground.',
        svg: SVG_OPEN + ARROW_DEFS + FLOOR_MAT +
            TD_LEG_NEAR + TD_TORSO + TD_HEAD() +
            TD_ARM_NEAR_BENT() + TD_ARM_FAR_CHEEK() +
            TD_LEG_FAR_BENT(ACTIVE) +
            `<path d="M 344 78 Q 322 30 268 38" fill="none" stroke="${MOVE}"
                   stroke-width="3.5" stroke-dasharray="6 7" marker-end="url(#arrMove)"/>` +
            SVG_CLOSE,
    },
    {
        title: 'Roll Towards You',
        sub: 'Keep their hand pressed against the cheek. Pull the bent knee towards you to roll them gently onto their side.',
        svg: SVG_OPEN + ARROW_DEFS + FLOOR_MAT +
            TD_LEG_NEAR + TD_TORSO + TD_HEAD() +
            TD_ARM_NEAR_BENT() + TD_ARM_FAR_CHEEK() + TD_LEG_FAR_BENT() +
            `<path d="M 192 50 Q 268 112 192 178" fill="none" stroke="${ACTIVE}"
                   stroke-width="5" stroke-dasharray="9 9" marker-end="url(#arrAct)"/>` +
            SVG_CLOSE,
    },
    {
        title: 'Open the Airway',
        sub: 'Tilt the head gently back so the airway stays open. Adjust the hand under the cheek to keep the head tilted.',
        svg: SVG_OPEN + ARROW_DEFS + FLOOR_MAT +
            SIDE_FIGURE(ACTIVE) +
            `<path d="M 56 132 Q 86 110 118 134" fill="none" stroke="${MOVE}"
                   stroke-width="3.5" stroke-dasharray="6 7" marker-end="url(#arrMove)"/>` +
            SVG_CLOSE,
    },
    {
        title: 'Monitor & Call 112',
        sub: 'Check their breathing regularly until help arrives. If no one has called yet, call 112 now.',
        svg: SVG_OPEN + ARROW_DEFS + FLOOR_MAT +
            SIDE_FIGURE() + BREATH_MARKS() +
            `<rect x="280" y="34" width="88" height="46" rx="15" fill="${MOVE}"/>
             <text x="324" y="65" text-anchor="middle" font-size="23" font-weight="800"
                   fill="#FFFFFF" font-family="Inter, sans-serif">112</text>` +
            SVG_CLOSE,
    },
];

let currentStep = 0;

function renderRecoveryStep() {
    const step = RECOVERY_STEPS[currentStep];
    const total = RECOVERY_STEPS.length;

    $('recoveryIllustration').innerHTML = step.svg;
    $('recoveryStepTitle').textContent = step.title;
    $('recoveryStepSub').textContent = step.sub;
    $('recoveryStepLabel').textContent = `STEP ${currentStep + 1} OF ${total}`;

    $('recoveryProgress').innerHTML = RECOVERY_STEPS.map((_, i) => {
        const cls = i < currentStep ? 'done' : i === currentStep ? 'active' : '';
        return `<div class="vg-progress-dot ${cls}"></div>`;
    }).join('');

    $('btnRecoveryPrev').disabled = currentStep === 0;
    $('btnRecoveryNext').innerHTML = currentStep === total - 1
        ? '<i class="fas fa-check"></i> Done'
        : 'Next <i class="fas fa-arrow-right"></i>';
}

export function openRecoveryGuide() {
    currentStep = 0;
    switchScreen('recoveryScreen', null, -1);
    renderRecoveryStep();
}

export function nextRecoveryStep() {
    vibrate(20);
    if (currentStep === RECOVERY_STEPS.length - 1) {
        switchScreen('homeScreen', null, 0);
    } else {
        currentStep++;
        renderRecoveryStep();
    }
}

export function prevRecoveryStep() {
    if (currentStep === 0) return;
    vibrate(20);
    currentStep--;
    renderRecoveryStep();
}

// Expose to global scope for inline onclick handlers
window.openRecoveryGuide = openRecoveryGuide;
window.nextRecoveryStep = nextRecoveryStep;
window.prevRecoveryStep = prevRecoveryStep;
