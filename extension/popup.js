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

    if (!tab || !tab.id || !/^https:\/\/chat\.openai\.com\//.test(tab.url || '')) {
      throw new Error('Please focus the ChatGPT tab before starting the queue.');
    }

    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'START_PROMPT_QUEUE',
          prompts,
        },
        (resp) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(resp);
        }
      );
    });
    if (response && response.ok) {
      appendStatus('Queue complete.');
    } else if (response && response.error) {
      appendStatus(`Error: ${response.error}`);
    } else {
      appendStatus('Queue finished with unknown status.');
    }
  } catch (error) {
    appendStatus(`Failed: ${error.message}`);
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
