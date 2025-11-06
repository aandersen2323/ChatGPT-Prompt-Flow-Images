/**
 * Utilities for handling ChatGPT image-generation cooldown responses.
 *
 * The helper functions below detect when the OpenAI Images endpoint responds
 * with the well-known "You've hit the image-generation limit" style message
 * and automatically waits before retrying. Optional jitter and fallback logic
 * allow callers to avoid stampeding the API when limits reset.
 */

export const DEFAULT_COOLDOWN_PATTERNS: RegExp[] = [
  /you['’`]?ve hit the image-generation limit/i,
  /image generation limit reached/i,
  /you['’`]?ve hit the.*limit/i,
  /please wait .* before (?:submitting|sending).*image/i,
  /too many image generation requests/i,
  /image generation requests are temporarily blocked/i,
  /cooldown period/i,
];

export interface ImageCooldownRetryOptions<T> {
  /**
   * Base delay (in milliseconds) to wait before retrying once a cooldown is detected.
   * Defaults to 60 seconds.
   */
  baseDelayMs?: number;
  /**
   * Optional jitter window (in milliseconds) added on top of the base delay to avoid
   * hammering the API when the cooldown resets for everyone at the same time.
   * Defaults to a range between 5s–10s. Use [0, 0] to disable jitter.
   */
  jitterMsRange?: [number, number];
  /**
   * Maximum number of retry attempts before giving up. Defaults to 3.
   */
  maxAttempts?: number;
  /**
   * Optional logger (console by default).
   */
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  /**
   * Invoked whenever a cooldown is detected, after the wait time has been calculated
   * but before the delay starts.
   */
  onCooldown?: (event: ImageCooldownEvent) => void;
  /**
   * Custom detector that returns true when the provided response indicates a cooldown.
   * Defaults to `isImageCooldownResponse`.
   */
  detector?: (response: unknown) => boolean;
  /**
   * Custom detector for thrown errors. Defaults to `isImageCooldownError`.
   */
  errorDetector?: (error: unknown) => boolean;
  /**
   * Optional fallback invoked when the cooldown persists for the full retry budget.
   * This can return cached data or a placeholder image so the caller can gracefully degrade.
   */
  fallback?: () => Promise<T> | T;
  /**
   * Custom wait strategy used when delaying between retries. Primarily useful for tests.
   */
  waitStrategy?: (durationMs: number) => Promise<void> | void;
}

export interface ImageCooldownEvent {
  attempt: number;
  waitMs: number;
  source: 'response' | 'error';
  payload: unknown;
}

/**
 * Error thrown when the helper exhausted all retries while the API stayed in cooldown.
 */
export class ImageCooldownError extends Error {
  public readonly source?: 'response' | 'error';
  public readonly payload?: unknown;

  constructor(message: string, options?: { source?: 'response' | 'error'; payload?: unknown }) {
    super(message);
    this.name = 'ImageCooldownError';
    this.source = options?.source;
    this.payload = options?.payload;
  }
}

/**
 * Returns true when the provided text matches a known image cooldown phrase.
 */
export function isImageCooldownMessage(
  text: string | null | undefined,
  patterns: RegExp[] = DEFAULT_COOLDOWN_PATTERNS,
): boolean {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Attempts to extract the assistant text from an OpenAI-style response payload.
 */
export function extractAssistantContent(payload: unknown): string | undefined {
  if (typeof payload === 'string') {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const maybeAny = payload as Record<string, unknown>;

    if (Array.isArray(maybeAny.choices)) {
      for (const choice of maybeAny.choices) {
        if (!choice || typeof choice !== 'object') continue;
        const choiceAny = choice as Record<string, unknown>;

        const message = choiceAny.message as Record<string, unknown> | undefined;
        if (message) {
          if (typeof message.content === 'string') return message.content;
          if (typeof message.text === 'string') return message.text;
        }

        if (typeof choiceAny.text === 'string') {
          return choiceAny.text;
        }
      }
    }

    if (typeof maybeAny.message === 'string') {
      return maybeAny.message;
    }

    if (maybeAny.error && typeof maybeAny.error === 'object') {
      const errorRecord = maybeAny.error as Record<string, unknown>;
      if (typeof errorRecord.message === 'string') {
        return errorRecord.message;
      }
    }

    if (typeof maybeAny.error === 'string') {
      return maybeAny.error;
    }
  }

  return undefined;
}

/**
 * Detects a cooldown signal inside an OpenAI response object.
 */
export function isImageCooldownResponse(response: unknown): boolean {
  const content = extractAssistantContent(response);
  return isImageCooldownMessage(content);
}

/**
 * Detects a cooldown signal inside a thrown error.
 */
export function isImageCooldownError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    return isImageCooldownMessage(error);
  }

  if (error && typeof error === 'object') {
    const errorAny = error as Record<string, unknown>;
    const directMessage = typeof errorAny.message === 'string' ? errorAny.message : undefined;
    if (directMessage && isImageCooldownMessage(directMessage)) {
      return true;
    }

    const response = errorAny.response as Record<string, unknown> | undefined;
    if (response) {
      const data = response.data as unknown;
      if (isImageCooldownResponse(data)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Wraps an image-generation call with retry logic that respects cooldown responses.
 */
export async function withImageCooldownRetry<T>(
  requestFn: (attempt: number) => Promise<T>,
  options: ImageCooldownRetryOptions<T> = {},
): Promise<T> {
  const {
    baseDelayMs = 60_000,
    jitterMsRange = [5_000, 10_000],
    maxAttempts = 3,
    logger = console,
    onCooldown,
    detector = isImageCooldownResponse,
    errorDetector = isImageCooldownError,
    fallback,
    waitStrategy,
  } = options;

  const [minJitter, maxJitter] = normalizeJitterRange(jitterMsRange);
  const waitFor = waitStrategy ?? wait;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await requestFn(attempt);

      if (detector(result)) {
        if (attempt >= maxAttempts) {
          if (fallback) {
            logger?.warn?.(
              'Image cooldown persisted after maximum attempts. Executing fallback handler.',
            );
            return await fallback();
          }

          throw new ImageCooldownError('Image generation cooldown detected.', {
            source: 'response',
            payload: result,
          });
        }

        const waitMs = computeWaitTime(baseDelayMs, minJitter, maxJitter);
        logCooldown(logger, attempt, waitMs, 'response');
        onCooldown?.({ attempt, waitMs, source: 'response', payload: result });
        await waitFor(waitMs);
        continue;
      }

      return result;
    } catch (error) {
      if (!errorDetector(error)) {
        throw error;
      }

      if (fallback && attempt >= maxAttempts) {
        logger?.warn?.(
          'Image cooldown error persisted after maximum attempts. Executing fallback handler.',
        );
        return await fallback();
      }

      if (attempt >= maxAttempts) {
        throw new ImageCooldownError('Image generation cooldown detected.', {
          source: 'error',
          payload: error,
        });
      }

      const waitMs = computeWaitTime(baseDelayMs, minJitter, maxJitter);
      logCooldown(logger, attempt, waitMs, 'error');
      onCooldown?.({ attempt, waitMs, source: 'error', payload: error });
      await waitFor(waitMs);
    }
  }

  // In practice the loop either returns or throws.
  throw new ImageCooldownError('Image generation failed after cooldown handling.');
}

function computeWaitTime(baseDelayMs: number, minJitterMs: number, maxJitterMs: number): number {
  const jitterRange = Math.max(0, maxJitterMs - minJitterMs);
  const jitter = jitterRange > 0 ? Math.random() * jitterRange + minJitterMs : minJitterMs;
  return baseDelayMs + jitter;
}

function normalizeJitterRange(range: [number, number]): [number, number] {
  const [min, max] = range;
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return [0, 0];
  }
  if (max < min) {
    return [max, min];
  }
  return [Math.max(0, min), Math.max(0, max)];
}

function wait(durationMs: number): Promise<void> {
  if (durationMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function logCooldown(
  logger: Pick<Console, 'info' | 'warn' | 'error'> | undefined,
  attempt: number,
  waitMs: number,
  source: 'response' | 'error',
) {
  const seconds = (waitMs / 1000).toFixed(1);
  logger?.warn?.(
    `Image cooldown detected from ${source} on attempt ${attempt}. Waiting ${seconds}s before retrying.`,
  );
}
