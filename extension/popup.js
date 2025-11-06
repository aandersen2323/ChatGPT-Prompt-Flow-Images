const promptList = document.getElementById('prompt-list');
const separatorInput = document.getElementById('separator');
const startButton = document.getElementById('start');
const statusSection = document.getElementById('status');
const saveSequenceButton = document.getElementById('save-sequence');
const sequenceNameInput = document.getElementById('sequence-name');
const sequenceDescriptionInput = document.getElementById('sequence-description');
const sequenceList = document.getElementById('sequence-list');
const sequenceFeedback = document.getElementById('sequence-feedback');
const cancelSequenceEditButton = document.getElementById('cancel-sequence-edit');

const STORAGE_KEY = 'promptSequences';

let logLines = [];
let sequences = [];
let editingSequenceId = null;

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

function normalizePrompts(prompts) {
  return prompts.map((prompt) => prompt.trim()).filter(Boolean);
}

function setSequenceFeedback(message, variant = 'success') {
  sequenceFeedback.textContent = message;
  if (!message) {
    delete sequenceFeedback.dataset.variant;
  } else {
    sequenceFeedback.dataset.variant = variant;
  }
}

function resetSequenceForm() {
  sequenceNameInput.value = '';
  sequenceDescriptionInput.value = '';
  editingSequenceId = null;
  saveSequenceButton.textContent = 'Save Sequence';
  cancelSequenceEditButton.hidden = true;
  setSequenceFeedback('');
}

function loadSequences() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      sequences = [];
      return;
    }
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      sequences = parsed;
    } else {
      sequences = [];
    }
  } catch (error) {
    console.error('Failed to read prompt sequences from storage', error);
    sequences = [];
  }
}

function persistSequences() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sequences));
    return true;
  } catch (error) {
    console.error('Failed to persist prompt sequences', error);
    return false;
  }
}

function createSequenceListItem(sequence) {
  const item = document.createElement('li');
  item.className = 'sequence-list__item';

  const title = document.createElement('div');
  title.className = 'sequence-list__title';

  const heading = document.createElement('h3');
  heading.textContent = sequence.name;
  title.appendChild(heading);

  const meta = document.createElement('div');
  meta.className = 'sequence-list__meta';
  const promptCount = document.createElement('span');
  promptCount.textContent = `${sequence.prompts.length} prompt${sequence.prompts.length === 1 ? '' : 's'}`;
  meta.appendChild(promptCount);

  if (sequence.updatedAt) {
    const updated = document.createElement('span');
    const date = new Date(sequence.updatedAt);
    updated.textContent = `Updated ${date.toLocaleString()}`;
    meta.appendChild(updated);
  }

  item.appendChild(title);
  item.appendChild(meta);

  if (sequence.description) {
    const description = document.createElement('p');
    description.textContent = sequence.description;
    description.className = 'sequence-list__description';
    item.appendChild(description);
  }

  const actions = document.createElement('div');
  actions.className = 'sequence-list__actions';

  const useButton = document.createElement('button');
  useButton.type = 'button';
  useButton.className = 'secondary';
  useButton.textContent = 'Load prompts';
  useButton.addEventListener('click', () => {
    promptList.value = sequence.prompts.join('\n');
    separatorInput.value = '';
    setSequenceFeedback(`Loaded ${sequence.prompts.length} prompt(s) from “${sequence.name}”.`);
  });

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'secondary';
  editButton.textContent = 'Edit';
  editButton.addEventListener('click', () => {
    editingSequenceId = sequence.id;
    sequenceNameInput.value = sequence.name;
    sequenceDescriptionInput.value = sequence.description ?? '';
    promptList.value = sequence.prompts.join('\n');
    separatorInput.value = '';
    saveSequenceButton.textContent = 'Update Sequence';
    cancelSequenceEditButton.hidden = false;
    setSequenceFeedback(`Editing “${sequence.name}”. Update the prompts above and save.`);
  });

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'secondary';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', () => {
    const confirmed = window.confirm(`Delete the sequence “${sequence.name}”? This cannot be undone.`);
    if (!confirmed) return;
    sequences = sequences.filter((item) => item.id !== sequence.id);
    if (!persistSequences()) {
      loadSequences();
      renderSequences();
      setSequenceFeedback('Could not delete the sequence due to a storage error.', 'error');
      return;
    }
    renderSequences();
    if (editingSequenceId === sequence.id) {
      resetSequenceForm();
    }
    setSequenceFeedback('Sequence deleted.');
  });

  actions.append(useButton, editButton, deleteButton);

  item.appendChild(actions);

  return item;
}

function renderSequences() {
  sequenceList.innerHTML = '';
  if (!sequences.length) {
    const empty = document.createElement('li');
    empty.className = 'sequence-list__item sequence-list__item--empty';
    empty.textContent = 'Saved sequences will appear here. Create one to get started.';
    sequenceList.appendChild(empty);
    return;
  }

  const sorted = [...sequences].sort((a, b) => {
    const left = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const right = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return left - right;
  });

  for (const sequence of sorted) {
    sequenceList.appendChild(createSequenceListItem(sequence));
  }
}

function handleSaveSequence() {
  const name = sequenceNameInput.value.trim();
  const description = sequenceDescriptionInput.value.trim();
  const prompts = normalizePrompts(parsePrompts(promptList.value, separatorInput.value));

  if (!name) {
    setSequenceFeedback('Please provide a sequence name before saving.', 'error');
    sequenceNameInput.focus();
    return;
  }

  if (prompts.length === 0) {
    setSequenceFeedback('Add at least one prompt to save the sequence.', 'error');
    promptList.focus();
    return;
  }

  const now = new Date().toISOString();

  let successMessage;

  if (editingSequenceId) {
    sequences = sequences.map((sequence) => {
      if (sequence.id !== editingSequenceId) return sequence;
      return {
        ...sequence,
        name,
        description: description || undefined,
        prompts,
        updatedAt: now,
      };
    });
    successMessage = `Updated “${name}”.`;
  } else {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    sequences.unshift({
      id,
      name,
      description: description || undefined,
      prompts,
      createdAt: now,
      updatedAt: now,
    });
    successMessage = `Saved “${name}”. You can load it anytime.`;
  }

  if (!persistSequences()) {
    loadSequences();
    renderSequences();
    setSequenceFeedback('Unable to save the sequence. Check storage permissions.', 'error');
    return;
  }
  renderSequences();
  resetSequenceForm();
  if (successMessage) {
    setSequenceFeedback(successMessage);
  }
}

function handleCancelEdit() {
  resetSequenceForm();
  setSequenceFeedback('Edit cancelled.');
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
saveSequenceButton.addEventListener('click', handleSaveSequence);
cancelSequenceEditButton.addEventListener('click', handleCancelEdit);

loadSequences();
renderSequences();

chrome.storage?.local?.get?.(STORAGE_KEY, (result) => {
  const stored = result?.[STORAGE_KEY];
  if (!stored) {
    return;
  }
  try {
    const parsed = Array.isArray(stored) ? stored : JSON.parse(stored);
    if (Array.isArray(parsed)) {
      sequences = parsed;
      persistSequences();
      renderSequences();
    }
  } catch (error) {
    console.error('Failed to migrate sequences from chrome.storage', error);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'PROMPT_PROGRESS') {
    appendStatus(message.text);
  }
});
