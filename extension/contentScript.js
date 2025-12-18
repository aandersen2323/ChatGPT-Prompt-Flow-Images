(function() {
  // Prevent the script from running multiple times if injected repeatedly.
  if (window.__promptFlowContentScriptInjected) {
    return;
  }
  window.__promptFlowContentScriptInjected = true;

  let isProcessing = false;

  // Single declaration of the site check
  const isGeminiSite = window.location.hostname.includes('gemini.google.com');

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function notify(text) {
    try {
      chrome.runtime.sendMessage({ type: 'PROMPT_PROGRESS', text }, () => {
        // Ignore disconnect errors when the popup is closed mid-queue.
        void chrome.runtime.lastError;
      });
    } catch (error) {
      // Silently swallow errors
    }
  }

  function getComposer() {
    const selectors = [
      // Gemini-specific editors.
      'div[role="textbox"][aria-label*="Gemini" i]',
      'div[role="textbox"][aria-label*="prompt" i]',
      'textarea[aria-label*="Gemini" i]',
      'textarea[aria-label*="prompt" i]',
      // Generic / ChatGPT editors
      'div[data-testid*="composer"] div[contenteditable="true"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'textarea[data-testid="prompt-textarea"]',
      'textarea[data-testid="textbox"]',
      'div[contenteditable="true"]',
      'textarea'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        if (el.matches('[contenteditable="true"]')) return el;
        const nestedEditable = el.querySelector?.('[contenteditable="true"]');
        if (nestedEditable) return nestedEditable;
        if (el.matches('textarea, input')) return el;
        const nestedTextarea = el.querySelector?.('textarea');
        if (nestedTextarea) return nestedTextarea;
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
    
    // Check standard Stop/Cancel keywords
    if (ariaLabel.includes('stop') || ariaLabel.includes('cancel')) return true;
    if (dataTestId.includes('stop') || dataTestId.includes('cancel')) return true;
    if (text.includes('stop') || text.includes('cancel')) return true;
    
    return false;
  }

  function getSendButton(options = {}) {
    const { includeDisabled = false } = options;
    const selectors = [
      // Gemini send buttons
      'button[aria-label*="send message" i]',
      'button[aria-label*="send to gemini" i]',
      'button[aria-label*="submit to gemini" i]',
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="submit" i]',
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
      if (visibleButton) return visibleButton;
    }
    return null;
  }

  async function waitForSendButton(timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const button = getSendButton();
      if (button) return button;
      await sleep(100);
    }
    return null;
  }

  function dispatchEnter(composer) {
    const eventInit = {
      key: 'Enter', code: 'Enter', which: 13, keyCode: 13,
      bubbles: true, cancelable: true
    };
    composer.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    composer.dispatchEvent(new KeyboardEvent('keypress', eventInit));
    composer.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }

  async function ensureComposer() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const composer = getComposer();
      if (composer) return composer;
      await sleep(500);
    }
    throw new Error('Could not locate the input box. Please reload the page.');
  }

  function setComposerValue(composer, prompt) {
    const tag = composer.tagName;
    
    // 1. TEXTAREA / INPUT
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      composer.value = prompt;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // 2. CONTENTEDITABLE (Rich Text)
    composer.focus();
    
    // Clear existing
    if (typeof document.execCommand === 'function') {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } else {
      composer.textContent = '';
    }

    // Insert new text
    if (!document.execCommand('insertText', false, prompt)) {
      composer.textContent = prompt;
    }
    
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  }

  async function sendPrompt(prompt) {
    const composer = await ensureComposer();
    composer.focus();
    setComposerValue(composer, prompt);
    await sleep(200); // Wait for UI to update

    // Try clicking send
    const sendButton = await waitForSendButton();
    if (sendButton) {
      sendButton.click();
      return;
    }

    // Fallback to Enter key
    dispatchEnter(composer);
    
    // Wait briefly to see if it worked
    await sleep(500);
  }

  function isStreaming() {
    // 1. Check for specific "Streaming" states in ChatGPT
    const streamingTurn = document.querySelector('[data-testid="conversation-turn"][data-state="streaming"]');
    if (streamingTurn) return true;

    // 2. Check for explicit "Stop" buttons (Gemini & ChatGPT)
    // Note: We check if they are VISIBLE.
    const stopButtonSelectors = [
      'button[aria-label*="stop response" i]',
      'button[aria-label*="stop generating" i]',
      'button[data-testid*="stop" i]'
    ];
    
    for (const sel of stopButtonSelectors) {
      const btn = document.querySelector(sel);
      if (btn && isVisible(btn)) return true;
    }

    // 3. Check if Send button is VISIBLE but DISABLED (common in Gemini while generating)
    const sendButton = getSendButton({ includeDisabled: true });
    if (sendButton && isVisible(sendButton)) {
      if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
        return true;
      }
    }

    // REMOVED: Broad checks for [role="progressbar"] or [aria-busy="true"] 
    // because they cause false positives on Gemini.

    return false;
  }

  async function waitForCompletion(timeoutMs = 300000) { // 5 min timeout
    const start = Date.now();
    // Initial wait to allow UI to switch to "generating" state
    await sleep(1000); 

    while (Date.now() - start < timeoutMs) {
      if (!isStreaming()) {
        // Double check: wait a bit and check again to ensure it didn't just briefly pause
        await sleep(1000);
        if (!isStreaming()) {
          return;
        }
      }
      await sleep(1000);
    }
    throw new Error('Timed out waiting for generation to finish.');
  }

  async function processPrompts(prompts) {
    isProcessing = true;
    try {
      await ensureComposer();
      
      // If we are already generating something, wait for it to finish first
      if (isStreaming()) {
        notify('Waiting for current generation to finish...');
        await waitForCompletion();
      }

      for (let index = 0; index < prompts.length; index++) {
        const prompt = prompts[index];
        notify(`(${index + 1}/${prompts.length}) Sending prompt...`);
        
        await sendPrompt(prompt);
        
        notify(`(${index + 1}/${prompts.length}) Waiting for response...`);
        await waitForCompletion();
        
        notify(`(${index + 1}/${prompts.length}) Done.`);
        await sleep(1000); // Cool down between prompts
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

})();
