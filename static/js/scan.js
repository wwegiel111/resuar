/**
 * Scan screen — file selection + image analysis.
 */
import { $, vibrate } from './dom.js';
import { state } from './state.js';
import { analyzeImage } from './api.js';
import { switchScreen } from './navigation.js';
import { populateDiagnosisScreen } from './diagnosis.js';

let cameraUI, imagePreview, analyzeBtn, btnTakePic, btnGallery, resultPanel, loaderOverlay;

export function initScan() {
    cameraUI = $('cameraUI');
    imagePreview = $('imagePreview');
    analyzeBtn = $('analyzeBtn');
    btnTakePic = $('btnTakePic');
    btnGallery = $('btnGallery');
    resultPanel = $('resultPanel');
    loaderOverlay = $('loaderOverlay');

    $('cameraInput').addEventListener('change', handleFileSelect);
    $('galleryInput').addEventListener('change', handleFileSelect);
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    state.selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        imagePreview.src = e.target.result;
        imagePreview.style.display = 'block';
        cameraUI.style.display = 'none';
        btnTakePic.style.display = 'none';
        btnGallery.style.display = 'none';
        analyzeBtn.style.display = 'flex';
        resultPanel.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

export async function analyze() {
    if (!state.selectedFile) return;
    vibrate(50);

    resultPanel.style.display = 'none';
    loaderOverlay.style.display = 'flex';
    analyzeBtn.disabled = true;

    try {
        const data = await analyzeImage(state.selectedFile);

        loaderOverlay.style.display = 'none';
        btnTakePic.style.display = 'flex';
        btnGallery.style.display = 'flex';
        analyzeBtn.style.display = 'none';
        analyzeBtn.disabled = false;

        if (data.diagnosis) {
            state.isProcessActive = true;
            populateDiagnosisScreen(data.diagnosis, data.scenario_array || []);
            switchScreen('diagnosisScreen', null, 2);
        } else {
            showError(data.error || 'Unknown error');
        }
    } catch (error) {
        loaderOverlay.style.display = 'none';
        btnTakePic.style.display = 'flex';
        btnGallery.style.display = 'flex';
        analyzeBtn.style.display = 'none';
        analyzeBtn.disabled = false;
        showError('Server connection error.');
    }
}

function showError(msg) {
    resultPanel.style.display = 'block';
    resultPanel.className = 'result-panel error';
    resultPanel.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${msg}`;
}

export function resetScanUI() {
    imagePreview.style.display = 'none';
    cameraUI.style.display = 'flex';
    btnTakePic.style.display = 'flex';
    btnGallery.style.display = 'flex';
    analyzeBtn.style.display = 'none';
    state.selectedFile = null;
    $('cameraInput').value = '';
    $('galleryInput').value = '';
}

// Expose to global scope
window.analyze = analyze;
