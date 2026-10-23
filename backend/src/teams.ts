import { isTeamsUrl } from './checklist.js';

/**
 * Posts a message card to a Teams "workflow" webhook. The URL is a secret (anyone holding it can post to that chat), so it is
 * only ever used here, only sent to Microsoft hosts (isTeamsUrl) and never put into an error message or a log line.
 */
export async function sendTeams(url: string, card: object, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!isTeamsUrl(url)) throw new Error('Teams is not set up.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    // redirect: 'error' so the secret URL can never be bounced to another host
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card), signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) throw new Error(`Teams answered ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}
