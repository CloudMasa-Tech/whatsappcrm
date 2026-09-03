'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  AlertCircle,
  X,
  Pencil,
  RotateCcw,
  Upload,
  Clock,
  Check,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  Globe,
  LayoutTemplate,
  Search,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import { STARTER_MESSAGE_TEMPLATES, type StarterMessageTemplate } from '@/lib/whatsapp/starter-templates';
import { createClient } from '@/lib/supabase/client';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types';
import { templateStatusConfig } from '@/lib/template-status';
import {
  extractVariableIndices,
  TEMPLATE_LIMITS,
} from '@/lib/whatsapp/template-validators';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
type HeaderFormat = 'none' | 'text' | 'image' | 'video' | 'document';
const HEADER_FORMATS: HeaderFormat[] = [
  'none',
  'text',
  'image',
  'video',
  'document',
];

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: HeaderFormat;
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text: '',
  body_samples: [],
  footer_text: '',
  buttons: [],
};

const COMMON_LANGUAGE_CODES = [
  'en_US',
  'en_GB',
  'en',
  'es',
  'es_ES',
  'es_MX',
  'fr',
  'fr_FR',
  'de',
  'it',
  'pt_BR',
  'pt_PT',
  'nl',
  'pl',
  'ru',
  'tr',
  'lt',
];

function emptyButton(type: TemplateButton['type']): TemplateButton {
  switch (type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: '' };
    case 'URL':
      return { type: 'URL', text: '', url: '' };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: '', phone_number: '' };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', text: '', example: '' };
  }
}

const MEDIA_HEADER_TYPES: MessageTemplate['header_type'][] = [
  'image',
  'video',
  'document',
];

function isMediaHeaderType(
  type: MessageTemplate['header_type'] | undefined
): type is 'image' | 'video' | 'document' {
  return (
    type === 'image' || type === 'video' || type === 'document'
  );
}

function mediaHeaderAccept(
  type: 'image' | 'video' | 'document' | MessageTemplate['header_type'] | undefined
): string {
  switch (type) {
    case 'image':
      return 'image/jpeg,image/png';
    case 'video':
      return 'video/mp4,video/3gpp';
    case 'document':
      return 'application/pdf';
    default:
      return '';
  }
}

export function TemplateManager() {
  const t = useTranslations('Settings.templates');
  const supabase = createClient();
  const { user, loading: authLoading, activeProjectId, isSuperAdmin, platformRole } = useAuth();
  const isSuperAdminUser = isSuperAdmin || platformRole === 'super_admin';

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] =
    useState<MessageTemplate | null>(null);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerFileRef = useRef<HTMLInputElement>(null);
  const [mediaDialogTemplate, setMediaDialogTemplate] =
    useState<MessageTemplate | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);

  // Super Admin direct approval / rejection state
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingTemplate, setRejectingTemplate] = useState<MessageTemplate | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const handleApproveTemplate = async (template: MessageTemplate) => {
    setApprovingId(template.id);
    try {
      const res = await fetch(`/api/admin/templates/${template.id}/approve`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve template');
      toast.success(`Template "${template.name}" approved successfully!`);
      setTemplates((prev) =>
        prev.map((t) => (t.id === template.id ? { ...t, status: 'APPROVED', rejection_reason: undefined } : t))
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve template');
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectTemplate = async () => {
    if (!rejectingTemplate) return;
    setRejectingId(rejectingTemplate.id);
    try {
      const res = await fetch(`/api/admin/templates/${rejectingTemplate.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject template');
      toast.success(`Template "${rejectingTemplate.name}" rejected.`);
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === rejectingTemplate.id
            ? { ...t, status: 'REJECTED', rejection_reason: rejectReason }
            : t
        )
      );
      setRejectingTemplate(null);
      setRejectReason('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject template');
    } finally {
      setRejectingId(null);
    }
  };

  const bodyVarCount = useMemo(
    () => extractVariableIndices(form.body_text).length,
    [form.body_text]
  );
  const headerVarCount = useMemo(
    () =>
      form.header_format === 'text'
        ? extractVariableIndices(form.header_content).length
        : 0,
    [form.header_format, form.header_content]
  );

  useEffect(() => {
    setForm((prev) => {
      if (prev.body_samples.length === bodyVarCount) return prev;
      const next = prev.body_samples.slice(0, bodyVarCount);
      while (next.length < bodyVarCount) next.push('');
      return { ...prev, body_samples: next };
    });
  }, [bodyVarCount]);

  // Starter Templates gallery and Tab view state
  const [activeViewTab, setActiveViewTab] = useState<'ready_made' | 'project'>('ready_made');
  const [starterGalleryOpen, setStarterGalleryOpen] = useState(false);
  const [starterCategoryFilter, setStarterCategoryFilter] = useState<'All' | 'Marketing' | 'Utility'>('All');
  const [starterSearchQuery, setStarterSearchQuery] = useState('');
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);

  function useStarterTemplate(starter: StarterMessageTemplate) {
    setEditingId(null);
    setForm({
      name: starter.name,
      category: starter.category,
      language: starter.language || 'en_US',
      header_format: starter.header_format,
      header_content: starter.header_content || '',
      header_media_url: starter.header_media_url || '',
      header_sample: starter.header_sample || '',
      body_text: starter.body_text,
      body_samples: starter.sample_values?.body || [],
      footer_text: starter.footer_text || '',
      buttons: starter.buttons ? JSON.parse(JSON.stringify(starter.buttons)) : [],
    });
    setStarterGalleryOpen(false);
    setDialogOpen(true);
  }

  async function handleInstallStarter(starter: StarterMessageTemplate, makeCommon: boolean = false) {
    try {
      setInstallingSlug(starter.slug);
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          starter_slug: starter.slug,
          make_common: makeCommon,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to install starter template');
      toast.success(data.message || `Template "${starter.title}" added successfully!`);
      await fetchTemplates();
      setStarterGalleryOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to install template');
    } finally {
      setInstallingSlug(null);
    }
  }

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/whatsapp/templates?project_id=${activeProjectId || ''}`);
      if (res.ok) {
        const json = await res.json();
        setTemplates(json.templates || []);
      } else {
        let query = supabase.from('message_templates').select('*');
        if (activeProjectId) {
          query = query.or(`project_id.eq.${activeProjectId},project_id.is.null`);
        } else if (user?.id) {
          query = query.or(`user_id.eq.${user.id},project_id.is.null`);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        setTemplates(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, supabase, user?.id, t]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchTemplates();
  }, [authLoading, user, fetchTemplates]);

  function buildSubmitPayload() {
    const sample_values: TemplateSampleValues = {};
    if (form.body_samples.some((v) => v.trim())) {
      sample_values.body = form.body_samples.map((v) => v.trim());
    }
    if (form.header_format === 'text' && form.header_sample.trim()) {
      sample_values.header = [form.header_sample.trim()];
    }

    return {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type:
        form.header_format === 'none' ? undefined : form.header_format,
      header_content:
        form.header_format === 'text' ? form.header_content.trim() : undefined,
      header_media_url:
        form.header_format !== 'none' && form.header_format !== 'text'
          ? form.header_media_url.trim() || undefined
          : undefined,
      body_text: form.body_text.trim(),
      footer_text: form.footer_text.trim() || undefined,
      buttons: form.buttons.length > 0 ? form.buttons : undefined,
      sample_values:
        Object.keys(sample_values).length > 0 ? sample_values : undefined,
    };
  }

  function openEdit(template: MessageTemplate) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      category: template.category,
      language: template.language || 'en_US',
      header_format: (template.header_type ?? 'none') as HeaderFormat,
      header_content: template.header_content ?? '',
      header_media_url: template.header_media_url ?? '',
      header_sample: template.sample_values?.header?.[0] ?? '',
      body_text: template.body_text,
      body_samples: template.sample_values?.body ?? [],
      footer_text: template.footer_text ?? '',
      buttons: template.buttons ?? [],
    });
    setDialogOpen(true);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    // AUTHENTICATION is blocked by the persistent banner + disabled
    // submit button; this is a defensive second line of defense.
    if (form.category === 'Authentication') return;
    try {
      setSubmitting(true);
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/whatsapp/templates/${editingId}`
        : '/api/whatsapp/templates/submit';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSubmitPayload()),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error ||
            `${isEdit ? 'Edit' : 'Submit'} failed (HTTP ${res.status})`
        );
      }
      // Refresh first, then close — re-opening the dialog
      // immediately should not show a stale list.
      if (user) await fetchTemplates();
      if (data.requiresApproval) {
        toast.success(
          isEdit
            ? 'Template updated and re-submitted for Super Admin approval.'
            : 'Template submitted for Super Admin approval.'
        );
      } else if (data.isSuperAdmin) {
        toast.success(
          isEdit
            ? 'Template updated and approved.'
            : 'Template created and approved.'
        );
      } else {
        toast.success(
          data.dry_run
            ? isEdit
              ? t('toastSaveEditDry')
              : t('toastSaveNewDry')
            : isEdit
              ? t('toastSubmitEditSuccess')
              : t('toastSubmitNewSuccess')
        );
      }
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(err instanceof Error ? err.message : t('toastSubmitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncFromMeta() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data?.error || 'WhatsApp Cloud API is not connected. Connect your WhatsApp Business account in Settings, or use Ready-Made Templates with QR Gateway.',
          { duration: 6000 }
        );
        return;
      }
      toast.success(
        t('toastSyncCount', { total: data.total }) +
          (data.inserted || data.updated
            ? t('toastSyncDetails', {
                inserted: data.inserted,
                updated: data.updated,
              })
            : '')
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const preview = data.errors
          .slice(0, 3)
          .map(
            (e: { name: string; language: string; message: string }) =>
              `${e.name} (${e.language})`
          );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
        toast.error(
          t('toastSyncFailed', { preview: preview.join(', ') + suffix })
        );
      }
      if (data.truncated) {
        toast.error(t('toastSyncTruncated'), { duration: 10000 });
      }
      await fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastSyncError'));
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete() {
    const target = templateToDelete;
    if (!target || deletingId) return;
    setDeletingId(target.id);
    try {
      // Route handler scopes the Meta delete via hsm_id (so sibling
      // language variants survive) and falls through to remove the
      // local row. Local-only rows skip the Meta call.
      const res = await fetch(`/api/whatsapp/templates/${target.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
      }
      toast.success(t('toastDeleteSuccess'));
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(err instanceof Error ? err.message : t('toastDeleteError'));
    } finally {
      setDeletingId(null);
    }
  }

  // The patch type unions every field across button variants. The
  // conditional rendering below ensures only fields valid for the
  // current button's `type` reach this function, so the runtime
  // assertion + per-type spread preserves discriminated-union
  // invariants without forcing every call site to thread the type
  // through generics (which TS can't infer from a partial literal).
  type ButtonPatch = {
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string;
  };
  function updateButton(index: number, patch: ButtonPatch) {
    setForm((prev) => {
      const current = prev.buttons[index];
      if (!current) return prev;
      const next = [...prev.buttons];
      // Per-variant spread keeps the discriminant pinned. Switch
      // exhaustiveness is enforced by TypeScript.
      switch (current.type) {
        case 'QUICK_REPLY':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
          };
          break;
        case 'URL':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case 'PHONE_NUMBER':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && {
              phone_number: patch.phone_number,
            }),
          };
          break;
        case 'COPY_CODE':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
      }
      return { ...prev, buttons: next };
    });
  }

  function changeButtonType(index: number, type: TemplateButton['type']) {
    setForm((prev) => {
      const next = [...prev.buttons];
      next[index] = emptyButton(type);
      return { ...prev, buttons: next };
    });
  }

  function removeButton(index: number) {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }));
  }

  function addButton() {
    if (form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal) return;
    setForm((prev) => ({
      ...prev,
      buttons: [...prev.buttons, emptyButton('QUICK_REPLY')],
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  const headerNeedsMedia =
    form.header_format !== 'none' && form.header_format !== 'text';

  async function handleHeaderImageFile(file: File) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error(t('toastInvalidImage'));
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(
        t('toastImageTooLarge', { size: (file.size / 1024 / 1024).toFixed(1) })
      );
      return;
    }
    setUploadingHeader(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setForm((f) => ({ ...f, header_media_url: publicUrl }));
      toast.success(t('toastUploadSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastUploadFailed'));
    } finally {
      setUploadingHeader(false);
    }
  }

  function openMediaDialog(template: MessageTemplate) {
    setMediaDialogTemplate(template);
    setMediaUrl(template.header_media_url ?? '');
  }

  async function handleMediaFile(file: File) {
    const kind = mediaDialogTemplate?.header_type;
    if (!kind || !isMediaHeaderType(kind)) return;
    const accept = mediaHeaderAccept(kind);
    if (file.type && !accept.split(',').includes(file.type)) {
      toast.error(
        t('mediaTypeMismatch', {
          format:
            kind === 'image'
              ? t('headerImage')
              : kind === 'video'
                ? t('headerVideo')
                : t('headerDocument'),
        })
      );
      return;
    }
    const max = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > max) {
      toast.error(
        t('mediaTooLarge', {
          size: (file.size / 1024 / 1024).toFixed(1),
          max: (max / 1024 / 1024).toFixed(0),
        })
      );
      return;
    }
    setUploadingMedia(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setMediaUrl(publicUrl);
      toast.success(t('toastUploadSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastUploadFailed'));
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handleSaveMedia() {
    const target = mediaDialogTemplate;
    if (!target || savingMedia) return;
    const url = mediaUrl.trim();
    if (!url) {
      toast.error(t('mediaUrlRequired'));
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error(t('mediaInvalidUrl'));
      return;
    }
    setSavingMedia(true);
    try {
      const res = await fetch(`/api/whatsapp/templates/${target.id}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ header_media_url: url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to save (HTTP ${res.status})`);
      }
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === target.id ? { ...t, header_media_url: url } : t
        )
      );
      setMediaDialogTemplate(null);
      toast.success(t('toastMediaSaved'));
    } catch (err) {
      console.error('Attach media error:', err);
      toast.error(
        err instanceof Error ? err.message : t('toastMediaSaveFailed')
      );
    } finally {
      setSavingMedia(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSyncFromMeta}
              disabled={syncing}
              title={t('syncTitle')}
            >
              <RefreshCw
                className={`size-4 ${syncing ? 'animate-spin' : ''}`}
              />
              {syncing ? t('syncing') : t('syncFromMeta')}
            </Button>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="size-4" />
              {t('newTemplate')}
            </Button>
          </div>
        }
      />

      {/* Top View Selector Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveViewTab('ready_made')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeViewTab === 'ready_made'
                ? 'bg-purple-600 text-white shadow-sm ring-1 ring-purple-400/30'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Sparkles className="size-3.5 text-purple-300" />
            Ready-Made Templates Library
            <Badge className="bg-purple-900/60 text-purple-200 text-[10px] px-1.5 py-0 border border-purple-400/30">
              10 Presets
            </Badge>
          </button>
          <button
            type="button"
            onClick={() => setActiveViewTab('project')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              activeViewTab === 'project'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <LayoutTemplate className="size-3.5" />
            My Project Templates
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border">
              {templates.length}
            </Badge>
          </button>
        </div>

        {/* Filter Pills & Search (for Ready-Made View) */}
        {activeViewTab === 'ready_made' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/60 border border-border">
              {(['All', 'Marketing', 'Utility'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setStarterCategoryFilter(cat)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    starterCategoryFilter === cat
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search ready-made templates..."
                value={starterSearchQuery}
                onChange={(e) => setStarterSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs bg-muted/50 border-border text-foreground placeholder:text-muted-foreground w-56"
              />
              {starterSearchQuery && (
                <button
                  type="button"
                  onClick={() => setStarterSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {isSuperAdminUser && templates.some((t) => (t.status || '').toUpperCase() === 'PENDING') && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="size-5 shrink-0 text-amber-400" />
            <div>
              <span className="font-semibold text-foreground">
                {templates.filter((t) => (t.status || '').toUpperCase() === 'PENDING').length} Template(s) Pending Approval
              </span>
              <p className="text-xs text-muted-foreground">
                Review and approve templates submitted by project admins directly below or in the Admin Panel.
              </p>
            </div>
          </div>
          <Link
            href="/admin/templates"
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/30 border border-amber-500/30"
          >
            Open Admin Approvals Portal
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      )}

      {/* VIEW 1: Ready-Made Templates Gallery directly on the page */}
      {activeViewTab === 'ready_made' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {STARTER_MESSAGE_TEMPLATES.filter((s) => {
              if (starterCategoryFilter !== 'All' && s.category !== starterCategoryFilter) {
                return false;
              }
              if (starterSearchQuery.trim()) {
                const q = starterSearchQuery.toLowerCase();
                const matchName = s.name.toLowerCase().includes(q);
                const matchTitle = s.title.toLowerCase().includes(q);
                const matchDesc = s.description.toLowerCase().includes(q);
                const matchBody = s.body_text.toLowerCase().includes(q);
                const matchTags = s.tags.some((t) => t.toLowerCase().includes(q));
                return matchName || matchTitle || matchDesc || matchBody || matchTags;
              }
              return true;
            }).map((starter) => (
              <Card
                key={starter.slug}
                className="flex flex-col justify-between border-border bg-card/60 hover:border-purple-500/50 hover:shadow-md transition-all"
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                        {starter.title}
                      </h3>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {starter.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge className="border border-purple-500/30 bg-purple-500/20 text-[10px] text-purple-300">
                        Preset
                      </Badge>
                      <Badge
                        className={`border text-[10px] shrink-0 ${categoryColors[starter.category] || ''}`}
                      >
                        {starter.category}
                      </Badge>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {starter.description}
                  </p>

                  {/* WhatsApp Bubble Preview */}
                  <div className="rounded-lg border border-border/80 bg-background/80 p-3 space-y-2 text-xs">
                    {starter.header_content && (
                      <div className="font-semibold text-foreground border-b border-border/60 pb-1 text-[11px]">
                        {starter.header_content}
                      </div>
                    )}
                    <p className="text-muted-foreground text-[11px] leading-relaxed whitespace-pre-wrap">
                      {starter.body_text}
                    </p>
                    {starter.footer_text && (
                      <div className="text-[10px] text-muted-foreground/70 italic border-t border-border/40 pt-1">
                        {starter.footer_text}
                      </div>
                    )}
                    {starter.buttons && starter.buttons.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-border/40">
                        {starter.buttons.map((btn, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground border border-border/50"
                          >
                            {btn.type === 'URL' ? '🔗 ' : btn.type === 'COPY_CODE' ? '📋 ' : '💬 '}
                            {btn.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {starter.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] rounded bg-muted text-muted-foreground px-1.5 py-0.5"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                    <Button
                      size="sm"
                      onClick={() => useStarterTemplate(starter)}
                      className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5 h-8"
                    >
                      <Pencil className="size-3.5" />
                      Use Template
                    </Button>
                    {isSuperAdminUser && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={installingSlug === starter.slug}
                        onClick={() => handleInstallStarter(starter, true)}
                        title="Deploy as Common Template for all projects"
                        className="border-border hover:bg-purple-500/10 text-muted-foreground hover:text-purple-300 text-xs gap-1 h-8 px-2.5"
                      >
                        {installingSlug === starter.slug ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Globe className="size-3.5 text-purple-400" />
                        )}
                        Make Common
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 2: Project / Custom Templates */}
      {activeViewTab === 'project' && (
        <div>
          {templates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <div>
                  <p className="text-muted-foreground text-sm">{t('noTemplates')}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('createFirst')}
                  </p>
                </div>
                <Button
                  onClick={() => setActiveViewTab('ready_made')}
                  className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
                >
                  <Sparkles className="size-4" />
                  Browse Ready-Made Templates
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {templates.map((template) => {
                const statusKey = template.status || 'DRAFT';
                const status = templateStatusConfig[statusKey];
                const isCommon = !template.project_id || (template as any).is_common;
                return (
                  <Card key={template.id}>
                    <CardContent className="flex items-start justify-between pt-4">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-foreground font-medium">
                            {template.name}
                          </h3>
                          {isCommon ? (
                            <Badge className="border border-purple-500/40 bg-purple-500/20 text-purple-300 text-xs gap-1">
                              <Globe className="size-3" />
                              Common
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-border text-xs text-muted-foreground">
                              Project Only
                            </Badge>
                          )}
                          <Badge
                            className={`border text-xs ${categoryColors[template.category] || ''}`}
                          >
                            {template.category}
                          </Badge>
                          <Badge className={`border text-xs ${status.classes}`}>
                            {status.label}
                          </Badge>
                          <Badge variant="outline" className="border-border text-xs">
                            {template.language}
                          </Badge>
                          {template.rejection_reason && (
                            <span className="text-xs text-red-400 font-medium">
                              Reason: {template.rejection_reason}
                            </span>
                          )}
                        </div>
                        {template.body_text && (
                          <p className="text-muted-foreground line-clamp-2 text-xs">
                            {template.body_text}
                          </p>
                        )}
                        {template.header_media_url && (
                          <p className="text-muted-foreground truncate text-[11px]">
                            {t('attachedMedia', { url: template.header_media_url })}
                          </p>
                        )}
                        {isMediaHeaderType(template.header_type) &&
                          !template.header_media_url && (
                            <div className="flex items-start gap-1.5 rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1.5 text-xs text-amber-400">
                              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                              <span>{t('mediaRequired')}</span>
                            </div>
                          )}
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-1">
                        {isSuperAdminUser && statusKey === 'PENDING' && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleApproveTemplate(template)}
                              disabled={approvingId === template.id || rejectingId === template.id}
                              title="Approve Template"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1 h-8 px-2.5 shadow-sm"
                            >
                              {approvingId === template.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Check className="size-3.5" />
                              )}
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRejectingTemplate(template);
                                setRejectReason('');
                              }}
                              disabled={approvingId === template.id || rejectingId === template.id}
                              title="Reject Template"
                              className="border-red-500/40 text-red-400 hover:bg-red-950/30 hover:text-red-300 gap-1 h-8 px-2.5"
                            >
                              <X className="size-3.5" />
                              Reject
                            </Button>
                          </>
                        )}
                        {isMediaHeaderType(template.header_type) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openMediaDialog(template)}
                            title={t('attachMediaAria')}
                            aria-label={t('attachMediaAria')}
                            className="text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 px-2"
                          >
                            <Upload className="size-3.5" />
                            {t('attachMedia')}
                          </Button>
                        )}
                        {(statusKey === 'APPROVED' || statusKey === 'PENDING' || statusKey === 'DRAFT') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(template)}
                            title={t('editTitle')}
                            aria-label={t('editLabel')}
                            className="text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 px-2"
                          >
                            <Pencil className="size-3.5" />
                            {t('edit')}
                          </Button>
                        )}
                        {(statusKey === 'REJECTED' || statusKey === 'PAUSED') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(template)}
                            title={t('resubmitTitle')}
                            aria-label={t('resubmitLabel')}
                            className="text-muted-foreground hover:text-primary hover:bg-primary/10 h-8 px-2"
                          >
                            <RotateCcw className="size-3.5" />
                            {t('resubmit')}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setTemplateToDelete(template)}
                          disabled={deletingId === template.id}
                          aria-label={
                            template.meta_template_id
                              ? t('deleteMetaLocallyAria')
                              : t('deleteLocallyAria')
                          }
                          title={
                            template.meta_template_id
                              ? t('deleteMetaLocallyTitle')
                              : t('deleteLocallyTitle')
                          }
                          className="text-muted-foreground h-8 w-8 hover:bg-red-950/30 hover:text-red-400"
                        >
                          {deletingId === template.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="bg-popover border-border max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editingId ? t('dialogEditTitle') : t('dialogNewTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingId ? t('dialogEditDesc') : t('dialogNewDesc')}
            </DialogDescription>
          </DialogHeader>

          {form.category === 'Authentication' && (
            <div className="flex items-start gap-2 rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>
                {t.rich('authWarning', {
                  bold: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {t('templateName')}
              </Label>
              <Input
                placeholder={t('namePlaceholder')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={editingId !== null}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-muted-foreground text-[11px]">
                {editingId ? t('nameFixed') : t('nameHint')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('category')}</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) =>
                    setForm({
                      ...form,
                      category: val as MessageTemplate['category'],
                    })
                  }
                >
                  <SelectTrigger className="bg-muted border-border text-foreground w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {CATEGORIES.map((cat) => (
                      <SelectItem
                        key={cat}
                        value={cat}
                        className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                      >
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('language')}</Label>
                <Input
                  list="template-language-codes"
                  placeholder="en_US"
                  value={form.language}
                  onChange={(e) =>
                    setForm({ ...form, language: e.target.value })
                  }
                  disabled={editingId !== null}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
                />
                <datalist id="template-language-codes">
                  {COMMON_LANGUAGE_CODES.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
                <p className="text-muted-foreground text-[11px]">
                  {editingId ? (
                    t('langFixed')
                  ) : (
                    <span>
                      {t.rich('langHint', {
                        code: (chunks) => <code>{chunks}</code>,
                      })}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('header')}</Label>
              <Select
                value={form.header_format}
                onValueChange={(val) =>
                  // Preserve header_content, header_media_url, and
                  // header_sample across format switches. The submit
                  // payload builder only reads the field that matches
                  // the active format, so an orphan value on a hidden
                  // field is harmless — and keeping it lets the user
                  // switch formats to compare without losing typing.
                  setForm({
                    ...form,
                    header_format: (val || 'none') as HeaderFormat,
                  })
                }
              >
                <SelectTrigger className="bg-muted border-border text-foreground w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {HEADER_FORMATS.map((type) => (
                    <SelectItem
                      key={type}
                      value={type}
                      className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                    >
                      {type === 'none'
                        ? t('headerNone')
                        : type === 'text'
                          ? t('headerText')
                          : type === 'image'
                            ? t('headerImage')
                            : type === 'video'
                              ? t('headerVideo')
                              : t('headerDocument')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {form.header_format === 'text' && (
                <div className="mt-2 space-y-2">
                  <Input
                    id="template-header-text"
                    aria-label="Header text"
                    placeholder={t.raw('headerTextPlaceholder')}
                    value={form.header_content}
                    onChange={(e) =>
                      setForm({ ...form, header_content: e.target.value })
                    }
                    maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  {headerVarCount > 0 && (
                    <Input
                      id="template-header-sample"
                      aria-label={t('headerSampleAria')}
                      placeholder={t.raw('headerSamplePlaceholder')}
                      value={form.header_sample}
                      onChange={(e) =>
                        setForm({ ...form, header_sample: e.target.value })
                      }
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  )}
                </div>
              )}

              {headerNeedsMedia && (
                <div className="mt-2 space-y-2">
                  {form.header_format === 'image' && (
                    <div className="flex items-center gap-2">
                      <input
                        ref={headerFileRef}
                        type="file"
                        accept="image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleHeaderImageFile(f);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={uploadingHeader}
                        onClick={() => headerFileRef.current?.click()}
                      >
                        {uploadingHeader ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {t('uploadImage')}
                      </Button>
                      <span className="text-muted-foreground text-[11px]">
                        {t('uploadHint')}
                      </span>
                    </div>
                  )}
                  <Input
                    placeholder={t('mediaUrlPlaceholder', {
                      format: form.header_format,
                    })}
                    value={form.header_media_url}
                    onChange={(e) =>
                      setForm({ ...form, header_media_url: e.target.value })
                    }
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  {form.header_format === 'image' && form.header_media_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.header_media_url}
                      alt="Header sample"
                      className="border-border max-h-28 rounded-md border object-contain"
                    />
                  )}
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    {form.header_format === 'image'
                      ? t('imageHint')
                      : t('mediaHint')}
                    {form.header_format === 'video' && t('videoHint')}
                    {form.header_format === 'document' && t('documentHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('bodyText')}</Label>
              <Textarea
                placeholder={t.raw('bodyPlaceholder')}
                value={form.body_text}
                onChange={(e) =>
                  setForm({ ...form, body_text: e.target.value })
                }
                rows={4}
                maxLength={TEMPLATE_LIMITS.bodyMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground resize-none"
              />
              <p className="text-muted-foreground text-[11px]">
                {t.raw('bodyHint')}
              </p>

              {bodyVarCount > 0 && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-muted-foreground text-[11px]">
                    {t('sampleValues')}
                  </Label>
                  {form.body_samples.map((val, i) => {
                    const inputId = `template-body-sample-${i}`;
                    return (
                      <Input
                        key={i}
                        id={inputId}
                        aria-label={t('sampleAria', { var: `{{${i + 1}}}` })}
                        placeholder={t('samplePlaceholder', {
                          var: `{{${i + 1}}}`,
                        })}
                        value={val}
                        onChange={(e) => {
                          const next = [...form.body_samples];
                          next[i] = e.target.value;
                          setForm({ ...form, body_samples: next });
                        }}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('footer')}</Label>
              <Input
                placeholder={t('footerPlaceholder')}
                value={form.footer_text}
                onChange={(e) =>
                  setForm({ ...form, footer_text: e.target.value })
                }
                maxLength={TEMPLATE_LIMITS.footerMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">{t('buttons')}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addButton}
                  disabled={
                    form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal
                  }
                  className="border-border text-muted-foreground hover:bg-muted h-7 bg-transparent text-xs"
                >
                  <Plus className="size-3" />
                  {t('addButton')}
                </Button>
              </div>
              {form.buttons.length === 0 ? (
                <p className="text-muted-foreground text-[11px]">
                  {t('buttonsLimit', { max: TEMPLATE_LIMITS.maxButtonsTotal })}
                </p>
              ) : (
                <div className="space-y-2">
                  {form.buttons.map((btn, i) => (
                    <div
                      key={i}
                      className="border-border bg-muted/50 space-y-2 rounded border p-2"
                    >
                      <div className="flex items-center gap-2">
                        <Select
                          value={btn.type}
                          onValueChange={(val) => {
                            // Same null guard as the Header Select
                            // (per PR 148): @base-ui Select fires
                            // onValueChange(null) on deselect.
                            if (!val) return;
                            changeButtonType(i, val as TemplateButton['type']);
                          }}
                        >
                          <SelectTrigger className="bg-muted border-border text-foreground h-8 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            <SelectItem
                              value="QUICK_REPLY"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnQuickReply')}
                            </SelectItem>
                            <SelectItem
                              value="URL"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnUrl')}
                            </SelectItem>
                            <SelectItem
                              value="PHONE_NUMBER"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnPhone')}
                            </SelectItem>
                            <SelectItem
                              value="COPY_CODE"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnCopyCode')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder={t('btnLabelPlaceholder')}
                          value={btn.text}
                          maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                          onChange={(e) =>
                            updateButton(i, { text: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 flex-1 text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeButton(i)}
                          className="text-muted-foreground size-7 hover:bg-red-950/30 hover:text-red-400"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                      {btn.type === 'URL' && (
                        <div className="space-y-1 pl-1">
                          <Input
                            placeholder={t.raw('urlPlaceholder')}
                            value={btn.url}
                            onChange={(e) =>
                              updateButton(i, { url: e.target.value })
                            }
                            className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                          />
                          {extractVariableIndices(btn.url).length > 0 && (
                            <Input
                              placeholder={t.raw('urlSamplePlaceholder')}
                              value={btn.example ?? ''}
                              onChange={(e) =>
                                updateButton(i, { example: e.target.value })
                              }
                              className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                            />
                          )}
                        </div>
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <Input
                          placeholder={t('phonePlaceholder')}
                          value={btn.phone_number}
                          onChange={(e) =>
                            updateButton(i, { phone_number: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                      {btn.type === 'COPY_CODE' && (
                        <Input
                          placeholder={t('codePlaceholder')}
                          value={btn.example}
                          onChange={(e) =>
                            updateButton(i, { example: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || form.category === 'Authentication'}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {editingId ? t('saving') : t('submitting')}
                </>
              ) : editingId ? (
                t('saveResubmit')
              ) : (
                t('submitApproval')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-delete dialog. Surfacing the meta_template_id case
          separately so users understand a real Meta delete is happening,
          not just a local cleanup. */}
      <Dialog
        open={templateToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTemplateToDelete(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteDialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {templateToDelete?.meta_template_id
                ? t('deleteMetaDesc', { name: templateToDelete.name })
                : t('deleteLocalDesc', { name: templateToDelete?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setTemplateToDelete(null)}
              disabled={deletingId !== null}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deletingId !== null}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deletingId !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('deleting')}
                </>
              ) : (
                t('delete')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attach-header-media dialog. Local-only write to
          header_media_url (see the /media route) so synced templates
          whose media URL Meta never returned can actually be sent. No
          Meta call — the template is already approved. */}
      <Dialog
        open={mediaDialogTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setMediaDialogTemplate(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('attachMediaTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('attachMediaDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <input
              ref={mediaFileRef}
              type="file"
              accept={mediaHeaderAccept(mediaDialogTemplate?.header_type)}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleMediaFile(f);
                e.target.value = '';
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingMedia}
                onClick={() => mediaFileRef.current?.click()}
                className="border-border text-muted-foreground hover:bg-muted bg-transparent"
              >
                {uploadingMedia ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {t('uploadMedia')}
              </Button>
              <span className="text-muted-foreground text-[11px]">
                {mediaDialogTemplate?.header_type === 'image'
                  ? t('uploadHint')
                  : mediaDialogTemplate?.header_type === 'video'
                    ? t('uploadVideoHint')
                    : t('uploadDocumentHint')}
              </span>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {t('attachMediaUrl')}
              </Label>
              <Input
                placeholder="https://…"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            {mediaUrl && (
              <div className="space-y-1">
                {mediaDialogTemplate?.header_type === 'image' && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl}
                    alt="Header media preview"
                    className="border-border max-h-28 rounded-md border object-contain"
                  />
                )}
                <p className="text-muted-foreground truncate text-[11px]">
                  {t('attachMediaCurrent', { url: mediaUrl })}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setMediaDialogTemplate(null)}
              disabled={savingMedia}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSaveMedia}
              disabled={savingMedia}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {savingMedia ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Super Admin Rejection Dialog */}
      <Dialog
        open={!!rejectingTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingTemplate(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Reject Template</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Provide a reason for rejecting &quot;{rejectingTemplate?.name}&quot;. The project admin will see this reason and can make changes to resubmit.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label htmlFor="reject-reason" className="text-foreground text-xs font-medium">
              Rejection Reason
            </Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Contains promotional language in a utility template..."
              rows={3}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground resize-none"
            />
            <div className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground font-medium">Quick reason presets:</span>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  'Contains promotional content in utility template',
                  'Malformed {{variables}} without context',
                  'Violates WhatsApp Business Policy',
                  'Invalid buttons or destination URLs',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRejectReason(preset)}
                    className="text-[11px] rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground px-2 py-1 transition-colors border border-border text-left"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="bg-popover border-border gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectingTemplate(null)}
              disabled={!!rejectingId}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleRejectTemplate}
              disabled={!rejectReason.trim() || !!rejectingId}
              className="gap-1.5"
            >
              {rejectingId ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ready-Made Starter Templates Gallery Dialog */}
      <Dialog
        open={starterGalleryOpen}
        onOpenChange={setStarterGalleryOpen}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col bg-card border-border p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <DialogTitle className="text-foreground text-lg flex items-center gap-2">
                    Ready-Made Message Templates
                    <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-300 text-xs">
                      10 Presets
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="text-muted-foreground text-xs mt-0.5">
                    Select a ready-to-use WhatsApp template to quickly populate your template editor or deploy to your project.
                  </DialogDescription>
                </div>
              </div>
            </div>

            {/* Filter Pills & Search */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted/60 border border-border">
                {(['All', 'Marketing', 'Utility'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setStarterCategoryFilter(cat)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      starterCategoryFilter === cat
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search templates by name, title, or tag..."
                  value={starterSearchQuery}
                  onChange={(e) => setStarterSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs bg-muted/50 border-border text-foreground placeholder:text-muted-foreground"
                />
                {starterSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setStarterSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Templates Grid List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {STARTER_MESSAGE_TEMPLATES.filter((s) => {
              if (starterCategoryFilter !== 'All' && s.category !== starterCategoryFilter) {
                return false;
              }
              if (starterSearchQuery.trim()) {
                const q = starterSearchQuery.toLowerCase();
                const matchName = s.name.toLowerCase().includes(q);
                const matchTitle = s.title.toLowerCase().includes(q);
                const matchDesc = s.description.toLowerCase().includes(q);
                const matchBody = s.body_text.toLowerCase().includes(q);
                const matchTags = s.tags.some((t) => t.toLowerCase().includes(q));
                return matchName || matchTitle || matchDesc || matchBody || matchTags;
              }
              return true;
            }).length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                No ready-made templates match your filter criteria.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {STARTER_MESSAGE_TEMPLATES.filter((s) => {
                  if (starterCategoryFilter !== 'All' && s.category !== starterCategoryFilter) {
                    return false;
                  }
                  if (starterSearchQuery.trim()) {
                    const q = starterSearchQuery.toLowerCase();
                    const matchName = s.name.toLowerCase().includes(q);
                    const matchTitle = s.title.toLowerCase().includes(q);
                    const matchDesc = s.description.toLowerCase().includes(q);
                    const matchBody = s.body_text.toLowerCase().includes(q);
                    const matchTags = s.tags.some((t) => t.toLowerCase().includes(q));
                    return matchName || matchTitle || matchDesc || matchBody || matchTags;
                  }
                  return true;
                }).map((starter) => (
                  <div
                    key={starter.slug}
                    className="flex flex-col justify-between rounded-xl border border-border bg-muted/20 hover:border-purple-500/40 transition-all p-4 space-y-3"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                            {starter.title}
                          </h4>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {starter.name}
                          </span>
                        </div>
                        <Badge
                          className={`border text-[10px] shrink-0 ${categoryColors[starter.category] || ''}`}
                        >
                          {starter.category}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {starter.description}
                      </p>

                      {/* WhatsApp Bubble Preview */}
                      <div className="rounded-lg border border-border/80 bg-background/80 p-3 space-y-2 text-xs">
                        {starter.header_content && (
                          <div className="font-semibold text-foreground border-b border-border/60 pb-1 text-[11px]">
                            {starter.header_content}
                          </div>
                        )}
                        <p className="text-muted-foreground text-[11px] leading-relaxed whitespace-pre-wrap">
                          {starter.body_text}
                        </p>
                        {starter.footer_text && (
                          <div className="text-[10px] text-muted-foreground/70 italic border-t border-border/40 pt-1">
                            {starter.footer_text}
                          </div>
                        )}
                        {starter.buttons && starter.buttons.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1 border-t border-border/40">
                            {starter.buttons.map((btn, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground border border-border/50"
                              >
                                {btn.type === 'URL' ? '🔗 ' : btn.type === 'COPY_CODE' ? '📋 ' : '💬 '}
                                {btn.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {starter.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] rounded bg-muted text-muted-foreground px-1.5 py-0.5"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                      <Button
                        size="sm"
                        onClick={() => useStarterTemplate(starter)}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5 h-8"
                      >
                        <Pencil className="size-3.5" />
                        Use Template
                      </Button>
                      {isSuperAdminUser && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={installingSlug === starter.slug}
                          onClick={() => handleInstallStarter(starter, true)}
                          title="Deploy as Common Template for all projects"
                          className="border-border hover:bg-purple-500/10 text-muted-foreground hover:text-purple-300 text-xs gap-1 h-8 px-2.5"
                        >
                          {installingSlug === starter.slug ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Globe className="size-3.5 text-purple-400" />
                          )}
                          Make Common
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="p-4 border-t border-border bg-muted/20">
            <Button
              variant="outline"
              onClick={() => setStarterGalleryOpen(false)}
              className="border-border text-muted-foreground text-xs"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
