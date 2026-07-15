/**
 * MAIN-world content script, injected at document_start on *.myworkday.com.
 *
 * Wraps window.fetch and XMLHttpRequest so the JSON payloads Workday's own UI
 * requests are mirrored to the isolated content script via window.postMessage.
 * Read-only: requests are never modified, blocked, or replayed. Only
 * same-origin Workday responses that parse as JSON are forwarded.
 */

const SOURCE_TAG = 'wd-companion-intercept';
const MAX_BODY_BYTES = 4_000_000; // skip giant payloads (file downloads etc.)

/** Endpoints worth forwarding. Workday UI-model endpoints end in .htmld or
 *  flow through flowController/inst URLs; keep the filter broad but bounded. */
function isInterestingUrl(url: string): boolean {
  if (url.includes('validateSession') || url.includes('keepAlive')) return false;
  return (
    url.includes('.htmld') ||
    url.includes('flowController') ||
    url.includes('/inst/') ||
    url.includes('/task/')
  );
}

function forward(url: string, body: string): void {
  if (body.length > MAX_BODY_BYTES) return;
  const trimmed = body.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
  try {
    window.postMessage({ source: SOURCE_TAG, url, body }, window.location.origin);
  } catch {
    // structured clone failure or detached window — ignore
  }
}

// ---- fetch ----
const originalFetch = window.fetch;
window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await originalFetch.call(this, input, init);
  try {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const absolute = new URL(url, window.location.href);
    if (absolute.origin === window.location.origin && isInterestingUrl(absolute.pathname + absolute.search)) {
      response
        .clone()
        .text()
        .then((text) => forward(absolute.href, text))
        .catch(() => {});
    }
  } catch {
    // never break the page over interception
  }
  return response;
};

// ---- XMLHttpRequest ----
const originalOpen = XMLHttpRequest.prototype.open;
const urlMap = new WeakMap<XMLHttpRequest, string>();

XMLHttpRequest.prototype.open = function patchedOpen(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  try {
    const absolute = new URL(typeof url === 'string' ? url : url.href, window.location.href);
    if (absolute.origin === window.location.origin && isInterestingUrl(absolute.pathname + absolute.search)) {
      urlMap.set(this, absolute.href);
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            forward(absolute.href, this.responseText);
          } else if (this.responseType === 'json' && this.response != null) {
            forward(absolute.href, JSON.stringify(this.response));
          }
        } catch {
          // ignore
        }
      });
    }
  } catch {
    // ignore malformed URLs
  }
  // @ts-expect-error passthrough of optional args
  return originalOpen.call(this, method, url, ...rest);
};
