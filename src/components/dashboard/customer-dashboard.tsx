"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  MessageSquare,
  Users,
  Radio,
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  AlertTriangle,
  QrCode,
  Wifi,
} from 'lucide-react'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBroadcastStatus } from '@/lib/broadcast-status'
import type { Broadcast } from '@/types'

type SessionStatus =
  | "disconnected"
  | "qr_pending"
  | "connecting"
  | "connected"
  | "logged_out"
  | "banned"
  | "error"
  | null

export function CustomerDashboard() {
  const t = useTranslations('CustomerDashboard')
  const tStatus = useTranslations('Broadcasts.status')
  const router = useRouter()
  const { activeProjectId, activeProjectChannel } = useAuth()

  const [whatsappStatus, setWhatsappStatus] = useState<SessionStatus>(null)
  const [whatsappLoading, setWhatsappLoading] = useState(true)
  const [contactsCount, setContactsCount] = useState(0)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [totalCampaigns, setTotalCampaigns] = useState(0)
  const [sentCampaigns, setSentCampaigns] = useState(0)
  const [totalRecipients, setTotalRecipients] = useState(0)
  const [deliveredCount, setDeliveredCount] = useState(0)
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [recentCampaigns, setRecentCampaigns] = useState<Broadcast[]>([])
  const [recentLoading, setRecentLoading] = useState(true)

  const loadAll = useCallback(async () => {
    if (!activeProjectId) {
      // No project yet — skip data queries but make sure loading
      // states resolve so the UI (e.g. "Connect WhatsApp" button) can
      // render instead of spinning forever.
      setWhatsappLoading(false)
      setContactsLoading(false)
      setCampaignsLoading(false)
      setRecentLoading(false)
      return
    }
    const db = createClient()

    // WhatsApp status
    setWhatsappLoading(true)
    try {
      if (activeProjectChannel === 'qr') {
        const res = await fetch(`/api/whatsapp/qr?project_id=${encodeURIComponent(activeProjectId)}`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setWhatsappStatus(data.session?.status ?? null)
        }
      } else {
        const res = await fetch('/api/whatsapp/config', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setWhatsappStatus(data.connected ? 'connected' : 'disconnected')
        }
      }
    } catch {
      setWhatsappStatus('disconnected')
    } finally {
      setWhatsappLoading(false)
    }

    // Contacts count
    setContactsLoading(true)
    try {
      const { count } = await db
        .from('contacts')
        .select('id', { count: 'exact', head: true })
      setContactsCount(count ?? 0)
    } catch {
      // ignore
    } finally {
      setContactsLoading(false)
    }

    // Campaigns summary
    setCampaignsLoading(true)
    try {
      const { data: broadcasts } = await db
        .from('broadcasts')
        .select('id, status, total_recipients, delivered_count, sent_count, failed_count')
      if (broadcasts) {
        setTotalCampaigns(broadcasts.length)
        setSentCampaigns(broadcasts.filter((b) => b.status === 'sent' || b.status === 'completed').length)
        setTotalRecipients(broadcasts.reduce((sum, b) => sum + (b.total_recipients ?? 0), 0))
        setDeliveredCount(broadcasts.reduce((sum, b) => sum + (b.delivered_count ?? 0), 0))
      }
    } catch {
      // ignore
    } finally {
      setCampaignsLoading(false)
    }

    // Recent campaigns
    setRecentLoading(true)
    try {
      const { data: recent } = await db
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)
      setRecentCampaigns(recent ?? [])
    } catch {
      // ignore
    } finally {
      setRecentLoading(false)
    }
  }, [activeProjectId, activeProjectChannel])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const isWhatsAppConnected = whatsappStatus === 'connected'

  // No project assigned — admin needs to provision one.
  if (!activeProjectId) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-foreground">{t('noProjectAssigned')}</p>
              <p className="text-xs text-muted-foreground">{t('noProjectAssignedHint')}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('description')}
        </p>
      </div>

      {/* WhatsApp Connection Status Card */}
      <Card className={isWhatsAppConnected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            {whatsappLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : isWhatsAppConnected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                {whatsappLoading ? t('checkingWhatsApp') : isWhatsAppConnected ? t('whatsappConnected') : t('whatsappNotConnected')}
              </p>
              <p className="text-xs text-muted-foreground">
                {activeProjectChannel === 'qr' ? t('methodQR') : t('methodMeta')}
              </p>
            </div>
          </div>
          {!isWhatsAppConnected && !whatsappLoading && (
            <Button
              size="sm"
              onClick={() => router.push('/whatsapp')}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {t('connectWhatsApp')}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {contactsLoading ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title={t('totalContacts')}
            value={contactsCount.toLocaleString()}
            icon={Users}
          />
        )}
        {campaignsLoading ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title={t('totalCampaigns')}
            value={totalCampaigns.toLocaleString()}
            icon={Radio}
          />
        )}
        {campaignsLoading ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title={t('messagesSent')}
            value={totalRecipients.toLocaleString()}
            icon={Send}
          />
        )}
        {campaignsLoading ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title={t('delivered')}
            value={deliveredCount.toLocaleString()}
            icon={CheckCircle2}
          />
        )}
      </div>

      {/* Recent Campaigns */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-medium text-foreground">{t('recentCampaigns')}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/broadcasts')}
            className="text-muted-foreground hover:text-foreground"
          >
            {t('viewAll')}
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {recentLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : recentCampaigns.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <Radio className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('noCampaignsYet')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentCampaigns.map((bc) => {
                const status = getBroadcastStatus(bc.status)
                return (
                  <div
                    key={bc.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50 cursor-pointer"
                    onClick={() => router.push(`/broadcasts/${bc.id}`)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{bc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {bc.total_recipients} {t('recipients')} · {new Date(bc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`ml-3 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                    >
                      {tStatus(status.label)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
