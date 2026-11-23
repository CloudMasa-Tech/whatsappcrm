import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requireProjectRole, getCurrentProject } from '@/lib/auth/project'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { AUTOMATION_TEMPLATES } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'

export async function POST() {
  try {
    await requireProjectRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accountId, projectId } = await getCurrentProject()
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  const admin = supabaseAdmin()

  // Fetch existing automations in this project to prevent duplicate seeds
  let existingQuery = admin
    .from('automations')
    .select('name')
    .eq('account_id', accountId)

  if (projectId) {
    existingQuery = existingQuery.eq('project_id', projectId)
  }

  const { data: existingRows } = await existingQuery
  const existingNames = new Set((existingRows ?? []).map((r) => r.name.toLowerCase().trim()))

  const templatesList = Object.values(AUTOMATION_TEMPLATES)
  let seededCount = 0
  const createdAutomations = []

  for (const t of templatesList) {
    const candidateName = `[Sample] ${t.name}`
    if (existingNames.has(candidateName.toLowerCase()) || existingNames.has(t.name.toLowerCase())) {
      continue
    }

    const { data: automation, error: insertErr } = await admin
      .from('automations')
      .insert({
        user_id: user.id,
        account_id: accountId,
        project_id: projectId,
        name: candidateName,
        description: t.description,
        trigger_type: t.trigger_type,
        trigger_config: t.trigger_config ?? {},
        is_active: false, // Created as dormant samples ready for customization
      })
      .select()
      .single()

    if (insertErr || !automation) {
      console.warn(`[seed-samples] Failed to insert ${t.slug}:`, insertErr)
      continue
    }

    if (t.steps && t.steps.length > 0) {
      await insertSteps(automation.id, t.steps as unknown as BuilderStepInput[])
    }

    seededCount++
    createdAutomations.push(automation)
  }

  return NextResponse.json({
    success: true,
    seededCount,
    totalTemplates: templatesList.length,
    automations: createdAutomations,
  })
}
