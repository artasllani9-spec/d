async function request(url, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(fetchOptions.headers || {}) },
    });
    const text = await response.text();
    if (!response.ok) {
      const host = new URL(url).host;
      const error = new Error(`The ${host} request failed (${response.status}).`);
      error.detail = text.slice(0, 180);
      throw error;
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`The request to ${new URL(url).host} timed out.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { request };
