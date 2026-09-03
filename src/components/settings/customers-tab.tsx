'use client';

// ============================================================
// CustomersTab — Settings → Customers
//
// Admin-only. Onboards a NEW customer into the admin's account,
// assigning them to a specific project via project_members.
//
// Flow:
//   1. Filter by Project or view All.
//   2. Dialog — name / email / password / project (pre-selected to
//      active project filter) → POST /api/admin/users.
//   3. Result — credentials handover modal.
//   4. Delete — permanently delete customer account via DELETE /api/admin/users.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Copy,
  FolderKanban,
  Loader2,
  Plus,
  UserRound,
  UserPlus,
  Filter,
  X,
  Trash2,
  Mail,
  Shield,
  CheckCircle2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { RequireRole } from '@/components/auth/require-role';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  is_default_admin?: boolean;
  created_at: string;
}

interface CreatedCredentials {
  email: string;
  password: string;
  role?: 'agent' | 'admin';
  projectName?: string;
  signInUrl: string;
}

interface Project {
  id: string;
  name: string;
  channel_type: string;
  allowed_channels: string[];
  archived_at: string | null;
}

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

  // Project filtering
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('all');

  // Onboard form state
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<'agent' | 'admin'>('agent');
  const [submitting, setSubmitting] = useState(false);

  // Delete customer state
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resendingFor, setResendingFor] = useState<string | null>(null);

  // Projects list
  const [projects, setProjects] = useState<Project[]>([]);

  // One-time credential handover
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
      setCustomers(data.customers ?? []);
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
      setProjects(data.projects ?? []);
    } catch {
      // Projects will be empty
    }
  }, []);

  useEffect(() => {
    void load();
    void loadProjects();
  }, [load, loadProjects]);

  const filteredCustomers = useMemo(() => {
    if (!selectedProjectFilter || selectedProjectFilter === 'all') {
      return customers;
    }
    return customers.filter((c) => c.project_id === selectedProjectFilter);
  }, [customers, selectedProjectFilter]);

  const activeFilteredProject = useMemo(() => {
    if (!selectedProjectFilter || selectedProjectFilter === 'all') return null;
    return projects.find((p) => p.id === selectedProjectFilter) || null;
  }, [projects, selectedProjectFilter]);

  function resetForm() {
    setFullName('');
    setEmail('');
    setPassword('');
    setProjectId('');
    setRole('agent');
    setSubmitting(false);
  }

  function handleOpenDialog() {
    resetForm();
    if (selectedProjectFilter && selectedProjectFilter !== 'all') {
      setProjectId(selectedProjectFilter);
    } else if (projects.length > 0) {
      setProjectId(projects[0].id);
    }
    setOpen(true);
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
          email: email.trim().toLowerCase(),
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

      if (payload.emailError) {
        toast.warning(`${t('created')}, but email delivery failed: ${payload.emailError}`);
      } else {
        toast.success(t('created') + ' & welcome email sent to user!');
      }

      setCreated({
        email: payload.credentials?.email ?? email,
        password: payload.credentials?.password ?? password,
        role: payload.credentials?.role ?? role,
        projectName: payload.credentials?.projectName,
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

  async function handleResendEmail(customer: Customer) {
    try {
      setResendingFor(customer.user_id);
      const res = await fetch('/api/admin/users/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: customer.user_id,
          customerId: customer.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to send welcome email');
        return;
      }
      toast.success(`Welcome email delivered to ${customer.email}!`);
      if (data.temporaryPassword) {
        setCreated({
          email: customer.email,
          password: data.temporaryPassword,
          role: customer.role,
          projectName: data.projectName || 'Assigned Workspace',
          signInUrl: data.signInUrl || `${window.location.origin}/login`,
        });
      }
    } catch {
      toast.error('Network error while sending welcome email');
    } finally {
      setResendingFor(null);
    }
  }

  async function handleDeleteCustomer() {
    if (!customerToDelete || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/users?userId=${encodeURIComponent(customerToDelete.user_id)}&id=${encodeURIComponent(customerToDelete.id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to delete customer');
        return;
      }
      toast.success('Customer account deleted successfully');
      setCustomerToDelete(null);
      void load();
    } catch (err) {
      console.error('[handleDeleteCustomer] error:', err);
      toast.error('Network error while deleting customer');
    } finally {
      setDeleting(false);
    }
  }

  async function copyCredentials() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(
        `${t('email')}: ${created.email}\nProject: ${created.projectName ?? ''}\n${t('password')}: ${created.password}\n${t('signInUrl')}: ${created.signInUrl}`,
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
            <Button onClick={handleOpenDialog}>
              <Plus className="size-4" />
              {t('onboard')}
            </Button>
          </RequireRole>
        }
      />

      {/* Project Filter Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <Filter className="h-3.5 w-3.5 text-primary" />
            <span>Filter by Project:</span>
          </div>
          <Select
            value={selectedProjectFilter}
            onValueChange={(val) => setSelectedProjectFilter(val ?? 'all')}
          >
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                All Projects ({customers.length})
              </SelectItem>
              {projects.map((p) => {
                const count = customers.filter((c) => c.project_id === p.id).length;
                return (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {activeFilteredProject && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Showing users for{' '}
              <strong className="text-foreground">{activeFilteredProject.name}</strong>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedProjectFilter('all')}
              className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
            >
              <X className="mr-1 h-3 w-3" />
              Clear Filter
            </Button>
          </div>
        )}
      </div>

      {filteredCustomers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <UserPlus className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {activeFilteredProject
                ? `No customers found for project "${activeFilteredProject.name}"`
                : t('emptyTitle')}
            </p>
            <p className="mt-1 max-w-[42ch] text-xs text-muted-foreground">
              {activeFilteredProject
                ? 'Create a customer to assign them directly to this project.'
                : t('emptyDesc')}
            </p>
            {activeFilteredProject && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenDialog}
                className="mt-4"
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Add User to {activeFilteredProject.name}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {filteredCustomers.map((customer) => {
                const projectName =
                  customer.project_name ||
                  customer.project?.name ||
                  projects.find((p) => p.id === customer.project_id)?.name ||
                  null;

                return (
                  <li
                    key={customer.id}
                    className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                        <UserRound className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {customer.full_name || customer.email}
                          </p>
                          {customer.is_default_admin ? (
                            <Badge className="text-[10px] px-2 py-0 capitalize bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30 flex items-center gap-1">
                              <Shield className="size-3 text-purple-500" />
                              Default Admin
                            </Badge>
                          ) : (
                            <Badge
                              className={cn(
                                "text-[10px] px-2 py-0 capitalize",
                                customer.role === "admin"
                                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                                  : "bg-primary/10 text-primary border border-primary/20"
                              )}
                            >
                              {customer.role === "admin" ? "Admin" : "Agent"}
                            </Badge>
                          )}
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
                        <p className="truncate text-xs text-muted-foreground mt-0.5 font-mono">
                          {customer.email}
                          {' · '}
                          {t('created', { date: fmtDate(customer.created_at) })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Resend Welcome Email Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleResendEmail(customer)}
                        disabled={resendingFor === customer.user_id}
                        className="size-8 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                        title="Resend Welcome & Credentials Email"
                      >
                        {resendingFor === customer.user_id ? (
                          <Loader2 className="size-4 animate-spin text-primary" />
                        ) : (
                          <Mail className="size-4" />
                        )}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCustomerToDelete(customer)}
                        className="size-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Delete Customer Account"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Delete Customer Confirmation Dialog */}
      <Dialog
        open={Boolean(customerToDelete)}
        onOpenChange={(openState) => {
          if (!openState) setCustomerToDelete(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-5" />
              Delete Customer Account
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-2 text-muted-foreground">
              <span className="block">
                Are you sure you want to delete{' '}
                <strong className="text-foreground">
                  {customerToDelete?.full_name || customerToDelete?.email}
                </strong>
                ?
              </span>
              <span className="block text-xs">
                This will delete their user profile, remove their project assignments, and completely revoke their CRM login access.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCustomerToDelete(null)}
              disabled={deleting}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteCustomer()}
              disabled={deleting}
              className="gap-1.5"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="size-4" />
                  Delete Account
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {activeFilteredProject
                ? `Creating user for project "${activeFilteredProject.name}" by default.`
                : t('onboardDialogDesc')}
            </DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            {/* Target Project */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="customer-project">{t('project')} *</Label>
                {activeFilteredProject && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                    Project Default Selected
                  </Badge>
                )}
              </div>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('noProjects')}
                </p>
              ) : (
                <Select
                  value={projectId}
                  onValueChange={(v) => setProjectId(v ?? "")}
                >
                  <SelectTrigger id="customer-project">
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
              <Label htmlFor="customer-email">{t('email')} *</Label>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="customer-password">{t('password')} *</Label>
                <button
                  type="button"
                  onClick={() => {
                    const rand = Math.random().toString(36).slice(-8) + "Aa1!";
                    setPassword(rand);
                  }}
                  className="text-[11px] text-primary hover:underline"
                >
                  Generate Secure
                </button>
              </div>
              <Input
                id="customer-password"
                type="text"
                required
                minLength={MIN_PASSWORD_LEN}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('passwordPlaceholder', { min: MIN_PASSWORD_LEN })}
                className="font-mono text-sm"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t('passwordHint')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-role">Role *</Label>
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

      {/* Credential handover dialog */}
      <Dialog
        open={Boolean(created)}
        onOpenChange={(next) => {
          if (!next) setCreated(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('credentialsTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('credentialsDesc')}
            </DialogDescription>
          </DialogHeader>

          {created && (
            <div className="grid gap-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3.5 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('email')}:</span>
                  <span className="font-semibold text-foreground">{created.email}</span>
                </div>
                {created.projectName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Project:</span>
                    <span className="font-semibold text-primary">{created.projectName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Role:</span>
                  <Badge variant="outline" className="capitalize text-[10px]">
                    {created.role}
                  </Badge>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-border">
                  <span className="text-muted-foreground">{t('password')}:</span>
                  <code className="rounded bg-background px-2 py-0.5 font-mono font-bold text-primary border border-border">
                    {created.password}
                  </code>
                </div>
              </div>

              <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Login instructions and temporary credentials have been dispatched.</span>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => void copyCredentials()}
              className="gap-1.5"
            >
              <Copy className="size-4" />
              {copied ? t('copied') : t('copy')}
            </Button>
            <Button onClick={() => setCreated(null)}>
              {t('done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
