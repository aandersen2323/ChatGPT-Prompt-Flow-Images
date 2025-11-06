# ChatGPT Prompt Flow Images Extension

This repository contains a Chrome extension that queues a list of prompts for DALL-E image generation within ChatGPT. The extension lets you paste multiple prompts separated by a character of your choice and automatically feeds them into an open ChatGPT DALL-E conversation one after another.

## Features

- Paste or type a batch of prompts directly into the popup.
- Choose the separator character (defaults to `|`; leave empty to use new lines).
- Automatically sends each prompt to ChatGPT and waits for the image generation to finish before moving to the next one.
- Displays real-time progress updates in the popup.

## Installation

1. Clone or download this repository.
2. Open **chrome://extensions** in Google Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the root folder of this repository (the one that contains `manifest.json`).

## Usage

1. Open [chat.openai.com](https://chat.openai.com) and start a DALL-E conversation.
2. Open the extension popup.
3. Paste the prompts into the text area and set your preferred separator.
4. With the ChatGPT conversation open (and ideally focused), click **Start Queue**. The extension will locate the active DALL-E tab, send each prompt sequentially, and wait for every image generation to finish before continuing.

> **Note:** The extension interacts with the current ChatGPT interface using DOM selectors. If the ChatGPT UI changes, the extension may need updates to continue functioning correctly.

## Development

- Manifest Version: 3
- Primary files:
  - `manifest.json`
- `extension/popup.html`, `extension/popup.js`, `extension/popup.css`
- `extension/contentScript.js`

Feel free to modify the selectors in `contentScript.js` if ChatGPT updates its interface.
