/**
 * API helpers — thin wrappers around fetch calls to the backend.
 */

export async function analyzeImage(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/analyze', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unknown error');
    return data;
}

export async function askMore(history) {
    const response = await fetch('/more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
    });
    if (!response.ok) throw new Error('Server error');
    const data = await response.json();
    return data.text || '';
}

export function getAudioUrl(prompt) {
    return `/get_audio?prompt=${encodeURIComponent(prompt)}`;
}
