import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSuperAdminSupportEmail,
  sendTicketCreatedSuperAdminEmail,
  sendTicketConfirmationSubmitterEmail,
  sendTicketStatusUpdateEmail,
  type TicketData,
} from './tickets';
import * as transport from './transport';

describe('Support Ticket Email Service', () => {
  const mockTicket: TicketData = {
    id: 'test-ticket-uuid',
    ticket_number: 'TCK-2026-1001',
    subject: 'WhatsApp QR Gateway Disconnected',
    description: 'The QR pairing keeps dropping after 2 minutes of idle time.',
    category: 'whatsapp_gateway',
    priority: 'urgent',
    status: 'open',
    created_by_name: 'John Doe',
    created_by_email: 'john@clientcorp.com',
    attachment_urls: ['https://storage.cloudmasa.com/chat-media/error.png'],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves default super admin email to info@cloudmasa.com', () => {
    const email = getSuperAdminSupportEmail();
    expect(email).toBe('info@cloudmasa.com');
  });

  it('dispatches ticket creation email to info@cloudmasa.com with urgent priority banner', async () => {
    const sendSpy = vi.spyOn(transport, 'sendEmail').mockResolvedValue({
      success: true,
      messageId: 'mock-msg-123',
    });

    const result = await sendTicketCreatedSuperAdminEmail({
      ticket: mockTicket,
      projectName: 'Alpha Sales',
      accountName: 'Client Corp',
    });

    expect(result.success).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const callArgs = sendSpy.mock.calls[0][0];
    expect(callArgs.to).toBe('info@cloudmasa.com');
    expect(callArgs.subject).toContain('#TCK-2026-1001');
    expect(callArgs.subject).toContain('URGENT');
    expect(callArgs.subject).toContain('WhatsApp QR Gateway Disconnected');
    expect(callArgs.html).toContain('John Doe');
    expect(callArgs.html).toContain('john@clientcorp.com');
    expect(callArgs.html).toContain('Alpha Sales');
    expect(callArgs.html).toContain('https://storage.cloudmasa.com/chat-media/error.png');
    expect(callArgs.html).toContain('/admin/tickets?ticketId=test-ticket-uuid');
  });

  it('dispatches confirmation receipt to submitter', async () => {
    const sendSpy = vi.spyOn(transport, 'sendEmail').mockResolvedValue({
      success: true,
      messageId: 'mock-msg-456',
    });

    const result = await sendTicketConfirmationSubmitterEmail({
      ticket: mockTicket,
      projectName: 'Alpha Sales',
    });

    expect(result.success).toBe(true);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@clientcorp.com',
        subject: expect.stringContaining('#TCK-2026-1001'),
      })
    );
  });

  it('dispatches status update email when ticket is resolved with notes', async () => {
    const sendSpy = vi.spyOn(transport, 'sendEmail').mockResolvedValue({
      success: true,
      messageId: 'mock-msg-789',
    });

    const result = await sendTicketStatusUpdateEmail({
      ticket: mockTicket,
      oldStatus: 'open',
      newStatus: 'resolved',
      resolutionNotes: 'Updated gateway WebSocket keepalive timeout to 60s.',
    });

    expect(result.success).toBe(true);
    const callArgs = sendSpy.mock.calls[0][0];
    expect(callArgs.to).toBe('john@clientcorp.com');
    expect(callArgs.subject).toContain('RESOLVED');
    expect(callArgs.html).toContain('Updated gateway WebSocket keepalive timeout to 60s.');
  });
});
