"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FolderKanban,
  FolderPlus,
  Loader2,
  MessageSquare,
  Radio,
  Trash2,
  Users,
  UserPlus,
  Copy,
  Check,
  Mail,
  ExternalLink,
  ShieldCheck,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DeleteProjectDialog,
  type ProjectToDelete,
} from "@/components/projects/delete-project-dialog";
import { cn } from "@/lib/utils";

interface ProjectMember {
  user_id: string;
  full_name: string | null;
  email: string;
  role: "admin" | "agent";
}

interface Project {
  id: string;
  name: string;
  slug: string;
  channel_type: "qr" | "cloud_api";
  account_name: string;
  created_at: string;
  members: ProjectMember[];
}

interface CreatedCredentials {
  email: string;
  password: string;
  role?: "agent" | "admin";
  projectName?: string;
  signInUrl: string;
}

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MIN_PASSWORD_LEN = 8;
const MAX_NAME_LEN = 80;

export default function AdminProjectsPage() {
  const t = useTranslations("Admin.projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<ProjectToDelete | null>(null);

  // Add Customer modal for a specific project
  const [targetProject, setTargetProject] = useState<Project | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");
  const [submitting, setSubmitting] = useState(false);

  // Delete customer modal
  const [memberToDelete, setMemberToDelete] = useState<{ member: ProjectMember; projectName: string } | null>(null);
  const [deletingMember, setDeletingMember] = useState(false);

  // Create Project modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectChannel, setNewProjectChannel] = useState<"qr" | "cloud_api">("qr");
  const [creatingProject, setCreatingProject] = useState(false);

  // Credential handover
  const [credentials, setCredentials] = useState<CreatedCredentials | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || creatingProject) return;

    setCreatingProject(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjectName.trim(),
          channel_type: newProjectChannel,
          allowed_channels: [newProjectChannel],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create project");
        return;
      }

      toast.success(`Project "${newProjectName.trim()}" created successfully!`);
      setIsCreateOpen(false);
      setNewProjectName("");
      setNewProjectChannel("qr");
      void load();
    } catch (err) {
      console.error("[handleCreateProject] error:", err);
      toast.error("Network error creating project");
    } finally {
      setCreatingProject(false);
    }
  };

  async function load() {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setProjects(
        (data.projects ?? []).map((p: Record<string, unknown>) => ({
          id: String(p.id),
          name: String(p.name),
          slug: String(p.slug),
          channel_type:
            (p.channel_type as string) === "qr" ? "qr" : "cloud_api",
          account_name: "",
          created_at: String(p.created_at ?? ""),
          members: Array.isArray(p.members) ? (p.members as ProjectMember[]) : [],
        })),
      );
    } catch (err) {
      console.error("[admin/projects] load error:", err);
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const openAddCustomer = (p: Project) => {
    setTargetProject(p);
    setFullName("");
    setEmail("");
    setPassword("");
    setRole("agent");
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProject || submitting) return;

    if (!email.trim() || !EMAIL_RE.test(email.trim())) {
      toast.error("Please provide a valid email address");
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LEN} characters long`);
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
          projectId: targetProject.id,
          role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to create customer");
        return;
      }

      toast.success(`Customer created and assigned to "${targetProject.name}"! Welcome email sent.`);
      const creds = data.credentials;
      setTargetProject(null);
      setCredentials(creds);
      void load();
    } catch {
      toast.error("Failed to create customer");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMember = async () => {
    if (!memberToDelete || deletingMember) return;
    setDeletingMember(true);
    try {
      const res = await fetch(
        `/api/admin/users?userId=${encodeURIComponent(memberToDelete.member.user_id)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Failed to delete customer");
        return;
      }
      toast.success(`Customer ${memberToDelete.member.email} deleted successfully`);
      setMemberToDelete(null);
      void load();
    } catch (err) {
      console.error("[handleDeleteMember] error:", err);
      toast.error("Network error while deleting customer");
    } finally {
      setDeletingMember(false);
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <FolderPlus className="h-4 w-4" />
          Create Project
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="divide-y divide-border">
          {loading ? (
            <div className="flex items-center justify-center px-6 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <FolderKanban className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
            </div>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-4 px-6 py-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FolderKanban className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {p.name}
                        </p>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {p.slug}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {t("channel")}:{" "}
                        {p.channel_type === "qr" ? "WhatsApp QR Code" : "WhatsApp Cloud API"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <div className="hidden items-center gap-2 sm:flex">
                      {p.channel_type === "qr" ? (
                        <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                          <MessageSquare className="h-3.5 w-3.5" />
                          QR
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                          <Radio className="h-3.5 w-3.5" />
                          API
                        </span>
                      )}
                    </div>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setProjectToDelete({ id: p.id, name: p.name, slug: p.slug })}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Assigned Customers / Team Members Section */}
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      <span>Existing Users in this Project ({p.members.length})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/customers?projectId=${p.id}`}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        View in Customers
                      </Link>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => openAddCustomer(p)}
                        className="h-7 gap-1 text-xs px-2.5"
                      >
                        <UserPlus className="h-3 w-3" />
                        Add Customer
                      </Button>
                    </div>
                  </div>

                  {p.members.length === 0 ? (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 rounded-md border border-dashed border-border bg-background/50 p-2.5 text-xs">
                      <p className="text-muted-foreground italic">
                        No customer or agent assigned to this project yet.
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openAddCustomer(p)}
                        className="h-6 text-xs text-primary px-2"
                      >
                        + Add first user to {p.name}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {p.members.map((m) => (
                        <div
                          key={m.user_id}
                          className="group flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-sm hover:border-primary/40 transition-colors"
                        >
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                            {(m.full_name || m.email).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {m.full_name || m.email}
                            </span>
                            {m.full_name && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {m.email}
                              </span>
                            )}
                          </div>
                          <Badge
                            className={cn(
                              "text-[9px] px-1.5 py-0 capitalize",
                              m.role === "admin"
                                ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                                : "bg-primary/10 text-primary border border-primary/20"
                            )}
                          >
                            {m.role}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => setMemberToDelete({ member: m, projectName: p.name })}
                            className="opacity-60 hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-opacity"
                            title="Delete Customer Account"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Customer Modal for this specific project */}
      <Dialog
        open={Boolean(targetProject)}
        onOpenChange={(openState) => {
          if (!openState) setTargetProject(null);
        }}
      >
        <DialogContent className="max-w-md">
          <form onSubmit={handleCreateCustomer}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                Add Customer / User
              </DialogTitle>
              <DialogDescription>
                Create a new customer account assigned directly to{" "}
                <strong className="text-foreground">
                  {targetProject?.name}
                </strong>
                .
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Project display (pre-selected / locked) */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <FolderKanban className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Target Project</p>
                    <p className="text-sm font-semibold text-foreground">
                      {targetProject?.name}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Default Selected
                </Badge>
              </div>

              {/* Full Name */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-cust-name" className="text-xs font-medium">
                  Full Name (Optional)
                </Label>
                <Input
                  id="proj-cust-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. John Doe"
                  maxLength={MAX_NAME_LEN}
                  className="h-9 text-sm"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-cust-email" className="text-xs font-medium">
                  Email Address <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="proj-cust-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="h-9 text-sm"
                />
              </div>

              {/* Role */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-cust-role" className="text-xs font-medium">
                  Assigned Project Role <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={role}
                  onValueChange={(val) => setRole((val as "agent" | "admin") ?? "agent")}
                >
                  <SelectTrigger id="proj-cust-role" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Agent</span>
                        <span className="text-xs text-muted-foreground">
                          (Inbox & messaging access)
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="admin">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Admin</span>
                        <span className="text-xs text-muted-foreground">
                          (Manage project settings & workflows)
                        </span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="proj-cust-pass" className="text-xs font-medium">
                    Temporary Password <span className="text-destructive">*</span>
                  </Label>
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
                  id="proj-cust-pass"
                  type="text"
                  required
                  minLength={MIN_PASSWORD_LEN}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTargetProject(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating User...
                  </>
                ) : (
                  "Create & Assign User"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Member Confirmation Modal */}
      <Dialog
        open={Boolean(memberToDelete)}
        onOpenChange={(openState) => {
          if (!openState) setMemberToDelete(null);
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
                  {memberToDelete?.member.full_name || memberToDelete?.member.email}
                </strong>
                ?
              </span>
              <span className="block text-xs text-muted-foreground">
                This will delete their user profile, remove their assignment from{" "}
                <strong>{memberToDelete?.projectName}</strong>, and revoke their CRM login access.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setMemberToDelete(null)}
              disabled={deletingMember}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteMember}
              disabled={deletingMember}
              className="gap-1.5"
            >
              {deletingMember ? (
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

      {/* Handover Dialog */}
      <Dialog
        open={Boolean(credentials)}
        onOpenChange={(openState) => {
          if (!openState) setCredentials(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              Customer Account Created
            </DialogTitle>
            <DialogDescription>
              The user has been created and assigned to{" "}
              <strong>{credentials?.projectName}</strong>. A welcome email with login
              instructions was dispatched.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email:</span>
                <span className="font-semibold text-foreground">{credentials?.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Role:</span>
                <Badge variant="outline" className="capitalize text-[10px]">
                  {credentials?.role}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assigned Project:</span>
                <span className="font-semibold text-foreground">{credentials?.projectName}</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-border">
                <span className="text-muted-foreground">Temporary Password:</span>
                <code className="rounded bg-background px-2 py-0.5 font-mono font-bold text-primary border border-border">
                  {credentials?.password}
                </code>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={copyCredentials}
              className="gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy Credentials
                </>
              )}
            </Button>
            <Button onClick={() => setCredentials(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Project Modal */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(openState) => {
          if (!openState) {
            setIsCreateOpen(false);
            setNewProjectName("");
            setNewProjectChannel("qr");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <FolderPlus className="h-5 w-5 text-primary" />
              Create New Project
            </DialogTitle>
            <DialogDescription>
              Set up a new isolated workspace with its own contacts, inbox, and WhatsApp connection.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateProject} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="create-proj-name" className="text-xs font-semibold">
                Project Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create-proj-name"
                required
                maxLength={80}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g. Sales Team, Regional Support"
                className="h-9 text-sm"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-proj-channel" className="text-xs font-semibold">
                Default Connection Channel
              </Label>
              <Select
                value={newProjectChannel}
                onValueChange={(val) => setNewProjectChannel(val as "qr" | "cloud_api")}
              >
                <SelectTrigger id="create-proj-channel" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qr">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-emerald-500" />
                      <span>WhatsApp QR Code Gateway</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="cloud_api">
                    <div className="flex items-center gap-2">
                      <Radio className="h-4 w-4 text-blue-500" />
                      <span>Meta WhatsApp Cloud API</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={creatingProject}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creatingProject || !newProjectName.trim()}>
                {creatingProject ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Project...
                  </>
                ) : (
                  "Create Project"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteProjectDialog
        open={Boolean(projectToDelete)}
        onOpenChange={(open) => {
          if (!open) setProjectToDelete(null);
        }}
        project={projectToDelete}
        onDeleted={() => {
          setProjectToDelete(null);
          void load();
        }}
      />
    </div>
  );
}
