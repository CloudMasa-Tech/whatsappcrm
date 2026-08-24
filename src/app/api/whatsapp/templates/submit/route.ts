import { NextResponse } from 'next/server'
import { getCurrentProject } from '@/lib/auth/project'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'

/**
 * Shared upsert payload builder — both the Meta-failure path and the
 * Meta-success path write nearly identical rows; dropping the shared
 * fields here means adding a column later only touches one spot.
 */
function buildUpsertRow(
  accountId: string,
  projectId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
  },
) {
  return {
    // Tenancy — both NOT NULL on message_templates (017, then 042).
    // project_id is the isolation boundary: two projects in one
    // organisation each keep their own template catalogue against
    // their own WhatsApp number.
    account_id: accountId,
    project_id: projectId,
    // Original author — kept as audit only. The unique index is
    // still on (user_id, name, language) — see the upsert helper
    // for the cross-teammate dedup follow-up.
    user_id: userId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    // Clear stale rejection_reason whenever we re-submit; the
    // webhook will set it again if Meta still rejects.
    rejection_reason: extras.submissionError ? null : null,
    last_submitted_at: new Date().toISOString(),
  }
}

async function upsertTemplateRow(
  supabase: SupabaseClient,
  row: ReturnType<typeof buildUpsertRow>,
) {
  // TODO(account-sharing): conflict target is still scoped to
  // user_id. Once a follow-up migration drops the legacy unique
  // index on (user_id, name, language) and adds (account_id,
  // name, language), switch `onConflict` here so two teammates
  // can't shadow each other's same-named template.
  return supabase
    .from('message_templates')
    .upsert(row, { onConflict: 'user_id,name,language' })
    .select()
    .single()
}

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → fetch whatsapp_config → validate → (DRY_RUN short-circuit) →
 * POST to Meta → upsert local row by (user_id, name, language) with
 * status, meta_template_id, sample_values, last_submitted_at.
 *
 * When WHATSAPP_TEMPLATES_DRY_RUN=true, we skip the network call and
 * insert a row with a synthetic `dry-run-<uuid>` meta_template_id so
 * CI / local dev can exercise the full UI without a real Meta App.
 *
 * On the Meta side this is a one-way trip — a row can only be
 * submitted; editing or deleting requires hsm_id and lives in PR 4.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve the caller's account_id — whatsapp_config + the
    // message_templates row are account-scoped post-multi-user.
    // Resolve the caller's account AND active project. Post-042 the
    // project is the tenancy key on every domain row, and this route
    // writes through the service-role client, so RLS will not catch a
    // missing or wrong scope.
    const { accountId, projectId } = await getCurrentProject();
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
        },
        { status: 400 },
      )
    }

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('platform_role, role')
      .eq('user_id', user.id)
      .single();

    const isSuperAdmin = profile?.platform_role === 'super_admin';
    const targetStatus = isSuperAdmin ? 'APPROVED' : 'PENDING';

    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1';

    let metaTemplateId: string | null = null;
    let metaStatus: string = targetStatus;

    if (dryRun) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`;
    } else {
      const { data: config } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();

      if (config?.waba_id && config?.access_token) {
        try {
          const accessToken = decrypt(config.access_token);
          await ensureImageHeaderHandle(payload, accessToken);
          const metaPayload = buildMetaTemplatePayload(payload);
          const meta = await submitMessageTemplate({
            wabaId: config.waba_id,
            accessToken,
            payload: metaPayload,
          });
          metaTemplateId = meta.id;
          if (meta.status) metaStatus = meta.status;
        } catch (e) {
          console.warn('[template submit] Meta API submit failed or unneeded (QR mode), proceeding with local template creation:', e);
        }
      }
    }

    const finalStatus = isSuperAdmin ? 'APPROVED' : normalizeStatus(metaStatus);

    const { data: row, error: upsertErr } = await upsertTemplateRow(
      supabase,
      buildUpsertRow(
        accountId,
        projectId,
        user.id,
        payload,
        {
          status: finalStatus,
          metaTemplateId,
          submissionError: null,
        },
      ),
    );

    if (upsertErr) {
      return NextResponse.json(
        {
          error: `Failed to save template locally: ${upsertErr.message}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      template: row,
      dry_run: dryRun,
      isSuperAdmin,
      requiresApproval: !isSuperAdmin,
    });
  } catch (error) {
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
