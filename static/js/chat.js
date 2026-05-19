/**
 * AI Chat screen logic.
 */
import { $ } from './dom.js';

export function handleChatEnter(event) {
    if (event.key === 'Enter') sendChatMessage();
}

export function sendChatMessage() {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const chatMessages = $('chatMessages');

    const userMsg = document.createElement('div');
    userMsg.className = 'msg user';
    userMsg.textContent = text;
    chatMessages.appendChild(userMsg);

    input.value = '';
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Placeholder response (backend not yet connected for chat screen)
    setTimeout(() => {
        const aiMsg = document.createElement('div');
        aiMsg.className = 'msg ai';
        aiMsg.innerHTML =
            '<i class="fas fa-robot" style="color:var(--blue-card); margin-right:5px;"></i> ' +
            'This feature is not yet connected to the backend, but the interface is ready!';
        chatMessages.appendChild(aiMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 1000);
}

// Expose to global scope
window.handleChatEnter = handleChatEnter;
window.sendChatMessage = sendChatMessage;
