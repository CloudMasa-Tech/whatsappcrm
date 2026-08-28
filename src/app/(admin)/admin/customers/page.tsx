"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  UserPlus,
  Loader2,
  Copy,
  Check,
  UserRound,
  Mail,
  Calendar,
  ExternalLink,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  Filter,
  X,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Customer {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role?: "agent" | "admin";
  project_id?: string | null;
  project_name?: string | null;
  created_at: string;
}

interface CreatedCredentials {
  email: string;
  password: string;
  role?: "agent" | "admin";
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

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MIN_PASSWORD_LEN = 8;
const MAX_NAME_LEN = 80;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminCustomersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AdminCustomersContent />
    </Suspense>
  );
}

function AdminCustomersContent() {
  const t = useTranslations("Admin.customers");
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId") || "all";
  const shouldAutoOpenAdd =
    searchParams.get("action") === "add" || searchParams.get("add") === "true";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Project filtering state
  const [selectedProjectFilter, setSelectedProjectFilter] =
    useState<string>(initialProjectId);

  // Onboard form state
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");
  const [submitting, setSubmitting] = useState(false);

  // Deletion state
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Projects list
  const [projects, setProjects] = useState<Project[]>([]);

  // Credential handover
  const [credentials, setCredentials] = useState<CreatedCredentials | null>(null);
  const [copied, setCopied] = useState(false);

  const isEmailValid = EMAIL_RE.test(email.trim());

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setCustomers(data.customers ?? []);
    } catch (err) {
      console.error("[admin/customers] load error:", err);
      toast.error(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      // Projects will be empty
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
    void loadProjects();
  }, [loadCustomers, loadProjects]);

  // Handle URL query parameters to auto-filter and auto-open dialog
  useEffect(() => {
    const pId = searchParams.get("projectId");
    if (pId) {
      setSelectedProjectFilter(pId);
    }
    if (shouldAutoOpenAdd) {
      if (pId) setProjectId(pId);
      setOpen(true);
    }
  }, [searchParams, shouldAutoOpenAdd]);

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    if (!selectedProjectFilter || selectedProjectFilter === "all") {
      return customers;
    }
    return customers.filter((c) => c.project_id === selectedProjectFilter);
  }, [customers, selectedProjectFilter]);

  const activeFilteredProject = useMemo(() => {
    if (!selectedProjectFilter || selectedProjectFilter === "all") return null;
    return projects.find((p) => p.id === selectedProjectFilter) || null;
  }, [projects, selectedProjectFilter]);

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setEmailTouched(false);
    setPassword("");
    setProjectId("");
    setRole("agent");
  };

  const handleOpenAddCustomer = () => {
    resetForm();
    if (selectedProjectFilter && selectedProjectFilter !== "all") {
      setProjectId(selectedProjectFilter);
    } else if (projects.length > 0) {
      setProjectId(projects[0].id);
    }
    setOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!email.trim() || !isEmailValid) {
      toast.error("Please provide a valid email address");
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      toast.error(t("passwordTooShort", { min: MIN_PASSWORD_LEN }));
      return;
    }
    if (!projectId) {
      toast.error(t("projectRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          fullName: fullName.trim() || undefined,
          projectId,
          role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? t("createError"));
        return;
      }

      toast.success(t("created") + " & welcome email sent to user!");
      resetForm();
      setOpen(false);
      setCredentials(data.credentials);
      void loadCustomers();
    } catch {
      toast.error(t("createError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCustomer = async () => {
    if (!customerToDelete || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/users?userId=${encodeURIComponent(customerToDelete.user_id)}&id=${encodeURIComponent(customerToDelete.id)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Failed to delete customer");
        return;
      }
      toast.success("Customer account deleted successfully");
      setCustomerToDelete(null);
      void loadCustomers();
    } catch (err) {
      console.error("[handleDeleteCustomer] error:", err);
      toast.error("Network error while deleting customer");
    } finally {
      setDeleting(false);
    }
  };

  const copyCredentials = () => {
    if (!credentials) return;
    const text = `Email: ${credentials.email}\nRole: ${credentials.role ?? "agent"}\nProject: ${credentials.projectName ?? ""}\nPassword: ${credentials.password}\nLogin: ${credentials.signInUrl}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Button onClick={handleOpenAddCustomer} className="self-start sm:self-auto gap-2">
          <UserPlus className="h-4 w-4" />
          {t("addCustomer")}
        </Button>
      </div>

      {/* Project Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <Filter className="h-3.5 w-3.5 text-primary" />
            <span>Filter By Project:</span>
          </div>
          <Select
            value={selectedProjectFilter}
            onValueChange={(val) => setSelectedProjectFilter(val ?? "all")}
          >
            <SelectTrigger className="h-9 w-[220px] text-xs">
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
              Showing users for{" "}
              <strong className="text-foreground">{activeFilteredProject.name}</strong>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedProjectFilter("all")}
              className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
            >
              <X className="mr-1 h-3 w-3" />
              Clear Filter
            </Button>
          </div>
        )}
      </div>

      {/* Customer list */}
      <div className="rounded-xl border border-border bg-card">
        <div className="divide-y divide-border">
          {loading ? (
            <div className="flex items-center justify-center px-6 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <UserRound className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {activeFilteredProject
                  ? `No customers found for project "${activeFilteredProject.name}"`
                  : t("noCustomers")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeFilteredProject
                  ? "Click Add Customer above to create the first user for this project."
                  : t("noCustomersHint")}
              </p>
              {activeFilteredProject && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenAddCustomer}
                  className="mt-4"
                >
                  <UserPlus className="mr-2 h-3.5 w-3.5" />
                  Add User to {activeFilteredProject.name}
                </Button>
              )}
            </div>
          ) : (
            filteredCustomers.map((c) => {
              const pName =
                c.project_name ||
                projects.find((p) => p.id === c.project_id)?.name ||
                null;
              return (
                <div
                  key={c.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {c.full_name || t("unnamed")}
                        </p>
                        <Badge
                          className={cn(
                            "text-[10px] px-2 py-0 capitalize",
                            c.role === "admin"
                              ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                              : "bg-primary/10 text-primary border border-primary/20"
                          )}
                        >
                          {c.role === "admin" ? "Admin" : "Agent"}
                        </Badge>
                        {pName ? (
                          <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-foreground font-medium border border-border">
                            <FolderKanban className="h-3 w-3 text-primary" />
                            {pName}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground border border-border/50">
                            No project
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground font-mono mt-0.5">
                        {c.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                      <Calendar className="h-3.5 w-3.5" />
                      {fmtDate(c.created_at)}
                    </div>
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500">
                      Active
                    </span>

                    {/* Delete Customer Button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCustomerToDelete(c)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete Customer Account"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Delete Customer Confirmation Dialog */}
      <Dialog
        open={Boolean(customerToDelete)}
        onOpenChange={(openState) => {
          if (!openState) setCustomerToDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Customer Account
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <span className="block">
                Are you sure you want to permanently delete{" "}
                <strong className="text-foreground">
                  {customerToDelete?.full_name || customerToDelete?.email}
                </strong>
                ?
              </span>
              <span className="block text-xs text-muted-foreground">
                This will delete their user profile, remove all project assignments, and completely revoke their CRM login access.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCustomerToDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteCustomer}
              disabled={deleting}
              className="gap-1.5"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete Account
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create customer dialog */}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>
              {activeFilteredProject
                ? `Creating user for project "${activeFilteredProject.name}" by default.`
                : t("createDescription")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            {/* Target Project (Pre-selected by default) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="project-select">{t("project")} *</Label>
                {activeFilteredProject && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                    Project Default Selected
                  </Badge>
                )}
              </div>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("noProjects")}
                </p>
              ) : (
                <Select
                  value={projectId}
                  onValueChange={(v) => setProjectId(v ?? "")}
                >
                  <SelectTrigger id="project-select">
                    <SelectValue placeholder={t("selectProject")} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects
                      .filter((p) => !p.archived_at)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex items-center gap-2">
                            <span>{p.name}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              ({p.channel_type === "qr" ? "QR Code" : "Cloud API"})
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="fullName">{t("nameLabel")}</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={MAX_NAME_LEN}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="email">{t("emailLabel")} *</Label>
                {emailTouched && (
                  <span
                    className={cn(
                      "text-[11px] flex items-center gap-1",
                      isEmailValid ? "text-emerald-500" : "text-destructive"
                    )}
                  >
                    {isEmailValid ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" /> Valid email
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3 w-3" /> Invalid email format
                      </>
                    )}
                  </span>
                )}
              </div>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (!emailTouched) setEmailTouched(true);
                }}
                onBlur={() => setEmailTouched(true)}
                placeholder="name@example.com"
                className={cn(
                  emailTouched &&
                    !isEmailValid &&
                    "border-destructive focus-visible:ring-destructive"
                )}
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("passwordLabel")} *</Label>
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
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                minLength={MIN_PASSWORD_LEN}
                className="font-mono text-sm"
                required
              />
              <p className="text-xs text-muted-foreground">
                {t("passwordHint", { min: MIN_PASSWORD_LEN })}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role *</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole((v as "agent" | "admin") ?? "agent")}
              >
                <SelectTrigger id="role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">
                    <div className="flex flex-col text-left py-0.5">
                      <span className="font-medium text-foreground">Agent</span>
                      <span className="text-xs text-muted-foreground">
                        Can send messages, manage inbox & deals (cannot edit project settings)
                      </span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex flex-col text-left py-0.5">
                      <span className="font-medium text-foreground">Admin</span>
                      <span className="text-xs text-muted-foreground">
                        Full project management, connect WhatsApp QR / Instagram, pipelines & settings
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground flex items-start gap-2">
              <Mail className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>
                A welcome email with login credentials and access instructions will be sent to the user's email address upon creation.
              </span>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={submitting || (emailTouched && !isEmailValid)}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Credential handover dialog */}
      <Dialog open={!!credentials} onOpenChange={() => setCredentials(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("credentialsTitle")}</DialogTitle>
            <DialogDescription>{t("credentialsDescription")}</DialogDescription>
          </DialogHeader>
          {credentials && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">
                    {credentials.email}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Role:</span>
                  <span className="font-medium text-foreground capitalize">
                    {credentials.role ?? "agent"}
                  </span>
                </div>
                {credentials.projectName && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Project:</span>
                    <span className="font-semibold text-primary">
                      {credentials.projectName}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{t("password")}:</span>
                  <code className="rounded bg-background px-2 py-0.5 text-sm font-mono">
                    {credentials.password}
                  </code>
                </div>
              </div>

              <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Onboarding details and sign-in credentials have been sent to{" "}
                  <strong>{credentials.email}</strong>.
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={copyCredentials}>
                  {copied ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  {copied ? t("copied") : t("copyCredentials")}
                </Button>
                <a
                  href={credentials.signInUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("openLogin")}
                </a>
              </div>
              <p className="text-xs text-muted-foreground">{t("credentialsWarning")}</p>
              <DialogFooter>
                <Button onClick={() => setCredentials(null)}>{t("done")}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
