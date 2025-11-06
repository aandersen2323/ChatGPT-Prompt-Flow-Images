let isProcessing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notify(text) {
  try {
    chrome.runtime.sendMessage({ type: 'PROMPT_PROGRESS', text }, () => {
      // Ignore disconnect errors when the popup is closed mid-queue.
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // Silently swallow errors (e.g., if messaging API is unavailable).
  }
}

function getComposer() {
  const selectors = [
    'textarea[data-testid="prompt-text-input"]',
    'textarea[data-testid="prompt-textarea"]',
    'textarea[data-testid="textbox"]',
    'div[data-testid="prompt-textarea"] textarea',
    'div[data-testid="prompt-textarea"] [contenteditable="true"]',
    'div[data-testid="prompt-editor"] textarea',
    'div[data-testid="prompt-editor"] [contenteditable="true"]',
    'div[data-testid="composer-textarea"] textarea',
    'div[data-testid="composer-textarea"] [contenteditable="true"]',
    'div[role="textbox"][data-testid="prompt-textarea"]',
    'div[role="textbox"][aria-label*="Describe" i]',
    'div[role="textbox"][aria-label*="want to see" i]',
    'textarea[data-id="root"]',
    'div[data-id="root"] textarea',
    'div[contenteditable="true"][data-id="root"]',
    'div[data-lexical-editor="true"][contenteditable="true"]',
    'textarea[placeholder*="Message" i]',
    'textarea[placeholder*="Describe" i]',
    'textarea[placeholder*="Create" i]',
    'textarea[data-testid*="composer"]',
    'textarea[data-testid*="prompt"]',
    'textarea[data-testid*="message"]',
    'div[contenteditable="true"][data-testid*="composer"]',
    'div[contenteditable="true"][data-testid*="prompt"]',
    'div[contenteditable="true"][data-testid*="message"]',
    'div[role="textbox"][data-testid*="composer"]',
    'div[role="textbox"][data-testid*="prompt"]',
    'div[role="textbox"][data-testid*="message"]',
    'div[contenteditable="true"]',
    'textarea'
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      if (el.matches('[contenteditable="true"]')) {
        return el;
      }
      const nestedEditable = el.querySelector?.('[contenteditable="true"]');
      if (nestedEditable) {
        return nestedEditable;
      }
      if (el.matches('textarea, input')) {
        return el;
      }
      const nestedTextarea = el.querySelector?.('textarea');
      if (nestedTextarea) {
        return nestedTextarea;
      }
    }
  }
  return null;
}

function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isStopButton(button) {
  if (!button) return false;
  const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
  const dataTestId = button.getAttribute('data-testid')?.toLowerCase() || '';
  const text = button.textContent?.trim().toLowerCase() || '';
  if (ariaLabel.includes('stop') || ariaLabel.includes('cancel')) return true;
  if (dataTestId.includes('stop') || dataTestId.includes('cancel')) return true;
  if (text.includes('stop') || text.includes('cancel')) return true;
  return false;
}

function getSendButton(options = {}) {
  const { includeDisabled = false } = options;
  const selectors = [
    'button[data-testid="send-button"]',
    'button[data-testid="send"]',
    'button[data-testid="composer-send-button"]',
    'button[data-testid="prompt-send-button"]',
    'button[data-testid="prompt-submit-button"]',
    'button[data-testid="prompt-submit"]',
    'button[data-testid*="composer"]',
    'button[data-testid*="prompt"]',
    'button[data-testid*="generate"]',
    'button[data-testid*="submit"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="submit" i]',
    'button[aria-label*="Generate" i]',
    'form button[type="submit"]'
  ];
  for (const selector of selectors) {
    const buttons = Array.from(document.querySelectorAll(selector));
    const visibleButton = buttons.find((button) => {
      if (!isVisible(button)) return false;
      if (isStopButton(button)) return false;
      if (!includeDisabled) {
        if (button.disabled) return false;
        if (button.getAttribute('aria-disabled') === 'true') return false;
      }
      return true;
    });
    if (visibleButton) {
      return visibleButton;
    }
  }

  const textMatches = ['send', 'generate', 'create', 'submit'];
  const allButtons = Array.from(document.querySelectorAll('button'));
  for (const button of allButtons) {
    if (!isVisible(button)) continue;
    if (isStopButton(button)) continue;
    if (!includeDisabled) {
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') continue;
    }
    const text = button.textContent?.trim().toLowerCase() || '';
    if (textMatches.some((match) => text.includes(match))) {
      return button;
    }
  }

  return null;
}

async function waitForSendButton(timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const button = getSendButton();
    if (button) {
      return button;
    }
    await sleep(100);
  }
  return null;
}

function dispatchEnter(composer) {
  const eventInit = {
    key: 'Enter',
    code: 'Enter',
    which: 13,
    keyCode: 13,
    bubbles: true,
    cancelable: true
  };
  const events = ['keydown', 'keypress', 'keyup'];
  for (const type of events) {
    const event = new KeyboardEvent(type, eventInit);
    composer.dispatchEvent(event);
  }
}

async function ensureComposer() {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const composer = getComposer();
    if (composer) {
      return composer;
    }
    await sleep(500);
  }
  throw new Error('Could not locate the ChatGPT composer. Make sure the DALL-E conversation is open.');
}

function setComposerValue(composer, prompt) {
  const tag = composer.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    const proto = Object.getPrototypeOf(composer);
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(composer, prompt);
    } else {
      composer.value = prompt;
    }
    try {
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertFromPaste' }));
    } catch (error) {
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  // Support Lexical/ProseMirror-based contenteditable composers.
  composer.focus();
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    try {
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.addRange(range);
    } catch (error) {
      // Ignore if the node cannot be selected (e.g., shadow DOM).
    }
  }
  const clearComposer = () => {
    if (typeof document.execCommand === 'function') {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } else if ('innerHTML' in composer) {
      composer.innerHTML = '';
    } else {
      composer.textContent = '';
    }
    try {
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: '' }));
    } catch (error) {
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  clearComposer();

  const attemptPaste = () => {
    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', prompt);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      if (composer.dispatchEvent(pasteEvent)) {
        const text = composer.textContent || composer.innerText || '';
        return text.trim().length;
      }
    } catch (error) {
      // Ignore browsers without ClipboardEvent/DataTransfer constructors.
    }
    return false;
  };

  const attemptExecCommand = () => {
    if (typeof document.execCommand === 'function') {
      document.execCommand('insertText', false, prompt);
      const text = composer.textContent || composer.innerText || '';
      return text.trim().length;
    }
    return false;
  };

  const attemptDirectWrite = () => {
    composer.textContent = prompt;
    const text = composer.textContent || composer.innerText || '';
    return text.trim().length;
  };

  if (!attemptPaste()) {
    if (!attemptExecCommand()) {
      attemptDirectWrite();
    }
  }

  try {
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: prompt }));
  } catch (error) {
    composer.dispatchEvent(new Event('input', { bubbles: true }));
  }
  composer.dispatchEvent(new Event('change', { bubbles: true }));
}

async function sendPrompt(prompt) {
  const composer = await ensureComposer();
  composer.focus();
  setComposerValue(composer, prompt);
  await sleep(150);
  const sendButton = await waitForSendButton();
  if (sendButton) {
    sendButton.click();
    return;
  }
  dispatchEnter(composer);
  await sleep(300);
  const retryButton = await waitForSendButton();
  if (retryButton) {
    retryButton.click();
    return;
  }
  throw new Error('Send button not found. The ChatGPT UI might have changed.');
}

function isStreaming() {
  const streamingTurn = document.querySelector('[data-testid="conversation-turn"][data-state="streaming"]');
  if (streamingTurn) return true;
  const spinner = document.querySelector('[data-testid="result-streaming"], [data-testid="response-loader"], [data-testid="image-generator-loading"], [data-testid="image-generation-card-spinner"]');
  if (spinner) return true;
  const stopButton = document.querySelector('button[data-testid*="stop" i], button[data-testid*="cancel" i], button[aria-label*="Stop" i], button[aria-label*="Cancel" i]');
  if (stopButton && isVisible(stopButton)) return true;
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const button of buttons) {
    if (!isVisible(button)) continue;
    if (isStopButton(button)) return true;
  }
  const sendButton = getSendButton({ includeDisabled: true });
  if (sendButton && (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true')) return true;
  return false;
}

async function waitForCompletion(timeoutMs = 5 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isStreaming()) {
      await sleep(500);
      if (!isStreaming()) {
        return;
      }
    }
    await sleep(1000);
  }
  throw new Error('Timed out while waiting for DALL-E to finish.');
}

async function processPrompts(prompts) {
  isProcessing = true;
  try {
    await ensureComposer();
    await waitForCompletion();
    for (let index = 0; index < prompts.length; index++) {
      const prompt = prompts[index];
      notify(`(${index + 1}/${prompts.length}) Sending prompt...`);
      await sendPrompt(prompt);
      notify(`(${index + 1}/${prompts.length}) Waiting for completion...`);
      await waitForCompletion();
      notify(`(${index + 1}/${prompts.length}) Done.`);
      await sleep(500);
    }
  } finally {
    isProcessing = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'START_PROMPT_QUEUE') {
    if (isProcessing) {
      sendResponse({ error: 'A prompt queue is already running.' });
      return;
    }
    processPrompts(message.prompts)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        notify(`Error: ${error.message}`);
        sendResponse({ error: error.message });
      });
    return true;
  }
  return undefined;
});
