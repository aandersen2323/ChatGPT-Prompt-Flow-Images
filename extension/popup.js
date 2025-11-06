const promptList = document.getElementById('prompt-list');
const separatorInput = document.getElementById('separator');
const startButton = document.getElementById('start');
const statusSection = document.getElementById('status');

let logLines = [];

function appendStatus(line) {
  logLines.push(line);
  statusSection.textContent = logLines.join('\n');
}

function resetStatus() {
  logLines = [];
  statusSection.textContent = '';
}

function parsePrompts(rawText, separator) {
  let prompts;
  if (separator) {
    prompts = rawText.split(separator);
  } else {
    prompts = rawText.split(/\r?\n/);
  }
  return prompts.map(p => p.trim()).filter(Boolean);
}

async function sendMessageToTab(tabId, message) {
  const send = () => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(resp);
    });
  });

  try {
    return await send();
  } catch (error) {
    if (!/Receiving end does not exist/i.test(error.message)) {
      throw error;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['contentScript.js'],
      });
    } catch (injectError) {
      const message = injectError?.message || 'Unknown error while injecting content script.';
      throw new Error(`Could not inject the helper script. ${message}`);
    }

    return await send();
  }
}

async function getActiveChatGptTab() {
  const tab = await new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(tabs?.[0]);
    });
  });

  const url = tab?.url || '';
  const isChatGpt = /^(https:\/\/chat\.openai\.com\/|https:\/\/chatgpt\.com\/)/.test(url);

  if (!tab || !tab.id || !isChatGpt) {
    throw new Error('Please focus the ChatGPT tab before starting the queue.');
  }

  return tab;
}

async function startQueue() {
  resetStatus();
  const raw = promptList.value.trim();
  const separator = separatorInput.value;
  const prompts = parsePrompts(raw, separator);

  if (!prompts.length) {
    appendStatus('Please provide at least one prompt.');
    return;
  }

  try {
    startButton.disabled = true;
    appendStatus(`Starting queue with ${prompts.length} prompt(s)...`);

    const tab = await getActiveChatGptTab();

    const response = await sendMessageToTab(tab.id, {
      type: 'START_PROMPT_QUEUE',
      prompts,
    });
    if (response && response.ok) {
      appendStatus('Queue complete.');
    } else if (response && response.error) {
      appendStatus(`Error: ${response.error}`);
    } else {
      appendStatus('Queue finished with unknown status.');
    }
  } catch (error) {
    let message = error?.message || 'Unknown error.';
    if (/Receiving end does not exist/i.test(message)) {
      message = 'Could not connect to the ChatGPT tab. Please reload the page and try again.';
    }
    appendStatus(`Failed: ${message}`);
  } finally {
    startButton.disabled = false;
  }
}

startButton.addEventListener('click', startQueue);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'PROMPT_PROGRESS') {
    appendStatus(message.text);
  }
});
