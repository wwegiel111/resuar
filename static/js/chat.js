/**
 * AI Chat screen — connected to /more backend endpoint.
 */
import { $ } from './dom.js';
import { askMore } from './api.js';

// Persistent chat history for the session (Gemini format)
const chatHistory = [];

export function handleChatEnter(event) {
    if (event.key === 'Enter') sendChatMessage();
}

export async function sendChatMessage() {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const chatMessages = $('chatMessages');

    // Show user message
    appendMessage(chatMessages, text, 'user');
    input.value = '';
    input.disabled = true;

    // Show typing indicator
    const typingEl = appendMessage(chatMessages, '<i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i> Thinking...', 'ai');

    // Add to history
    chatHistory.push({ role: 'user', parts: [text] });

    try {
        const answer = await askMore(chatHistory);

        // Store AI response in history
        chatHistory.push({ role: 'model', parts: [answer] });

        // Replace typing indicator with actual response
        typingEl.innerHTML = answer;
    } catch (error) {
        console.error('[Chat] Error:', error);
        typingEl.innerHTML =
            '<i class="fas fa-exclamation-triangle" style="color:var(--danger-color); margin-right:6px;"></i> ' +
            'Could not reach the AI. Please try again.';
        // Remove failed message from history so user can retry
        chatHistory.pop();
    }

    input.disabled = false;
    input.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendMessage(container, content, sender) {
    const msg = document.createElement('div');
    msg.className = `msg ${sender}`;
    msg.innerHTML = content;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    return msg;
}

// Expose to global scope
window.handleChatEnter = handleChatEnter;
window.sendChatMessage = sendChatMessage;
