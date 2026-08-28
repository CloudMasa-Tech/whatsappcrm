"use client"

import { useAuth } from '@/hooks/use-auth'
import { CustomerDashboard } from '@/components/dashboard/customer-dashboard'
import { SuperAdminDashboard } from '@/components/dashboard/superadmin-dashboard'

export default function DashboardPage() {
  const { isSuperAdmin } = useAuth()

  // Super Admins see the dedicated platform Super Admin Dashboard
  if (isSuperAdmin) {
    return <SuperAdminDashboard />
  }

  // All workspace users (customers, agents, admins) see the workspace dashboard
  return <CustomerDashboard />
}
