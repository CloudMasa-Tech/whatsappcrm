"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  LayoutTemplate,
  Loader2,
  Sparkles,
  Globe,
  Search,
} from "lucide-react";
import { STARTER_MESSAGE_TEMPLATES } from "@/lib/whatsapp/starter-templates";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  buttonParams?: Record<number, string>;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Templates may need values for: body variables, a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === "text" && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === "URL" && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { bodyVars, headerVarCount, urlButtonSlots };
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
}: TemplatePickerProps) {
  const t = useTranslations("Inbox.templatePicker");
  const { activeProjectId } = useAuth();

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState<string>("");
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});
  const [filterTab, setFilterTab] = useState<"all" | "approved" | "starters">("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/whatsapp/templates?project_id=${activeProjectId || ''}&include_starters=true`);
        if (res.ok) {
          const json = await res.json();
          const dbTemplates: MessageTemplate[] = json.templates || [];
          
          // Map starter templates into MessageTemplate shape
          const starterTemplates: MessageTemplate[] = (STARTER_MESSAGE_TEMPLATES || []).map((s) => ({
            id: `starter_${s.slug}`,
            user_id: 'system',
            name: s.name,
            category: s.category,
            language: s.language,
            header_type: s.header_format === 'none' ? undefined : (s.header_format as any),
            header_content: s.header_content,
            header_media_url: s.header_media_url,
            body_text: s.body_text,
            footer_text: s.footer_text,
            buttons: s.buttons,
            sample_values: s.sample_values,
            status: 'APPROVED',
            is_starter: true,
            is_common: true,
          } as MessageTemplate & { is_starter?: boolean; is_common?: boolean }));

          // Combine with deduplication by name
          const existingNames = new Set(dbTemplates.map((t) => t.name.toLowerCase()));
          const combined = [
            ...dbTemplates,
            ...starterTemplates.filter((s) => !existingNames.has(s.name.toLowerCase())),
          ];

          if (!cancelled) {
            setTemplates(combined);
          }
        } else {
          // Fallback direct supabase query
          const supabase = createClient();
          let query = supabase
            .from("message_templates")
            .select("*")
            .in("status", ["APPROVED", "approved", "ACTIVE", "active", "READY", "ready", "SUBMITTED", "APPROVED_LOCAL"]);

          if (activeProjectId) {
            query = query.or(`project_id.eq.${activeProjectId},project_id.is.null`);
          }

          const { data, error } = await query.order("created_at", { ascending: false });
          if (!cancelled) {
            if (error) {
              console.error("Failed to fetch templates:", error);
              setTemplates([]);
            } else {
              setTemplates((data as MessageTemplate[]) ?? []);
            }
          }
        }
      } catch (err) {
        console.error("Template picker error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, activeProjectId]);

  function resetSelection() {
    setSelected(null);
    setParams([]);
    setHeaderText("");
    setButtonParams({});
    setSearchQuery("");
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetSelection();
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.headerVarCount === 0 &&
      slots.urlButtonSlots.length === 0;
    if (noInputsNeeded) {
      onSelect(template, { body: [] });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setParams(new Array(slots.bodyVars.length).fill(""));
    setHeaderText("");
    setButtonParams({});
  }

  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: params };
    if (headerText.trim()) values.headerText = headerText.trim();
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()]),
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected],
  );
  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? "").trim().length > 0,
    );

  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      const isStarter = (t as any).is_starter;
      if (filterTab === "approved" && isStarter) return false;
      if (filterTab === "starters" && !isStarter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = t.name.toLowerCase().includes(q);
        const matchBody = t.body_text.toLowerCase().includes(q);
        const matchCategory = t.category.toLowerCase().includes(q);
        return matchName || matchBody || matchCategory;
      }
      return true;
    });
  }, [templates, filterTab, searchQuery]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            {selected ? selected.name : t("sendTemplate")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected
              ? t("fillPlaceholders")
              : "Pick an approved or ready-made message template to send to this contact."}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-3">
            {/* Filter Tabs & Search */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/60 border border-border">
                <button
                  type="button"
                  onClick={() => setFilterTab("all")}
                  className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${
                    filterTab === "all"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All ({templates.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab("approved")}
                  className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${
                    filterTab === "approved"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Project ({templates.filter((t) => !(t as any).is_starter).length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab("starters")}
                  className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors ${
                    filterTab === "starters"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  ✨ Ready-Made ({templates.filter((t) => (t as any).is_starter).length})
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs bg-muted/50 border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="rounded-md border border-border bg-background/50 p-6 text-center space-y-3">
                  <div>
                    <p className="text-sm font-medium text-popover-foreground">{t("noApprovedTemplates")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No templates match your search filter.
                    </p>
                  </div>
                  <Link
                    href="/templates"
                    onClick={() => onOpenChange(false)}
                    className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground gap-1.5 h-8"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Manage & Create Templates
                  </Link>
                </div>
              ) : (
                filteredTemplates.map((t) => {
                  const isStarter = (t as any).is_starter;
                  const isCommon = !t.project_id || (t as any).is_common;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickTemplate(t)}
                      className="w-full rounded-md border border-border bg-background/50 p-3 text-left transition-colors hover:border-purple-500/40 hover:bg-popover"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-popover-foreground">
                              {t.name}
                            </p>
                            {isStarter ? (
                              <Badge className="border border-purple-500/30 bg-purple-500/20 text-[10px] text-purple-300 gap-0.5">
                                <Sparkles className="h-2.5 w-2.5 text-purple-400" />
                                Ready-Made
                              </Badge>
                            ) : isCommon ? (
                              <Badge className="border border-blue-500/30 bg-blue-500/20 text-[10px] text-blue-300 gap-0.5">
                                <Globe className="h-2.5 w-2.5 text-blue-400" />
                                Common
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">
                                Project
                              </Badge>
                            )}
                            <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary">
                              {t.category}
                            </Badge>
                            {t.language && (
                              <span className="text-[10px] uppercase text-muted-foreground">
                                {t.language}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {t.body_text}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-1 text-xs text-muted-foreground">{t("preview")}</p>
              <p className="whitespace-pre-wrap text-sm text-popover-foreground">
                {renderBodyPreview(selected.body_text, params)}
              </p>
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {slots && slots.headerVarCount > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`Header {{1}}`}
                </Label>
                <Input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder={t("headerValuePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            )}
            {slots?.bodyVars.map((v, i) => (
              <div key={v} className="space-y-1">
                <Label className="text-xs text-popover-foreground">{`Body {{${v}}}`}</Label>
                <Input
                  value={params[i] ?? ""}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={t("bodyValuePlaceholder", { val: `{{${v}}}` })}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            ))}
            {slots?.urlButtonSlots.map((slot) => (
              <div key={slot.index} className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`URL button "${slot.text}" — value for `}{`{{1}}`}
                </Label>
                <Input
                  value={buttonParams[slot.index] ?? ""}
                  onChange={(e) =>
                    setButtonParams((prev) => ({
                      ...prev,
                      [slot.index]: e.target.value,
                    }))
                  }
                  placeholder={t("urlSuffixValuePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-[10px] text-muted-foreground break-all">
                  {t("finalUrl", { url: slot.url.replace(/\{\{1\}\}/g, buttonParams[slot.index] || "{{1}}") })}
                </p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("back")}
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t("send")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
