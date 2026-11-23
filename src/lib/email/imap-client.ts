/**
 * Lightweight, robust IMAP client for Node.js using built-in `node:tls`.
 *
 * Connects to IMAP servers (Gmail: imap.gmail.com:993, Outlook, custom)
 * to search and fetch recent emails from INBOX without marking them as read (BODY.PEEK).
 */

import tls from 'node:tls';

export interface FetchedEmail {
  uid?: string;
  seq: number;
  from: string;
  fromEmail: string;
  fromName: string | null;
  to: string;
  subject: string;
  date: Date | null;
  messageId: string | null;
  inReplyTo: string | null;
  snippet: string;
  rawHeaders: Record<string, string>;
}

export interface ImapConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  pass: string;
  timeoutMs?: number;
}

/**
 * Decodes MIME encoded-words like `=?UTF-8?B?U3ViamVjdA==?=` or `=?ISO-8859-1?Q?Hello=20World?=`
 */
export function decodeMimeWords(str: string): string {
  if (!str) return '';
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, charset, encoding, text) => {
    try {
      const enc = encoding.toUpperCase();
      const normCharset = charset.toLowerCase();
      const nodeCharset: BufferEncoding =
        normCharset.includes('utf') ? 'utf8' :
        normCharset.includes('ascii') ? 'ascii' : 'latin1';

      if (enc === 'B') {
        return Buffer.from(text, 'base64').toString(nodeCharset);
      } else if (enc === 'Q') {
        const unescaped = text.replace(/_/g, ' ').replace(/=([A-Fa-f0-9]{2})/g, (_m: string, hex: string) => {
          return String.fromCharCode(parseInt(hex, 16));
        });
        return Buffer.from(unescaped, 'latin1').toString(nodeCharset);
      }
    } catch {
      // Fallback if decode fails
    }
    return text;
  });
}

/**
 * Extracts bare email address from `Name <email@example.com>`
 */
export function extractEmailAddress(raw: string): string {
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/);
  const addr = (match ? match[1] : raw).trim().toLowerCase();
  return addr.replace(/['"]/g, '');
}

/**
 * Extracts display name from `Name <email@example.com>`
 */
export function extractDisplayName(raw: string): string | null {
  if (!raw) return null;
  const match = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  if (match && match[1].trim()) {
    return decodeMimeWords(match[1].trim());
  }
  return null;
}

/**
 * Unfolds and parses RFC822 header text into a key-value dictionary
 */
export function parseHeaders(headerText: string): Record<string, string> {
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = decodeMimeWords(line.slice(colonIdx + 1).trim());
      if (headers[key]) {
        headers[key] += `, ${val}`;
      } else {
        headers[key] = val;
      }
    }
  }

  return headers;
}

/**
 * Strips quoted history markers and extracts a clean snippet of the reply
 */
export function cleanReplySnippet(text: string): string {
  if (!text) return '';
  // Remove inline tags cleanly (b, i, em, strong, span, a) without adding extra space before punctuation
  let clean = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(b|strong|i|em|u|span|a|font)[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const markers = [
    /^\s*On .+ wrote:\s*$/m,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*_{5,}\s*$/m,
    /^\s*From:\s.+$/m,
  ];

  let cut = clean.length;
  for (const marker of markers) {
    const found = clean.match(marker);
    if (found?.index !== undefined && found.index < cut) cut = found.index;
  }

  clean = clean.slice(0, cut);
  return clean
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/\s+([.,!?:;])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

/**
 * Connects to IMAP server, authenticates, and retrieves the latest emails
 */
export async function fetchRecentEmailsFromMailbox(
  config: ImapConfig,
  options: { maxEmails?: number } = {},
): Promise<FetchedEmail[]> {
  const maxEmails = options.maxEmails ?? 30;
  const timeoutMs = config.timeoutMs ?? 30_000;
  const host = config.host || 'imap.gmail.com';
  const port = config.port ?? 993;

  return new Promise((resolve, reject) => {
    let resolved = false;
    let timer: NodeJS.Timeout | null = null;
    let socket: tls.TLSSocket | null = null;

    const cleanup = (err?: Error) => {
      if (timer) clearTimeout(timer);
      if (socket && !socket.destroyed) {
        try {
          socket.write('TAG_BYE LOGOUT\r\n');
        } catch {}
        socket.destroy();
      }
      if (!resolved) {
        resolved = true;
        if (err) reject(err);
        else resolve([]);
      }
    };

    timer = setTimeout(() => {
      cleanup(new Error(`IMAP connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      socket = tls.connect(
        {
          host,
          port,
          family: 4, // Force IPv4 to prevent hanging on unreachable IPv6 routes
          rejectUnauthorized: false, // tolerate self-signed in test environments
          servername: host,
        } as tls.ConnectionOptions & { family?: number },
        () => {
          // Connected
        },
      );
    } catch (err) {
      cleanup(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let buffer = '';
    let step:
      | 'await_greeting'
      | 'await_login'
      | 'await_select'
      | 'await_fetch'
      | 'await_logout' = 'await_greeting';
    let greetingHandled = false;
    let totalMessages = 0;
    const fetchedEmails: FetchedEmail[] = [];

    const sendCommand = (tag: string, cmd: string) => {
      if (!socket || socket.destroyed) return;
      socket.write(`${tag} ${cmd}\r\n`);
    };

    socket.on('data', (data) => {
      buffer += data.toString();

      // Guard: only process when we have at least one complete line
      if (!buffer.includes('\n')) return;

      if (step === 'await_greeting') {
        if (!greetingHandled && buffer.includes('* OK')) {
          greetingHandled = true;
          buffer = '';
          step = 'await_login';
          // Sanitize credentials
          const safeUser = config.user.replace(/["\\]/g, '');
          const safePass = config.pass.replace(/["\\]/g, '');
          sendCommand('A01', `LOGIN "${safeUser}" "${safePass}"`);
        }
      } else if (step === 'await_login') {
        if (buffer.includes('A01 OK')) {
          buffer = '';
          step = 'await_select';
          sendCommand('A02', 'SELECT "INBOX"');
        } else if (buffer.includes('A01 NO') || buffer.includes('A01 BAD')) {
          const errMsg = buffer.trim();
          cleanup(new Error(`IMAP Login failed: ${errMsg}`));
        }
      } else if (step === 'await_select') {
        if (buffer.includes('A02 OK')) {
          // Extract message count from `* <count> EXISTS`
          const existsMatch = buffer.match(/\*\s+(\d+)\s+EXISTS/i);
          totalMessages = existsMatch ? parseInt(existsMatch[1], 10) : 0;
          buffer = '';

          if (totalMessages === 0) {
            step = 'await_logout';
            sendCommand('A03', 'LOGOUT');
            return;
          }

          // Fetch the latest N messages (limit to 20 to avoid large FETCH timeouts)
          const fetchCount = Math.min(maxEmails, 20);
          const startSeq = Math.max(1, totalMessages - fetchCount + 1);
          const range = `${startSeq}:${totalMessages}`;
          step = 'await_fetch';
          // Using BODY.PEEK so Gmail DOES NOT mark emails as read
          sendCommand(
            'A03',
            `FETCH ${range} (UID RFC822.HEADER BODY.PEEK[TEXT])`,
          );
        } else if (buffer.includes('A02 NO') || buffer.includes('A02 BAD')) {
          cleanup(new Error(`IMAP Select INBOX failed: ${buffer.trim()}`));
        }
      } else if (step === 'await_fetch') {
        if (buffer.includes('A03 OK')) {
          // Parse all fetched items from buffer
          parseFetchResponses(buffer, fetchedEmails);
          buffer = '';
          step = 'await_logout';
          sendCommand('A04', 'LOGOUT');
        } else if (buffer.includes('A03 NO') || buffer.includes('A03 BAD')) {
          cleanup(new Error(`IMAP Fetch failed: ${buffer.trim()}`));
        }
      } else if (step === 'await_logout') {
        if (buffer.includes('A04 OK') || buffer.includes('* BYE')) {
          if (!resolved) {
            resolved = true;
            if (timer) clearTimeout(timer);
            socket?.destroy();
            resolve(fetchedEmails);
          }
        }
      }
    });

    socket.on('error', (err) => {
      cleanup(err);
    });

    socket.on('close', () => {
      if (!resolved) {
        resolved = true;
        if (timer) clearTimeout(timer);
        resolve(fetchedEmails);
      }
    });
  });
}

/**
 * Splits FETCH responses by `* <seq> FETCH (` and extracts headers and snippet
 */
function parseFetchResponses(rawOutput: string, list: FetchedEmail[]) {
  // Regex to split each FETCH response
  const items = rawOutput.split(/\*\s+(\d+)\s+FETCH\s+\(/i);

  for (let i = 1; i < items.length; i += 2) {
    const seq = parseInt(items[i], 10);
    const bodyPart = items[i + 1] || '';

    // Extract headers: look for RFC822.HEADER {length}\r\n<headers>
    let headerText = '';
    const headerMatch = bodyPart.match(/RFC822\.HEADER\s+\{\d+\}\r?\n([\s\S]*?)(?=\)\s*$|\r?\n\s*BODY\[|\r?\n\s*BODY\.PEEK\[|\r?\n\s*UID|\r?\n\s*\))/i);
    if (headerMatch) {
      headerText = headerMatch[1];
    } else {
      // Fallback header extract
      const fallbackMatch = bodyPart.match(/HEADER[^{]*\{\d+\}\r?\n([\s\S]*?)\r?\n(?=[A-Z0-9.\-_]+|\))/i);
      if (fallbackMatch) headerText = fallbackMatch[1];
    }

    const headers = parseHeaders(headerText);
    const fromRaw = headers['from'] || '';
    const fromEmail = extractEmailAddress(fromRaw);

    if (!fromEmail || !fromEmail.includes('@')) {
      continue;
    }

    const fromName = extractDisplayName(fromRaw);
    const to = headers['to'] || '';
    const subject = headers['subject'] || '(No Subject)';
    const dateStr = headers['date'];
    const date = dateStr ? new Date(dateStr) : null;
    const messageId = headers['message-id'] || null;
    const inReplyTo = headers['in-reply-to'] || null;

    // Extract body text: look for BODY[TEXT] {length}\r\n<body text>
    let bodyText = '';
    const textMatch = bodyPart.match(/BODY(?:\[TEXT\]|\.PEEK\[TEXT\])\s+\{\d+\}\r?\n([\s\S]*?)(?=\r?\n\)\r?\n|\)\s*$)/i);
    if (textMatch) {
      bodyText = textMatch[1];
    }

    const snippet = cleanReplySnippet(bodyText);

    // UID
    const uidMatch = bodyPart.match(/UID\s+(\d+)/i);
    const uid = uidMatch ? uidMatch[1] : undefined;

    list.push({
      uid,
      seq,
      from: fromRaw,
      fromEmail,
      fromName,
      to,
      subject,
      date,
      messageId,
      inReplyTo,
      snippet: snippet || subject,
      rawHeaders: headers,
    });
  }
}
