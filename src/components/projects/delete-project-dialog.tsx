"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ProjectToDelete {
  id: string;
  name: string;
  slug: string;
}

interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectToDelete | null;
  onDeleted?: () => void;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  onDeleted,
}: DeleteProjectDialogProps) {
  const [confirmationInput, setConfirmationInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Reset confirmation input when project changes or dialog opens
  useEffect(() => {
    if (open) {
      setConfirmationInput("");
    }
  }, [open, project]);

  if (!project) return null;

  const isConfirmed =
    confirmationInput.trim() === project.name.trim();

  async function handleDelete() {
    if (!isConfirmed || deleting) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project!.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error ?? "Failed to delete project");
        return;
      }

      toast.success(`Project "${project!.name}" deleted permanently.`);
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      console.error("[DeleteProjectDialog] delete error:", err);
      toast.error("Failed to reach server to delete project");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <DialogTitle className="text-lg font-bold text-destructive">
              Delete Project
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              This action is permanent and cannot be undone. All data in this workspace will be deleted.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive dark:text-red-400">
            <strong>Warning:</strong> Deleting <strong>{project.name}</strong> will permanently delete all assigned customer accounts, team members, contacts, conversations, messages, WhatsApp sessions, Instagram channels, and automations.
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-confirmation" className="text-xs text-foreground font-medium">
              To confirm, type <span className="font-bold text-destructive select-all">&ldquo;{project.name}&rdquo;</span> below:
            </Label>
            <Input
              id="project-confirmation"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder={project.name}
              disabled={deleting}
              autoComplete="off"
              className="border-border text-sm"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={!isConfirmed || deleting}
            className="gap-1.5"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Permanently Delete Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
