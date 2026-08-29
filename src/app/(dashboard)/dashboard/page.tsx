"use client"

import { useAuth } from '@/hooks/use-auth'
import { CustomerDashboard } from '@/components/dashboard/customer-dashboard'
import { SuperAdminDashboard } from '@/components/dashboard/superadmin-dashboard'
import { AgentDashboard } from '@/components/dashboard/agent-dashboard'

export default function DashboardPage() {
  const { isSuperAdmin, canManageMembers } = useAuth()

  // 1. Platform Super Admin Dashboard
  if (isSuperAdmin) {
    return <SuperAdminDashboard />
  }

  // 2. Project / Organization Admin Dashboard (Owner & Admin roles)
  if (canManageMembers) {
    return <CustomerDashboard />
  }

  // 3. Dedicated Agent Operational Workstation (Agent role)
  return <AgentDashboard />
}

