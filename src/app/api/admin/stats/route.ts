import { NextResponse } from 'next/server';
import { requireSuperAdmin, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSuperAdmin();
    const adminClient = supabaseAdmin();

    // Fetch all overview metrics in parallel
    const [
      projectsRes,
      profilesRes,
      qrSessionsRes,
      whatsappConfigRes,
      instagramConfigRes,
      conversationsRes,
      messagesRes,
      projectMembersRes,
      pendingTemplatesRes,
    ] = await Promise.allSettled([
      adminClient
        .from('projects')
        .select('id, name, slug, channel_type, allowed_channels, archived_at, created_at')
        .order('created_at', { ascending: false }),

      adminClient
        .from('profiles')
        .select('id, user_id, email, full_name, role, account_role, platform_role, created_at')
        .order('created_at', { ascending: false }),

      adminClient
        .from('qr_sessions')
        .select('id, project_id, status, phone_number, updated_at'),

      adminClient
        .from('whatsapp_config')
        .select('id, project_id, phone_number_id, verified_name, display_phone_number, created_at'),

      adminClient
        .from('instagram_config')
        .select('id, project_id, instagram_user_id, username, status, created_at'),

      adminClient
        .from('conversations')
        .select('id', { count: 'exact', head: true }),

      adminClient
        .from('messages')
        .select('id', { count: 'exact', head: true }),

      adminClient
        .from('project_members')
        .select('project_id, user_id'),

      adminClient
        .from('message_templates')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'PENDING'),
    ]);

    const projects = projectsRes.status === 'fulfilled' ? projectsRes.value.data ?? [] : [];
    const profiles = profilesRes.status === 'fulfilled' ? profilesRes.value.data ?? [] : [];
    const qrSessions = qrSessionsRes.status === 'fulfilled' ? qrSessionsRes.value.data ?? [] : [];
    const whatsappConfigs = whatsappConfigRes.status === 'fulfilled' ? whatsappConfigRes.value.data ?? [] : [];
    const instagramConfigs = instagramConfigRes.status === 'fulfilled' ? instagramConfigRes.value.data ?? [] : [];
    const totalConversations = conversationsRes.status === 'fulfilled' ? conversationsRes.value.count ?? 0 : 0;
    const totalMessages = messagesRes.status === 'fulfilled' ? messagesRes.value.count ?? 0 : 0;
    const projectMembers = projectMembersRes.status === 'fulfilled' ? projectMembersRes.value.data ?? [] : [];
    const pendingTemplates = pendingTemplatesRes.status === 'fulfilled' ? pendingTemplatesRes.value.count ?? 0 : 0;

    // Map projects by ID for quick lookup
    const projectMap = new Map<string, string>();
    for (const p of projects) {
      projectMap.set(p.id, p.name);
    }

    // Map user project assignments
    const userProjectMap = new Map<string, string[]>();
    for (const pm of projectMembers) {
      const existing = userProjectMap.get(pm.user_id) ?? [];
      const pName = projectMap.get(pm.project_id);
      if (pName && !existing.includes(pName)) {
        existing.push(pName);
      }
      userProjectMap.set(pm.user_id, existing);
    }

    // 1. Projects Metrics
    const totalProjects = projects.length;
    const activeProjects = projects.filter((p) => !p.archived_at).length;
    const qrProjects = projects.filter((p) => p.channel_type === 'qr').length;
    const cloudApiProjects = projects.filter((p) => p.channel_type === 'cloud_api').length;

    // 2. Users Metrics & Roles breakdown
    const totalUsers = profiles.length;
    let totalSuperAdmins = 0;
    let totalAdmins = 0;
    let totalAgents = 0;

    for (const prof of profiles) {
      if (prof.platform_role === 'super_admin') {
        totalSuperAdmins++;
      } else if (prof.account_role === 'admin' || prof.account_role === 'owner' || prof.role === 'admin') {
        totalAdmins++;
      } else {
        totalAgents++;
      }
    }

    // 3. Connected Accounts Metrics
    // QR Sessions considered connected if status is 'paired' or 'ready' or phone_number is present
    const connectedQrSessions = qrSessions.filter(
      (s) => s.status === 'paired' || s.status === 'ready' || Boolean(s.phone_number),
    ).length;

    // Cloud API considered connected if phone_number_id is present
    const connectedCloudApi = whatsappConfigs.filter(
      (c) => Boolean(c.phone_number_id),
    ).length;

    const totalConnectedWhatsApp = connectedQrSessions + connectedCloudApi;

    // Instagram considered connected if status is 'connected' or username is present
    const totalConnectedInstagram = instagramConfigs.filter(
      (c) => c.status === 'connected' || Boolean(c.username),
    ).length;

    const totalConnectedAccounts = totalConnectedWhatsApp + totalConnectedInstagram;

    // 4. Recent Projects (Latest 5)
    const recentProjects = projects.slice(0, 5).map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      channel_type: p.channel_type,
      archived_at: p.archived_at,
      created_at: p.created_at,
    }));

    // 5. Recent Users (Latest 6)
    const recentUsers = profiles.slice(0, 6).map((p) => {
      const assignedProjects = userProjectMap.get(p.user_id) ?? [];
      const roleLabel =
        p.platform_role === 'super_admin'
          ? 'Super Admin'
          : p.account_role === 'admin' || p.account_role === 'owner' || p.role === 'admin'
          ? 'Admin'
          : 'Agent';

      return {
        id: p.id,
        user_id: p.user_id,
        email: p.email,
        full_name: p.full_name,
        role: roleLabel,
        projects: assignedProjects.length > 0 ? assignedProjects.join(', ') : 'All Projects',
        created_at: p.created_at,
      };
    });

    return NextResponse.json({
      metrics: {
        totalProjects,
        activeProjects,
        qrProjects,
        cloudApiProjects,
        totalUsers,
        totalSuperAdmins,
        totalAdmins,
        totalAgents,
        connectedWhatsApp: totalConnectedWhatsApp,
        connectedInstagram: totalConnectedInstagram,
        totalConnectedAccounts,
        totalConversations,
        totalMessages,
        pendingTemplates,
      },
      recentProjects,
      recentUsers,
    });
  } catch (err) {
    console.error('[GET /api/admin/stats] error:', err);
    return toErrorResponse(err);
  }
}
