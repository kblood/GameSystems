// Structured transport failures only; parsing/adoption exceptions are never guessed from text.
const transientHTTP = status => [408, 429, 500, 502, 503, 504].includes(status);
function failure(code, phase, cause, { status = null, retryable = false } = {}) {
  const error = new Error('Bottle asset transport failed', { cause });
  error.name = 'BottleTransportError'; error.code = code;
  error.phase = phase; error.status = status; error.retryable = retryable;
  return error;
}
/** Three FileLoader's HttpError retains its Response; other loader errors stay untouched. */
export function classifyBottleHTTP(error, phase) {
  const status = error?.response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) return error;
  return failure('BOTTLE_HTTP', phase, error, { status, retryable: transientHTTP(status) });
}
function networkFailure(error, url, phase) {
  if (error?.name === 'AbortError') return error;
  // Invalid/unsupported URLs are not retryable transport. A fetch-boundary TypeError
  // for a valid HTTP URL is a network-policy/connection failure, never a parser error.
  let validHTTP = false;
  try { validHTTP = ['http:', 'https:'].includes(new URL(url, globalThis.location?.href).protocol); } catch { /* malformed URL */ }
  return validHTTP && error instanceof TypeError ? failure('BOTTLE_NETWORK', phase, error, { retryable: true }) : error;
}
/** Required explicit JSON sidecar. Separate body transport from JSON parsing. */
export async function fetchBottleJSON(url, phase = 'liquid-sidecar') {
  let response;
  try { response = await fetch(url); } catch (error) { throw networkFailure(error, url, phase); }
  if (!response.ok) {
    const cause = new Error('Bottle sidecar HTTP failure'); cause.response = response;
    throw classifyBottleHTTP(cause, phase);
  }
  let text;
  try { text = await response.text(); } catch (error) { throw networkFailure(error, url, phase); }
  // SyntaxError and later metadata validation retain their ordinary fatal semantics.
  return JSON.parse(text);
}
