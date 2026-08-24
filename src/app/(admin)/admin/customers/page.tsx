"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  created_at: string;
}

interface CreatedCredentials {
  email: string;
  password: string;
  role?: "agent" | "admin";
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
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminCustomersPage() {
  const t = useTranslations("Admin.customers");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Onboard form state
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");
  const [submitting, setSubmitting] = useState(false);

  // Projects list
  const [projects, setProjects] = useState<Project[]>([]);

  // Credential handover
  const [credentials, setCredentials] = useState<CreatedCredentials | null>(null);
  const [copied, setCopied] = useState(false);

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
      // Projects will be empty; the form will show a message.
    }
  }, []);

  useEffect(() => {
    loadCustomers();
    loadProjects();
  }, [loadCustomers, loadProjects]);

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setPassword("");
    setProjectId("");
    setRole("agent");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!email.trim()) {
      toast.error(t("emailRequired"));
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

      toast.success(t("created"));
      resetForm();
      setOpen(false);
      setCredentials(data.credentials);
      loadCustomers();
    } catch {
      toast.error(t("createError"));
    } finally {
      setSubmitting(false);
    }
  };

  const copyCredentials = () => {
    if (!credentials) return;
    const text = `Email: ${credentials.email}\nRole: ${credentials.role ?? 'customer'}\nPassword: ${credentials.password}\nLogin: ${credentials.signInUrl}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          {t("addCustomer")}
        </Button>
      </div>

      {/* Customer list */}
      <div className="rounded-xl border border-border bg-card">
        <div className="divide-y divide-border">
          {loading ? (
            <div className="flex items-center justify-center px-6 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : customers.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <UserRound className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("noCustomers")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("noCustomersHint")}</p>
            </div>
          ) : (
            customers.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-6 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                  {(c.full_name ?? c.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {c.full_name ?? "—"}
                    </p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                        c.role === "admin"
                          ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                          : "bg-primary/10 text-primary border border-primary/20"
                      )}
                    >
                      {c.role === "admin" ? "Admin" : "Agent"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                </div>
                <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                  <Calendar className="h-3.5 w-3.5" />
                  {fmtDate(c.created_at)}
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500">
                    Active
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Create customer dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
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
              <Label htmlFor="email">{t("emailLabel")} *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("passwordLabel")} *</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                minLength={MIN_PASSWORD_LEN}
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
            <div className="space-y-2">
              <Label>{t("project")} *</Label>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("noProjects")}
                </p>
              ) : (
                <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectProject")} />
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
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
                  <span className="text-sm font-medium text-foreground">{credentials.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Role:</span>
                  <span className="font-medium text-foreground capitalize">
                    {credentials.role ?? "customer"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{t("password")}:</span>
                  <code className="rounded bg-background px-2 py-0.5 text-sm font-mono">
                    {credentials.password}
                  </code>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={copyCredentials}>
                  {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
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
