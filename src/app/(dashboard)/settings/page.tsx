'use client';

import { Suspense, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { CustomersTab } from '@/components/settings/customers-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { ProjectsSettings } from '@/components/settings/projects-settings';
import { EmailConfigPanel } from '@/components/settings/email-config';
import {
  resolveSection,
  SECTION_META,
  type SettingsSection,
} from '@/components/settings/settings-sections';

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary. Without one, the production build hits
// the "missing Suspense with CSR bailout" error and the whole page bails
// to client-side rendering — shipping a settings screen whose rail never
// wires up its click handlers. You land on the section the URL carried
// (the account-menu Settings link points at `?tab=whatsapp`) and can't
// navigate away. Mirror the login/signup split: a thin wrapper supplies
// the boundary; the inner component reads the query string.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, canEditSettings, canManageCustomers, isAgent, isAdmin, isSuperAdmin } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  const raw = resolveSection(searchParams.get('tab'));
  const isAgentUser = isAgent && !isAdmin && !isSuperAdmin;

  // Agents cannot access platform-admin or project-workspace settings sections.
  // If they land on one via URL, redirect to overview.
  const section: SettingsSection =
    raw === 'customers' && !canManageCustomers ? 'overview' :
    isAgentUser && SECTION_META[raw]?.group === 'workspace' ? 'overview' :
    raw;

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    projects: isAgentUser ? <SettingsOverview onSelect={go} /> : <ProjectsSettings canManage={canEditSettings} />,
    whatsapp: isAgentUser ? <SettingsOverview onSelect={go} /> : <WhatsAppConfig />,
    email: isAgentUser ? <SettingsOverview onSelect={go} /> : <EmailConfigPanel />,
    templates: isAgentUser ? <SettingsOverview onSelect={go} /> : <TemplateManager />,
    'quick-replies': isAgentUser ? <SettingsOverview onSelect={go} /> : <QuickRepliesManager />,
    fields: isAgentUser ? <SettingsOverview onSelect={go} /> : <FieldsAndTagsPanel />,
    deals: isAgentUser ? <SettingsOverview onSelect={go} /> : <DealsSettings />,
    members: isAgentUser ? <SettingsOverview onSelect={go} /> : <MembersTab />,
    customers: canManageCustomers ? <CustomersTab /> : <SettingsOverview onSelect={go} />,
    api: isAgentUser ? <SettingsOverview onSelect={go} /> : <ApiKeysSettings />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('pageDesc')}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail
          active={section}
          onSelect={go}
          hints={hints}
          canManageCustomers={canManageCustomers}
          isCustomer={isAgentUser}
        />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}
