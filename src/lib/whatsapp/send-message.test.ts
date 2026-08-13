import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Mocks for the post-validation send path (conversation lookup → Meta send).
// The validation tests above short-circuit on a db that explodes, so these
// mocks only matter for the tests that actually reach Meta.
// ---------------------------------------------------------------------------
const { sendTemplateMessage } = vi.hoisted(() => ({
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid-1' })),
}));

vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/meta-api')>();
  return {
    ...actual,
    sendTemplateMessage,
    sendTextMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
  };
});

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
  isLegacyFormat: vi.fn(() => false),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ['update', 'eq', 'select']) b[m] = vi.fn(chain);
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: null });
      return b;
    },
  }),
}));

const CONVERSATION = {
  id: 'cv-1',
  account_id: 'acct-1',
  contact: { id: 'contact-1', account_id: 'acct-1', phone: '+15551234567' },
};
const CONFIG = {
  id: 'cfg-1',
  account_id: 'acct-1',
  phone_number_id: 'PNID-1',
  access_token: 'enc-token',
};

function makeDb(): SupabaseClient {
  function builder(table: string) {
    let didInsert = false;
    const selectResult = () => {
      switch (table) {
        case 'conversations':
          return { data: CONVERSATION, error: null };
        case 'whatsapp_config':
          return { data: CONFIG, error: null };
        case 'message_templates':
          return {
            data: {
              id: 'tpl-1',
              user_id: 'user-1',
              account_id: 'acct-1',
              name: 'cloudmasa_services',
              language: 'en',
              body_text: 'Hi {{1}}',
              header_type: 'image',
              header_handle: 'https://cdn.example.com/header.jpg',
              status: 'APPROVED',
            },
            error: null,
          };
        case 'messages':
          return { data: { id: 'msg-1' }, error: null };
        default:
          return { data: null, error: null };
      }
    };
    const insertResult = () => ({ data: { id: 'msg-1' }, error: null });
    const terminal = () =>
      Promise.resolve(didInsert ? insertResult() : selectResult());
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'delete']) {
      b[m] = vi.fn(chain);
    }
    b.insert = vi.fn(() => {
      didInsert = true;
      return b;
    });
    b.single = vi.fn(terminal);
    b.maybeSingle = vi.fn(terminal);
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(didInsert ? insertResult() : selectResult());
    return b;
  }
  return { from: vi.fn((table: string) => builder(table)) } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

describe('sendMessageToConversation — Meta #132001 template-not-found mapping', () => {
  const params: SendMessageParams = {
    conversationId: 'cv-1',
    messageType: 'template',
    templateName: 'cloudmasa_services',
    templateLanguage: 'en',
    templateParams: ['x'],
  };

  beforeEach(() => {
    sendTemplateMessage.mockReset();
    sendTemplateMessage.mockImplementation(async () => ({ messageId: 'wamid-1' }));
  });

  it('maps #132001 to an actionable template_not_found error', async () => {
    sendTemplateMessage.mockRejectedValueOnce(
      new Error('(#132001) Template name does not exist in the translation')
    );

    await sendMessageToConversation(makeDb(), 'acct-1', params).catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('template_not_found');
        expect(e.status).toBe(400);
        expect(e.message).toMatch(/cloudmasa_services/);
        expect(e.message).toMatch(/\(en\)/);
        expect(e.message).toMatch(/Sync from Meta/);
      }
    );
  });

  it('maps the older "does not exist in the translation" phrasing too', async () => {
    sendTemplateMessage.mockRejectedValueOnce(
      new Error('Template does not exist in the translation.')
    );

    await expect(
      sendMessageToConversation(makeDb(), 'acct-1', params)
    ).rejects.toMatchObject({ code: 'template_not_found', status: 400 });
  });

  it('keeps the generic meta_error code for unrelated Meta failures', async () => {
    sendTemplateMessage.mockRejectedValueOnce(
      new Error('(#100) Invalid parameter')
    );

    await expect(
      sendMessageToConversation(makeDb(), 'acct-1', params)
    ).rejects.toMatchObject({ code: 'meta_error', status: 502 });
  });
});
