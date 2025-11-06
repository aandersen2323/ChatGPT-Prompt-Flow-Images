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
    'textarea[data-id="root"]',
    'div[data-id="root"] textarea',
    'div[contenteditable="true"][data-id="root"]',
    'div[data-lexical-editor="true"][contenteditable="true"]',
    'textarea[placeholder*="Message"]',
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
      return el;
    }
  }
  return null;
}

function getSendButton() {
  const selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'form button[type="submit"]'
  ];
  for (const selector of selectors) {
    const btn = document.querySelector(selector);
    if (btn) {
      return btn;
    }
  }
  return null;
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
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Support Lexical/ProseMirror-based contenteditable composers.
  composer.focus();
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }
  composer.innerHTML = '';
  if (typeof document.execCommand === 'function') {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', prompt);
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  try {
    composer.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: '' }));
  } catch (error) {
    composer.dispatchEvent(new Event('beforeinput', { bubbles: true }));
  }
  composer.dispatchEvent(new Event('input', { bubbles: true }));
  composer.textContent = prompt;
  try {
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  } catch (error) {
    composer.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

async function sendPrompt(prompt) {
  const composer = await ensureComposer();
  composer.focus();
  setComposerValue(composer, prompt);
  await sleep(150);
  const sendButton = getSendButton();
  if (!sendButton) {
    throw new Error('Send button not found. The ChatGPT UI might have changed.');
  }
  sendButton.click();
}

function isStreaming() {
  const streamingTurn = document.querySelector('[data-testid="conversation-turn"][data-state="streaming"]');
  if (streamingTurn) return true;
  const spinner = document.querySelector('[data-testid="result-streaming"], [data-testid="response-loader"]');
  if (spinner) return true;
  const sendButton = getSendButton();
  if (sendButton && sendButton.disabled) return true;
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
