/**
 * API helpers — thin wrappers around fetch calls to the backend.
 * Every request carries the current UI language so the backend answers,
 * transcribes and speaks in it.
 */
import { getLang, t } from './i18n.js';

export async function analyzeImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('lang', getLang());
    const response = await fetch('/analyze', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || t('api.analysisFailed'));
    return data;
}

export async function askMore(history) {
    const response = await fetch('/more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history, lang: getLang() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || t('api.serverError'));
    return data.text || '';
}

export function getAudioUrl(prompt) {
    return `/get_audio?prompt=${encodeURIComponent(prompt)}&lang=${getLang()}`;
}

export async function transcribeAudio(blob) {
    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('lang', getLang());
    const response = await fetch('/transcribe', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || t('api.transcriptionFailed'));
    return (data.transcript || '').toLowerCase();
}
