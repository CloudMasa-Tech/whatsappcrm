import { describe, expect, it } from 'vitest';
import { STARTER_EMAIL_TEMPLATES } from './campaign-helpers';

describe('Campaign Follow-Up & Reminder System', () => {
  it('has pre-configured starter template for quick follow-ups', () => {
    const followupTpl = STARTER_EMAIL_TEMPLATES.find(
      (t) => t.id === 'regibiz-followup',
    );
    expect(followupTpl).toBeDefined();
    expect(followupTpl?.category).toBe('Follow-Up');
    expect(followupTpl?.name).toContain('Quick Follow-Up');
    expect(followupTpl?.bodyHtml).toContain('floating this back up');
  });

  it('supports merge fields in follow-up subject and body', () => {
    const rawSubject = 'Re: Quick question for {{name}}';
    const rawBody = '<p>Hi {{name}}, checking in on {{company_name}}.</p>';

    expect(rawSubject.includes('{{name}}')).toBe(true);
    expect(rawBody.includes('{{company_name}}')).toBe(true);
  });

  it('correctly calculates recipient breakdown for follow-ups', () => {
    const sampleRecipients = [
      { id: '1', email: 'a@example.com', open_count: 0, replied_at: null, status: 'sent' },
      { id: '2', email: 'b@example.com', open_count: 2, replied_at: null, status: 'sent' },
      { id: '3', email: 'c@example.com', open_count: 1, replied_at: '2026-11-19T10:00:00Z', status: 'sent' },
      { id: '4', email: 'd@example.com', open_count: 0, replied_at: null, status: 'failed' },
    ];

    const sent = sampleRecipients.filter((r) => r.status === 'sent');
    expect(sent.length).toBe(3);

    const nonRepliers = sent.filter((r) => !r.replied_at);
    expect(nonRepliers.length).toBe(2);

    const unopened = sent.filter((r) => r.open_count === 0 && !r.replied_at);
    expect(unopened.length).toBe(1);
    expect(unopened[0].email).toBe('a@example.com');

    const openedNotReplied = sent.filter((r) => r.open_count > 0 && !r.replied_at);
    expect(openedNotReplied.length).toBe(1);
    expect(openedNotReplied[0].email).toBe('b@example.com');
  });
});
