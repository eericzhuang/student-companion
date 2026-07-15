/**
 * Isolated-world side of the network interception pipeline.
 * Receives payloads posted by src/page/interceptor.ts (MAIN world), verifies
 * origin/shape, and hands parsed JSON to registered consumers.
 */

const SOURCE_TAG = 'wd-companion-intercept';

export interface InterceptedPayload {
  url: string;
  json: unknown;
}

type Consumer = (payload: InterceptedPayload) => void;

const consumers = new Set<Consumer>();

export function onIntercepted(fn: Consumer): () => void {
  consumers.add(fn);
  return () => consumers.delete(fn);
}

export function startBridge(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window) return;
    const data = event.data as { source?: string; url?: string; body?: string } | null;
    if (!data || data.source !== SOURCE_TAG) return;
    if (typeof data.url !== 'string' || typeof data.body !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(data.body);
    } catch {
      return;
    }
    for (const consumer of consumers) {
      try {
        consumer({ url: data.url, json });
      } catch (err) {
        console.debug('[wd-companion] intercept consumer failed', err);
      }
    }
  });
}
