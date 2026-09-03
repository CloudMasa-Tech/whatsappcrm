import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyMergeFields,
  injectOpenPixel,
  rewriteLinksForTracking,
  prepareTrackedBody,
  TRACKING_PIXEL,
  openTrackingUrl,
  clickTrackingUrl,
} from './tracking';
import { getPresetSmtpConfig } from './presets';
import { sendEmail, resolveEmailConfig } from './transport';

describe('Email Campaign Flow - Unit & Integration Tests', () => {
  describe('Merge Fields', () => {
    it('correctly replaces {{name}} and {{email}} variables', () => {
      const template = 'Hello {{name}}, your account email is {{email}}!';
      const result = applyMergeFields(template, {
        name: 'Alex Johnson',
        email: 'alex@example.com',
      });
      expect(result).toBe('Hello Alex Johnson, your account email is alex@example.com!');
    });

    it('tolerates whitespace inside merge tags like {{ name }}', () => {
      const template = 'Hi {{ name }}, welcome to {{ company }}';
      const result = applyMergeFields(template, {
        name: 'Sarah',
        company: 'Acme Corp',
      });
      expect(result).toBe('Hi Sarah, welcome to Acme Corp');
    });

    it('leaves unprovided merge tags intact without crashing', () => {
      const template = 'Hello {{name}}, your code is {{code}}';
      const result = applyMergeFields(template, { name: 'Bob' });
      expect(result).toBe('Hello Bob, your code is {{code}}');
    });
  });

  describe('Tracking System', () => {
    const token = 'a1b2c3d4e5f678901234567890abcdef';

    it('generates valid open and click tracking URLs', () => {
      const openUrl = openTrackingUrl(token);
      expect(openUrl).toContain(`/api/email/track/open/${token}`);

      const clickUrl = clickTrackingUrl(token, 'https://example.com/promo');
      expect(clickUrl).toContain(`/api/email/track/click/${token}`);
      expect(clickUrl).toContain('u=https%3A%2F%2Fexample.com%2Fpromo');
    });

    it('injects 1x1 transparent tracking pixel before closing </body>', () => {
      const html = '<html><body><h1>Summer Sale</h1><p>Special offer!</p></body></html>';
      const tracked = injectOpenPixel(html, token);
      expect(tracked).toContain(`<img src="${openTrackingUrl(token)}"`);
      expect(tracked).toContain('</body>');
    });

    it('appends tracking pixel if no </body> tag is present', () => {
      const html = '<div>Simple newsletter fragment</div>';
      const tracked = injectOpenPixel(html, token);
      expect(tracked).toContain(`<img src="${openTrackingUrl(token)}"`);
      expect(tracked.startsWith('<div>Simple newsletter fragment</div><img')).toBe(true);
    });

    it('rewrites outbound hyperlinks to route through click tracker', () => {
      const html = '<p>Check out our <a href="https://example.com/products">New Products</a>!</p>';
      const rewritten = rewriteLinksForTracking(html, token);
      expect(rewritten).toContain(clickTrackingUrl(token, 'https://example.com/products'));
    });

    it('skips mailto:, tel:, anchor and unsubscribe links when rewriting', () => {
      const html = `
        <a href="mailto:support@example.com">Email Us</a>
        <a href="tel:+123456789">Call Us</a>
        <a href="#section-1">Jump</a>
        <a href="https://example.com/unsubscribe?user=123">Unsubscribe</a>
        <a href="https://example.com/store">Store</a>
      `;
      const rewritten = rewriteLinksForTracking(html, token);
      expect(rewritten).toContain('href="mailto:support@example.com"');
      expect(rewritten).toContain('href="tel:+123456789"');
      expect(rewritten).toContain('href="#section-1"');
      expect(rewritten).toContain('href="https://example.com/unsubscribe?user=123"');
      expect(rewritten).toContain(clickTrackingUrl(token, 'https://example.com/store'));
    });

    it('prepareTrackedBody applies both open and click tracking as configured', () => {
      const rawHtml = '<body><a href="https://example.com">Visit</a></body>';
      const prepared = prepareTrackedBody({
        html: rawHtml,
        token,
        trackOpens: true,
        trackClicks: true,
      });

      expect(prepared).toContain(clickTrackingUrl(token, 'https://example.com'));
      expect(prepared).toContain(openTrackingUrl(token));
    });

    it('provides valid 1x1 GIF tracking pixel buffer', () => {
      expect(TRACKING_PIXEL).toBeInstanceOf(Buffer);
      expect(TRACKING_PIXEL.length).toBeGreaterThan(0);
      // GIF magic bytes: GIF89a or GIF87a
      expect(TRACKING_PIXEL.slice(0, 3).toString('ascii')).toBe('GIF');
    });
  });

  describe('SMTP Presets', () => {
    it('returns standard configuration for Gmail', () => {
      const config = getPresetSmtpConfig('gmail');
      expect(config.host).toBe('smtp.gmail.com');
      expect(config.port).toBe(465);
      expect(config.secure).toBe(true);
    });

    it('returns standard configuration for Outlook / Office365', () => {
      const config = getPresetSmtpConfig('outlook');
      expect(config.host).toBe('smtp.office365.com');
      expect(config.port).toBe(587);
      expect(config.secure).toBe(false);
    });

    it('returns standard configuration for Zoho', () => {
      const config = getPresetSmtpConfig('zoho');
      expect(config.host).toBe('smtp.zoho.com');
      expect(config.port).toBe(465);
      expect(config.secure).toBe(true);
    });
  });

  describe('Transport Error Handling & Project Isolation', () => {
    it('returns a clear failure error when no SMTP is configured', async () => {
      const res = await sendEmail({
        to: 'customer@example.com',
        subject: 'Test Campaign',
        html: '<p>Hello!</p>',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('enforces that an unconfigured project returns null and does not leak global fallback', async () => {
      // With a specific project that has no db row, it returns null
      const config = await resolveEmailConfig('non-existent-project-id', 'test-account');
      expect(config).toBeNull();
    });
  });
});
