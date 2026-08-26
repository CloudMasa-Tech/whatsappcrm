'use client';

// ============================================================
// CustomersTab — Settings → Customers
//
// Admin-only. Onboards a NEW customer into the admin's account,
// assigning them to a specific project via project_members.
//
// The customer's profile is placed in the ADMIN's account
// (same account_id), NOT in a new isolated account. The
// handle_new_user trigger skips account/project/profile creation
// when it sees created_by_admin = true in user_metadata.
//
// Flow:
//   1. Dialog — name / email / password / project → POST /api/admin/users.
//   2. Result — the credentials come back ONCE for handover (same
//               spirit as the one-time invite link).
//
// The list is fetched via GET /api/admin/users (RLS-scoped to the
// onboarding admin's account).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, FolderKanban, Loader2, Plus, UserRound, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { RequireRole } from '@/components/auth/require-role';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { cn } from '@/lib/utils';

interface Customer {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  project_id: string | null;
  project_name?: string | null;
  project?: {
    id: string;
    name: string;
    slug?: string;
    channel_type?: string;
  } | null;
  role?: 'agent' | 'admin';
  created_at: string;
}

interface CreatedCredentials {
  email: string;
  password: string;
  role?: 'agent' | 'admin';
  signInUrl: string;
}

interface Project {
  id: string;
  name: string;
  channel_type: string;
  allowed_channels: string[];
  archived_at: string | null;
}

// Mirrors the server's minimums so a bad submit never round-trips.
const MIN_PASSWORD_LEN = 8;
const MAX_NAME_LEN = 80;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function CustomersTab() {
  const t = useTranslations('Settings.customers');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Onboard form state.
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<'agent' | 'admin'>('agent');
  const [submitting, setSubmitting] = useState(false);

  // Projects list.
  const [projects, setProjects] = useState<Project[]>([]);

  // One-time credential handover.
  const [created, setCreated] = useState<CreatedCredentials | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('loadError'));
        return;
      }
      const data = (await res.json()) as { customers: Customer[] };
      setCustomers(data.customers);
    } catch (err) {
      console.error('[CustomersTab] load error:', err);
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { projects: Project[] };
      setProjects(data.projects);
    } catch {
      // Projects will be empty; the form will show a message.
    }
  }, []);

  useEffect(() => {
    void load();
    void loadProjects();
  }, [load, loadProjects]);

  function resetForm() {
    setFullName('');
    setEmail('');
    setPassword('');
    setProjectId('');
    setRole('agent');
    setSubmitting(false);
  }

  async function handleCreate() {
    if (password.length < MIN_PASSWORD_LEN) {
      toast.error(t('passwordTooShort', { min: MIN_PASSWORD_LEN }));
      return;
    }
    if (!projectId) {
      toast.error(t('projectRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          fullName: fullName.trim() ? fullName.trim() : undefined,
          projectId,
          role,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('createError'));
        return;
      }
      setCreated({
        email: payload.credentials?.email ?? email,
        password: payload.credentials?.password ?? password,
        role: payload.credentials?.role ?? role,
        signInUrl: payload.signInUrl ?? '/login',
      });
      setOpen(false);
      resetForm();
      void load();
    } catch (err) {
      console.error('[CustomersTab] create error:', err);
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCredentials() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(
        `${t('email')}: ${created.email}\n${t('password')}: ${created.password}\n${t('signInUrl')}: ${created.signInUrl}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[CustomersTab] copy error:', err);
      toast.error(t('copyError'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <RequireRole min="admin">
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              {t('onboard')}
            </Button>
          </RequireRole>
        }
      />

      {customers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <UserPlus className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              {t('emptyTitle')}
            </p>
            <p className="mt-1 max-w-[42ch] text-xs text-muted-foreground">
              {t('emptyDesc')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {customers.map((customer) => {
                const projectName =
                  customer.project_name ||
                  customer.project?.name ||
                  projects.find((p) => p.id === customer.project_id)?.name ||
                  null;

                return (
                  <li
                    key={customer.id}
                    className="flex items-center gap-4 px-4 py-3.5"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <UserRound className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {customer.full_name || customer.email}
                        </p>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                            customer.role === "admin"
                              ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                              : "bg-primary/10 text-primary border border-primary/20"
                          )}
                        >
                          {customer.role === "admin" ? "Admin" : "Agent"}
                        </span>
                        {projectName ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-foreground">
                            <FolderKanban className="size-3 text-primary shrink-0" />
                            {projectName}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                            No project
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground mt-0.5">
                        {customer.full_name ? customer.email : t('unnamed')}
                        {projectName && (
                          <>
                            {' · '}
                            <span className="font-medium text-foreground/80">
                              Project: {projectName}
                            </span>
                          </>
                        )}
                        {' · '}
                        {t('created', { date: fmtDate(customer.created_at) })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Onboard dialog */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetForm();
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('onboardDialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('onboardDialogDesc')}
            </DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="customer-name">{t('fullName')}</Label>
              <Input
                id="customer-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={MAX_NAME_LEN}
                placeholder={t('fullNamePlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-email">{t('email')}</Label>
              <Input
                id="customer-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-password">{t('password')}</Label>
              <Input
                id="customer-password"
                type="password"
                required
                minLength={MIN_PASSWORD_LEN}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('passwordPlaceholder', { min: MIN_PASSWORD_LEN })}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                {t('passwordHint')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-role">Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole((v as 'agent' | 'admin') ?? 'agent')}
              >
                <SelectTrigger id="customer-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">
                    <div className="flex flex-col text-left py-0.5">
                      <span className="font-medium text-foreground">Agent</span>
                      <span className="text-xs text-muted-foreground">
                        Can send messages & campaigns (cannot disconnect channels)
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex flex-col text-left py-0.5">
                      <span className="font-medium text-foreground">Admin</span>
                      <span className="text-xs text-muted-foreground">
                        Full project configuration, channels, and settings
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('project')}</Label>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('noProjects')}
                </p>
              ) : (
                <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('selectProject')} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects
                      .filter((p) => !p.archived_at)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('creating')}
                  </>
                ) : (
                  t('onboard')
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* One-time credential handover */}
      <Dialog open={created !== null} onOpenChange={() => setCreated(null)}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('successTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('successDesc')}
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="rounded-lg border border-border bg-muted p-4">
              <dl className="grid gap-3 text-sm">
                <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">{t('email')}</dt>
                  <dd className="truncate font-medium text-foreground">
                    {created.email}
                  </dd>
                </div>
                <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">Role</dt>
                  <dd className="font-medium text-foreground capitalize">
                    {created.role ?? 'customer'}
                  </dd>
                </div>
                <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">{t('password')}</dt>
                  <dd className="font-medium text-foreground">
                    {created.password}
                  </dd>
                </div>
                <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">{t('signInUrl')}</dt>
                  <dd className="truncate text-foreground">{created.signInUrl}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreated(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('done')}
            </Button>
            <Button onClick={() => void copyCredentials()}>
              {copied ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? t('copied') : t('copyCredentials')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
