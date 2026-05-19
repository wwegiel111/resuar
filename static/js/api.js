/**
 * API helpers — thin wrappers around fetch calls to the backend.
 */

export async function analyzeImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/analyze', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || 'Analysis failed');
    return data;
}

export async function askMore(history) {
    const response = await fetch('/more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || 'Server error');
    return data.text || '';
}

export function getAudioUrl(prompt) {
    return `/get_audio?prompt=${encodeURIComponent(prompt)}`;
}

export async function transcribeAudio(blob) {
    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    const response = await fetch('/transcribe', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Transcription failed');
    return (data.transcript || '').toLowerCase();
}
