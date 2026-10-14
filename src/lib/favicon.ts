/**
 * Resolve a website URL to its conventional root favicon location or service.
 */
export function getFaviconUrl(value: string): string | null {
  try {
    const url = new URL(value);
    // Use Google Favicon Service or standard /favicon.ico
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
  } catch {
    return null;
  }
}
