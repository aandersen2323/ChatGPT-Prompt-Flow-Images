import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_COOLDOWN_PATTERNS,
  ImageCooldownError,
  extractAssistantContent,
  isImageCooldownError,
  isImageCooldownMessage,
  isImageCooldownResponse,
  withImageCooldownRetry,
} from '../utils/imageCooldown';

describe('image cooldown utilities', () => {
  it('detects cooldown phrases in plain text', () => {
    expect(isImageCooldownMessage("You've hit the image-generation limit."))
      .toBe(true);
    expect(isImageCooldownMessage('All good here.')).toBe(false);
  });

  it('supports custom cooldown patterns', () => {
    const customPattern = [/custom cooldown triggered/i];
    expect(isImageCooldownMessage('Custom cooldown triggered!', customPattern)).toBe(true);
    expect(isImageCooldownMessage('Custom cooldown triggered!', DEFAULT_COOLDOWN_PATTERNS)).toBe(false);
  });

  it('extracts assistant content from OpenAI chat payloads', () => {
    const payload = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Response payload',
          },
        },
      ],
    };

    expect(extractAssistantContent(payload)).toBe('Response payload');
  });

  it('detects cooldown responses inside OpenAI payloads', () => {
    const response = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: "You've hit the image-generation limit",
          },
        },
      ],
    };

    expect(isImageCooldownResponse(response)).toBe(true);
  });

  it('detects cooldown errors', () => {
    expect(isImageCooldownError(new Error("You've hit the image-generation limit"))).toBe(true);
    expect(isImageCooldownError(new Error('Other error'))).toBe(false);
  });
});

describe('withImageCooldownRetry', () => {
  it('retries after detecting a cooldown response', async () => {
    const responses = [
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: "You've hit the image-generation limit",
            },
          },
        ],
      },
      { data: 'image-data' },
    ];

    const requestFn = vi.fn<[number], Promise<unknown>>().mockImplementation(async () => responses.shift());
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const waitStrategy = vi.fn(async () => {});

    const promise = withImageCooldownRetry((attempt) => requestFn(attempt), {
      baseDelayMs: 60_000,
      jitterMsRange: [0, 0],
      logger,
      waitStrategy,
    });

    const result = await promise;

    expect(requestFn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Image cooldown detected from response on attempt 1. Waiting 60.0s before retrying.',
    );
    expect(waitStrategy).toHaveBeenCalledWith(60_000);
    expect(result).toEqual({ data: 'image-data' });
  });

  it('retries after detecting a cooldown error', async () => {
    const error = new Error("You've hit the image-generation limit");
    const requestFn = vi
      .fn<[number], Promise<unknown>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ data: 'image-data' });

    const waitStrategy = vi.fn(async () => {});

    const promise = withImageCooldownRetry((attempt) => requestFn(attempt), {
      baseDelayMs: 10_000,
      jitterMsRange: [0, 0],
      waitStrategy,
    });
    const result = await promise;

    expect(requestFn).toHaveBeenCalledTimes(2);
    expect(waitStrategy).toHaveBeenCalledWith(10_000);
    expect(result).toEqual({ data: 'image-data' });
  });

  it('invokes fallback when cooldown persists', async () => {
    const requestFn = vi.fn<[number], Promise<unknown>>().mockResolvedValue({
      choices: [
        {
          message: {
            content: "You've hit the image-generation limit",
          },
        },
      ],
    });

    const fallback = vi.fn().mockResolvedValue({ data: 'fallback-image' });
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const waitStrategy = vi.fn(async () => {});

    const result = await withImageCooldownRetry((attempt) => requestFn(attempt), {
      maxAttempts: 2,
      baseDelayMs: 0,
      jitterMsRange: [0, 0],
      fallback,
      logger,
      waitStrategy,
    });

    expect(requestFn).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenLastCalledWith(
      'Image cooldown persisted after maximum attempts. Executing fallback handler.',
    );
    expect(waitStrategy).toHaveBeenCalledWith(0);
    expect(result).toEqual({ data: 'fallback-image' });
  });

  it('throws ImageCooldownError when attempts exhausted without fallback', async () => {
    const requestFn = vi.fn<[number], Promise<unknown>>().mockResolvedValue({
      choices: [
        {
          message: {
            content: "You've hit the image-generation limit",
          },
        },
      ],
    });

    await expect(
      withImageCooldownRetry((attempt) => requestFn(attempt), {
        maxAttempts: 2,
        baseDelayMs: 0,
        jitterMsRange: [0, 0],
        waitStrategy: async () => {},
      }),
    ).rejects.toBeInstanceOf(ImageCooldownError);
  });
});
