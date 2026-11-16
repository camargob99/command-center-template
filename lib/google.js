// Google Calendar + Gmail over plain HTTPS (no SDK). OAuth "desktop app" flow on localhost.

const SCOPES = [
  'https://www.googleapis.com/auth/calendar', // read events, free/busy, create/move your blocks
  'https://www.googleapis.com/auth/gmail.readonly', // starred emails: list and read
  'https://www.googleapis.com/auth/gmail.modify', // Dismiss = unstar (never sends or deletes)
];

function b64decode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

class Google {
  // Token lives in tokenFile on the PC, or in { token, onToken(token|null) } in the cloud.
  constructor({ clientId, clientSecret, tokenFile, redirectUri, token, onToken, extraScopes = [] }) {
    this.clientId = clientId; this.clientSecret = clientSecret;
    this.tokenFile = tokenFile; this.redirectUri = redirectUri; this.onToken = onToken; this.extraScopes = extraScopes;
    if (tokenFile) { const fs = require('fs'); this.token = fs.existsSync(tokenFile) ? JSON.parse(fs.readFileSync(tokenFile, 'utf8')) : null; }
    else this.token = token || null;
  }

  writeToken() {
    if (this.onToken) return this.onToken(this.token);
    const fs = require('fs');
    if (this.token) fs.writeFileSync(this.tokenFile, JSON.stringify(this.token, null, 2));
    else try { fs.unlinkSync(this.tokenFile); } catch {}
  }

  get configured() { return Boolean(this.clientId && this.clientSecret); }
  get connected() { return Boolean(this.token && this.token.refresh_token); }
  // Dismiss can unstar only once the owner has approved the gmail.modify permission (one reconnect).
  get canUnstar() { return Boolean(this.token && /gmail\.modify/.test(this.token.scope || '')); }

  authUrl(opts = {}) {
    const p = new URLSearchParams({
      client_id: this.clientId, redirect_uri: this.redirectUri, response_type: 'code',
      scope: [...SCOPES, ...this.extraScopes].join(' '), access_type: 'offline', prompt: opts.prompt || 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  async exchange(code) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: this.redirectUri, grant_type: 'authorization_code' }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Google sign-in failed: ${j.error_description || j.error}`);
    this.saveToken({ ...j, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
    return j;
  }

  saveToken(t) {
    const { id_token: _drop, ...rest } = t;
    this.token = { ...(this.token || {}), ...rest };
    this.writeToken();
  }

  async accessToken() {
    if (!this.connected) throw Object.assign(new Error('Google not connected'), { code: 'NO_GOOGLE' });
    if (this.token.access_token && this.token.expires_at > Date.now()) return this.token.access_token;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: this.token.refresh_token, client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'refresh_token' }),
    });
    const j = await r.json();
    if (!r.ok) {
      if (j.error === 'invalid_grant') { this.token = null; this.writeToken(); }
      throw Object.assign(new Error(`Google token refresh failed: ${j.error}`), { code: 'NO_GOOGLE' });
    }
    this.saveToken({ access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
    return j.access_token;
  }

  async api(url, opts = {}) {
    const tok = await this.accessToken();
    const r = await fetch(url, { ...opts, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...(opts.headers || {}) } });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Google API ${r.status}: ${(j.error && j.error.message) || r.statusText}`);
    return j;
  }

  async calendars() {
    const j = await this.api('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250');
    return (j.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: Boolean(c.primary), color: c.backgroundColor, selected: c.selected !== false, accessRole: c.accessRole }));
  }

  async events(calendarId, timeMin, timeMax) {
    const items = []; let pageToken;
    do {
      const p = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      if (pageToken) p.set('pageToken', pageToken);
      const j = await this.api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${p}`);
      items.push(...(j.items || []));
      pageToken = j.nextPageToken;
    } while (pageToken);
    return items;
  }

  async freeBusy(calendarIds, timeMin, timeMax) {
    const j = await this.api('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST', body: JSON.stringify({ timeMin, timeMax, items: calendarIds.map((id) => ({ id })) }),
    });
    return Object.values(j.calendars || {}).flatMap((c) => c.busy || []);
  }

  insertEvent(calendarId, body) {
    return this.api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) });
  }

  patchEvent(calendarId, eventId, body) {
    return this.api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  deleteEvent(calendarId, eventId) {
    return this.api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  }

  // Starred emails from the last `days` days that still need a reply: a thread whose newest message
  // was sent by you counts as answered and is left out. Sender, subject, date and Gmail's one-line preview;
  // the full text is read only when you open one.
  async starred({ days = 15, max = 25 } = {}) {
    const q = `is:starred newer_than:${days}d`;
    const list = await this.api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
    const out = []; const seen = new Set();
    for (const { id, threadId } of list.messages || []) {
      if (seen.has(threadId)) continue; seen.add(threadId);
      const t = await this.api(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const msgs = t.messages || [];
      const last = msgs[msgs.length - 1];
      if (last && (last.labelIds || []).includes('SENT')) continue; // you already replied
      const m = msgs.find((x) => x.id === id) || last;
      const h = Object.fromEntries((m.payload.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      out.push({ id, threadId, from: (h.from || '').replace(/<.*>/, '').replace(/"/g, '').trim(), subject: h.subject || '(no subject)', date: new Date(Number(m.internalDate)).toISOString(), snippet: decodeEntities(m.snippet || '') });
    }
    return out;
  }

  // One email's plain text (falls back to the HTML part with tags stripped).
  async message(id) {
    const m = await this.api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
    const parts = []; const walk = (p) => { if (!p) return; parts.push(p); (p.parts || []).forEach(walk); };
    walk(m.payload);
    const pick = (type) => parts.find((p) => p.mimeType === type && p.body && p.body.data);
    let text = '';
    const plain = pick('text/plain'), html = pick('text/html');
    if (plain) text = b64decode(plain.body.data);
    else if (html) text = decodeEntities(b64decode(html.body.data).replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ''));
    text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    // drop the quoted reply chain
    const cut = text.search(/\n(On .{5,120} wrote:|-{2,} ?Original Message|From: .+\nSent: )/);
    if (cut > 200) text = text.slice(0, cut).trim();
    return { id, threadId: m.threadId, text: text.slice(0, 8000) };
  }

  unstar(id) {
    return this.api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['STARRED'] }) });
  }
}

module.exports = { Google, SCOPES };
