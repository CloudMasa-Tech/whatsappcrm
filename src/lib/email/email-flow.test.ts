import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  applyMergeFields,
  injectOpenPixel,
  rewriteLinksForTracking,
  prepareTrackedBody,
  TRACKING_PIXEL,
  openTrackingUrl,
  clickTrackingUrl,
} from './tracking';
import {
  ensureEmailHtml,
  htmlToPlainText,
  mergeImportedRecipientsText,
  parseEmailImportText,
  parseRecipientInput,
  resolveSendMergeValues,
  sanitizeSenderName,
  STARTER_EMAIL_TEMPLATES,
} from './campaign-helpers';
import { insertCampaignRecipients } from './campaign-recipients';
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

  describe('Campaign Templates, Parsing & Repeat Sends', () => {
    it('parses plain emails, Name <email> entries, ignores invalid tokens, and deduplicates', () => {
      const parsed = parseRecipientInput(
        'alice@example.com\n"Bob Kumar" <BOB@example.com>, not-an-email, alice@example.com; Carol <carol@startup.in>',
      );
      expect(parsed).toEqual([
        { email: 'alice@example.com', name: null },
        { email: 'bob@example.com', name: 'Bob Kumar' },
        { email: 'carol@startup.in', name: 'Carol' },
      ]);
    });

    it('converts plain text paragraphs safely into HTML while preserving existing HTML', () => {
      const plain = 'Hi {{name}},\n\nCheck out RegiBIZ <https://regibiz.in>.\nBest,\nTeam';
      expect(ensureEmailHtml(plain)).toBe(
        '<p>Hi {{name}},</p>\n\n<p>Check out RegiBIZ &lt;https://regibiz.in&gt;.<br />Best,<br />Team</p>',
      );

      const html = '<p>Hi {{name}},</p><p><strong>RegiBIZ</strong></p>';
      expect(ensureEmailHtml(html)).toBe(html);
      expect(htmlToPlainText(html)).toBe('Hi {{name}},\nRegiBIZ');
    });

    it('falls back cleanly on blank recipient names for subject & body merge fields', () => {
      expect(resolveSendMergeValues({ email: 'lead@startup.in', name: null })).toEqual({
        subjectFields: { name: 'you', email: 'lead@startup.in' },
        bodyFields: { name: 'there', email: 'lead@startup.in' },
      });
      expect(
        resolveSendMergeValues({ email: 'priya@startup.in', name: 'Priya' }),
      ).toEqual({
        subjectFields: { name: 'Priya', email: 'priya@startup.in' },
        bodyFields: { name: 'Priya', email: 'priya@startup.in' },
      });
    });

    it('includes the RegiBIZ First Customer Outreach starter template', () => {
      const regibiz = STARTER_EMAIL_TEMPLATES.find((t) => t.id === 'regibiz-first-outreach');
      expect(regibiz).toBeDefined();
      expect(regibiz?.bodyHtml).toContain('RegiBIZ');
      expect(regibiz?.bodyHtml).toContain('{{name}}');
    });

    it('insertCampaignRecipients skips duplicates cleanly unless allowResendExisting is true', async () => {
      const insertedBatches: Array<Array<Record<string, unknown>>> = [];
      const mockDb = {
        from: vi.fn((table: string) => {
          if (table === 'email_campaign_recipients') {
            return {
              select: vi.fn((_cols?: string, opts?: { count?: string; head?: boolean }) => {
                if (opts?.head) {
                  return {
                    eq: vi.fn().mockResolvedValue({ count: 3 }),
                  };
                }
                return {
                  eq: vi.fn().mockResolvedValue({
                    data: [
                      { email: 'sent@example.com', status: 'sent' },
                      { email: 'queued@example.com', status: 'pending' },
                    ],
                    error: null,
                  }),
                };
              }),
              insert: vi.fn(async (rows: Array<Record<string, unknown>>) => {
                insertedBatches.push(rows);
                return { error: null };
              }),
            };
          }
          if (table === 'email_campaigns') {
            return {
              update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const skipRes = await insertCampaignRecipients(mockDb as never, {
        campaignId: 'camp-1',
        candidates: [
          { email: 'sent@example.com', name: 'Already Sent', contact_id: null },
          { email: 'queued@example.com', name: 'Queued', contact_id: null },
          { email: 'new@example.com', name: 'New Person', contact_id: 'c-1' },
        ],
        allowResendExisting: false,
      });

      expect(skipRes.addedCount).toBe(1);
      expect(skipRes.skippedAlreadySent).toBe(1);
      expect(skipRes.skippedPending).toBe(1);
      expect(insertedBatches[0]).toHaveLength(1);
      expect(insertedBatches[0][0].email).toBe('new@example.com');

      const resendRes = await insertCampaignRecipients(mockDb as never, {
        campaignId: 'camp-1',
        candidates: [
          { email: 'sent@example.com', name: 'Already Sent', contact_id: null },
        ],
        allowResendExisting: true,
      });

      expect(resendRes.addedCount).toBe(1);
      expect(resendRes.skippedAlreadySent).toBe(0);
    });

    it('allows repeat batch sends on sent campaigns while enforcing account scoping', () => {
      const sendSrc = readFileSync(
        join(process.cwd(), 'src', 'app', 'api', 'email', 'campaigns', '[id]', 'send', 'route.ts'),
        'utf8',
      );
      expect(sendSrc).not.toContain("campaign.status === 'sent'");
      expect(sendSrc).toContain(".eq('status', 'pending')");

      const recipSrc = readFileSync(
        join(process.cwd(), 'src', 'app', 'api', 'email', 'campaigns', '[id]', 'recipients', 'route.ts'),
        'utf8',
      );
      expect(recipSrc).toContain(".eq('account_id', ctx.accountId)");
    });

    it('parses bulk CSV/TSV/TXT email imports with BOM, headers, and headerless lines', () => {
      const bomCsv =
        '\uFEFF"First Name","Last Name","Email Address"\nPriya,Sharma,PRIYA@company.com\nInvalid,Row,not-email\nRahul,Nair,rahul@startup.in\nPriya,Sharma,priya@company.com';
      const parsedCsv = parseEmailImportText(bomCsv);
      expect(parsedCsv.recipients.map((r) => ({ email: r.email, name: r.name }))).toEqual([
        { email: 'priya@company.com', name: 'Priya Sharma' },
        { email: 'rahul@startup.in', name: 'Rahul Nair' },
      ]);
      expect(parsedCsv.recipients[0].metadata?.first_name).toBe('Priya');
      expect(parsedCsv.recipients[0].metadata?.last_name).toBe('Sharma');
      expect(parsedCsv.skippedCount).toBe(2);

      const headerlessTxt =
        'Founder One, one@biz.in\ntwo@biz.in\n"Doe, Jane" <jane@biz.in>';
      const parsedTxt = parseEmailImportText(headerlessTxt);
      expect(parsedTxt.recipients).toEqual([
        { email: 'one@biz.in', name: 'Founder One' },
        { email: 'two@biz.in', name: null },
        { email: 'jane@biz.in', name: 'Doe, Jane' },
      ]);

      const merged = mergeImportedRecipientsText('one@biz.in', parsedTxt.recipients);
      expect(merged).toBe(
        'Founder One <one@biz.in>\ntwo@biz.in\nDoe Jane <jane@biz.in>',
      );
    });

    it('correctly parses custom columns from spreadsheet CSV and replaces placeholders like {{company_name}}', () => {
      const userCsv =
        'S.No,Registered Mail,Company Name,Incorporation Date,Login Mail,Password Setup Status\n' +
        '1,arunkumarmurali07248@gmail.com,7STAR SCAFFOLDING PRIVATE LIMITED,2026-06-09,arunkumarmurali07248@gmail.com,Active\n' +
        '2,aarav.shibub@gmail.com,7STAR SCAFFOLDING PRIVATE LIMITED,2026-06-09,aarav.shibub@gmail.com,Active\n';

      const parsed = parseEmailImportText(userCsv);
      expect(parsed.recipients).toHaveLength(2);

      const r1 = parsed.recipients[0];
      expect(r1.email).toBe('arunkumarmurali07248@gmail.com');
      expect(r1.name).toBe('7STAR SCAFFOLDING PRIVATE LIMITED');
      expect(r1.metadata?.company_name).toBe('7STAR SCAFFOLDING PRIVATE LIMITED');
      expect(r1.metadata?.['Company Name']).toBe('7STAR SCAFFOLDING PRIVATE LIMITED');
      expect(r1.metadata?.incorporation_date).toBe('2026-06-09');
      expect(r1.metadata?.login_mail).toBe('arunkumarmurali07248@gmail.com');
      expect(r1.metadata?.password_setup_status).toBe('Active');

      // Test resolveSendMergeValues and applyMergeFields on email body and subject
      const { subjectFields, bodyFields } = resolveSendMergeValues(r1);

      const subjectTemplate = 'Welcome {{company_name}}!';
      const renderedSubject = applyMergeFields(subjectTemplate, subjectFields);
      expect(renderedSubject).toBe('Welcome 7STAR SCAFFOLDING PRIVATE LIMITED!');

      const bodyTemplate =
        '<p>Dear {{company_name}} Team,</p>' +
        '<p>Welcome to Complaudi! Incorporated on {{incorporation_date}}.</p>' +
        '<p>Your login email is {{login_mail}} and password status is {{password_setup_status}}.</p>';
      const renderedBody = applyMergeFields(bodyTemplate, bodyFields);

      expect(renderedBody).toContain('Dear 7STAR SCAFFOLDING PRIVATE LIMITED Team,');
      expect(renderedBody).toContain('Incorporated on 2026-06-09.');
      expect(renderedBody).toContain('Your login email is arunkumarmurali07248@gmail.com');
      expect(renderedBody).toContain('password status is Active.');

      // Test that {{login_email}} matches "Login Mail" from the CSV
      const bodyWithLoginEmail =
        '<p>Username: {{login_email}}</p>' +
        '<p>Registered: {{registered_email}}</p>' +
        '<p>Account: {{username}}</p>';
      const renderedLogin = applyMergeFields(bodyWithLoginEmail, bodyFields);
      expect(renderedLogin).toContain('Username: arunkumarmurali07248@gmail.com');
      expect(renderedLogin).toContain('Registered: arunkumarmurali07248@gmail.com');
      expect(renderedLogin).toContain('Account: arunkumarmurali07248@gmail.com');

      // Also verify dual-layer fallback when recipient has JSON encoded in name
      const fallbackRecipient = {
        email: 'test@example.com',
        name: JSON.stringify({
          name: null,
          company_name: 'Acme Pvt Ltd',
          incorporation_date: '2025-01-01',
        }),
      };
      const fallbackValues = resolveSendMergeValues(fallbackRecipient);
      expect(fallbackValues.bodyFields.company_name).toBe('Acme Pvt Ltd');
      expect(applyMergeFields('Hi {{company_name}}', fallbackValues.bodyFields)).toBe('Hi Acme Pvt Ltd');
      // {{name}} falls back to company name
      expect(applyMergeFields('Hello {{name}}', fallbackValues.bodyFields)).toBe('Hello Acme Pvt Ltd');
    });

    it('sanitizes campaign sender names and wires fromName through create and send routes', () => {
      expect(sanitizeSenderName('  Comlaudi  ')).toBe('Comlaudi');
      expect(sanitizeSenderName('RegiBIZ\r\n"Team" <vip>')).toBe('RegiBIZ Team vip');
      expect(sanitizeSenderName('   ')).toBe('');

      const createSrc = readFileSync(
        join(process.cwd(), 'src', 'app', 'api', 'email', 'campaigns', 'route.ts'),
        'utf8',
      );
      expect(createSrc).toContain('sanitizeSenderName(body.fromName)');

      const transportSrc = readFileSync(
        join(process.cwd(), 'src', 'lib', 'email', 'transport.ts'),
        'utf8',
      );
      expect(transportSrc).toContain('sanitizeSenderName(options.fromName)');
      expect(transportSrc).toContain('sanitizeSenderName(config.fromName)');
    });
  });
});
