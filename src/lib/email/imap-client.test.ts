import { describe, it, expect } from 'vitest';
import {
  decodeMimeWords,
  extractEmailAddress,
  extractDisplayName,
  parseHeaders,
  cleanReplySnippet,
} from './imap-client';

describe('IMAP Client Utilities', () => {
  describe('decodeMimeWords', () => {
    it('decodes base64 MIME encoded words', () => {
      // "Re: Welcome to Complaudi!" in base64: UmU6IFdlbGNvbWUgdG8gQ29tcGxhdWRpIQ==
      const encoded = '=?UTF-8?B?UmU6IFdlbGNvbWUgdG8gQ29tcGxhdWRpIQ==?=';
      expect(decodeMimeWords(encoded)).toBe('Re: Welcome to Complaudi!');
    });

    it('decodes quoted-printable MIME encoded words', () => {
      const encoded = '=?ISO-8859-1?Q?Hello=20World?=';
      expect(decodeMimeWords(encoded)).toBe('Hello World');
    });

    it('returns raw text unchanged if not encoded', () => {
      expect(decodeMimeWords('Just normal subject')).toBe('Just normal subject');
    });
  });

  describe('extractEmailAddress', () => {
    it('extracts bare email from full name angle-bracket format', () => {
      expect(extractEmailAddress('Priya Sharma <priya@startup.in>')).toBe('priya@startup.in');
      expect(extractEmailAddress('"John Doe" <john.doe@company.com>')).toBe('john.doe@company.com');
    });

    it('handles bare email address', () => {
      expect(extractEmailAddress('info@cloudmasa.com')).toBe('info@cloudmasa.com');
      expect(extractEmailAddress('  contact@gmail.com  ')).toBe('contact@gmail.com');
    });
  });

  describe('extractDisplayName', () => {
    it('extracts display name when present', () => {
      expect(extractDisplayName('Priya Sharma <priya@startup.in>')).toBe('Priya Sharma');
      expect(extractDisplayName('"Acme Sales" <sales@acme.com>')).toBe('Acme Sales');
    });

    it('returns null when no name is provided', () => {
      expect(extractDisplayName('priya@startup.in')).toBeNull();
      expect(extractDisplayName('<priya@startup.in>')).toBeNull();
    });
  });

  describe('parseHeaders', () => {
    it('parses unfolded multi-line RFC822 headers', () => {
      const raw = `From: Priya Sharma <priya@startup.in>\r\nTo: info@cloudmasa.com\r\nSubject: Re: Onboarding\r\nDate: Sat, 14 Nov 2026 12:00:00 +0000\r\nMessage-ID: <abc123xyz@mail.gmail.com>\r\nIn-Reply-To: <orig987@cloudmasa.com>\r\n`;
      const parsed = parseHeaders(raw);
      expect(parsed['from']).toBe('Priya Sharma <priya@startup.in>');
      expect(parsed['to']).toBe('info@cloudmasa.com');
      expect(parsed['subject']).toBe('Re: Onboarding');
      expect(parsed['message-id']).toBe('<abc123xyz@mail.gmail.com>');
      expect(parsed['in-reply-to']).toBe('<orig987@cloudmasa.com>');
    });

    it('unfolds headers with indented continuation lines', () => {
      const raw = `Subject: Very long\r\n subject that was folded\r\n across multiple lines\r\nFrom: test@test.com\r\n`;
      const parsed = parseHeaders(raw);
      expect(parsed['subject']).toBe('Very long subject that was folded across multiple lines');
    });
  });

  describe('cleanReplySnippet', () => {
    it('cuts off quoted reply markers like On ... wrote:', () => {
      const text = `Yes, we are interested in scheduling a call for Monday!\r\n\r\nOn Sat, Nov 14, 2026 at 11:30 AM CloudMaSa wrote:\r\n> Hello Priya, welcome to Complaudi!`;
      const snippet = cleanReplySnippet(text);
      expect(snippet).toContain('Yes, we are interested in scheduling a call for Monday!');
      expect(snippet).not.toContain('Hello Priya');
    });

    it('strips HTML tags and normalizes whitespace', () => {
      const html = `<p>Hi team,</p><p>We would love to get started <b>today</b>.</p>`;
      const snippet = cleanReplySnippet(html);
      expect(snippet).toBe('Hi team, We would love to get started today.');
    });
  });
});

