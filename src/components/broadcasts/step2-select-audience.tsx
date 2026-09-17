'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Plus,
  UserPlus,
  Search,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';
type CustomFieldOperator = 'is' | 'is_not' | 'contains' | 'has_value';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

interface SimpleContact {
  id: string;
  name: string | null;
  phone: string;
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('Broadcasts.wizard');
  const { user, accountId, activeProjectId } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const OPERATOR_OPTIONS = useMemo<{ value: CustomFieldOperator; label: string }[]>(() => [
    { value: 'is', label: t('selectAudience.operatorIs') },
    { value: 'is_not', label: t('selectAudience.operatorIsNot') },
    { value: 'contains', label: t('selectAudience.operatorContains') },
    { value: 'has_value', label: 'Has any value (is not empty)' },
  ], [t]);

  const audienceOptions = useMemo<{
    type: AudienceType;
    label: string;
    description: string;
    icon: typeof Users;
  }[]>(() => [
    {
      type: 'all',
      label: t('selectAudience.method.all'),
      description: t('selectAudience.allDescLoading'),
      icon: Users,
    },
    {
      type: 'tags',
      label: t('selectAudience.method.tags'),
      description: t('selectAudience.tagDesc'),
      icon: Tags,
    },
    {
      type: 'custom_field',
      label: t('selectAudience.method.customField'),
      description: t('selectAudience.customFieldDesc'),
      icon: Filter,
    },
    {
      type: 'csv',
      label: t('selectAudience.method.csv'),
      description: t('selectAudience.csvDesc'),
      icon: Upload,
    },
  ], [t]);

  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Quick-Add Custom Field Modal State
  const [createFieldOpen, setCreateFieldOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [creatingField, setCreatingField] = useState(false);

  // Assign Contact to Custom Field Modal State
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [contactsList, setContactsList] = useState<SimpleContact[]>([]);
  const [loadingContactsList, setLoadingContactsList] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignContactIds, setAssignContactIds] = useState<string[]>([]);
  const [assignFieldValue, setAssignFieldValue] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);

  // Existing suggestions & preview
  const [distinctValues, setDistinctValues] = useState<string[]>([]);
  const [matchedPreviewList, setMatchedPreviewList] = useState<
    { id: string; name: string | null; phone: string; value: string }[]
  >([]);
  const [showPreview, setShowPreview] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoadingTags(true);
    try {
      const supabase = createClient();
      let query = supabase.from('tags').select('*').order('name');
      if (activeProjectId) {
        query = query.eq('project_id', activeProjectId);
      }
      const { data } = await query;
      setTags(data ?? []);
    } finally {
      setLoadingTags(false);
    }
  }, [activeProjectId]);

  const fetchFields = useCallback(async () => {
    setLoadingFields(true);
    try {
      const supabase = createClient();
      let query = supabase
        .from('custom_fields')
        .select('*')
        .order('field_name');
      if (activeProjectId) {
        query = query.eq('project_id', activeProjectId);
      }
      const { data } = await query;
      setCustomFields(data ?? []);
    } finally {
      setLoadingFields(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    if (audience.type === 'custom_field') {
      fetchFields();
    }
  }, [audience.type, fetchFields]);

  // Load distinct values whenever active custom field changes
  useEffect(() => {
    const fieldId = audience.customField?.fieldId;
    if (!fieldId || audience.type !== 'custom_field') {
      setDistinctValues([]);
      return;
    }

    async function loadDistinct() {
      const supabase = createClient();
      let query = supabase
        .from('contact_custom_values')
        .select('value, contacts!inner(project_id)')
        .eq('custom_field_id', fieldId);
      if (activeProjectId) {
        query = query.eq('contacts.project_id', activeProjectId);
      }
      const { data } = await query;
      if (data) {
        const values = [
          ...new Set(
            data
              .map((r) => r.value?.trim())
              .filter((v): v is string => Boolean(v && v.length > 0))
          ),
        ];
        setDistinctValues(values);
      }
    }
    loadDistinct();
  }, [audience.customField?.fieldId, audience.type, activeProjectId]);

  const fetchEstimatedCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      const supabase = createClient();

      let baseIds: Set<string> | null = null;
      let matchesWithVal: { id: string; name: string | null; phone: string; value: string }[] = [];

      if (audience.type === 'all') {
        // Handled below — full-table count adjusted by excludes.
      } else if (
        audience.type === 'tags' &&
        audience.tagIds &&
        audience.tagIds.length > 0
      ) {
        let query = supabase
          .from('contact_tags')
          .select('contact_id, contacts!inner(project_id)')
          .in('tag_id', audience.tagIds);
        if (activeProjectId) {
          query = query.eq('contacts.project_id', activeProjectId);
        }
        const { data } = await query;
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
      } else if (
        audience.type === 'custom_field' &&
        audience.customField?.fieldId &&
        (audience.customField.operator === 'has_value' || audience.customField.value)
      ) {
        const { fieldId, operator, value } = audience.customField;
        let q = supabase
          .from('contact_custom_values')
          .select('contact_id, value, contacts!inner(id, name, phone, project_id)')
          .eq('custom_field_id', fieldId);

        if (activeProjectId) {
          q = q.eq('contacts.project_id', activeProjectId);
        }
        if (operator === 'is') q = q.eq('value', value);
        else if (operator === 'is_not') q = q.neq('value', value);
        else if (operator === 'contains') q = q.ilike('value', `%${value}%`);
        else if (operator === 'has_value') q = q.neq('value', '');

        const { data } = await q;
        baseIds = new Set((data ?? []).map((r) => r.contact_id));
        matchesWithVal = (data ?? []).map((r) => {
          const c = r.contacts as unknown as { id: string; name: string | null; phone: string };
          return {
            id: r.contact_id,
            name: c?.name ?? null,
            phone: c?.phone ?? '',
            value: r.value ?? '',
          };
        });
      } else if (
        audience.type === 'csv' &&
        audience.csvContacts &&
        audience.csvContacts.length > 0
      ) {
        setEstimatedCount(audience.csvContacts.length);
        setMatchedPreviewList([]);
        return;
      } else {
        setEstimatedCount(null);
        setMatchedPreviewList([]);
        return;
      }

      // Apply exclude tags
      let excludeSet: Set<string> | null = null;
      if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
        let excludeQuery = supabase
          .from('contact_tags')
          .select('contact_id, contacts!inner(project_id)')
          .in('tag_id', audience.excludeTagIds);
        if (activeProjectId) {
          excludeQuery = excludeQuery.eq('contacts.project_id', activeProjectId);
        }
        const { data: excludeRows } = await excludeQuery;
        excludeSet = new Set((excludeRows ?? []).map((r) => r.contact_id));
      }

      if (baseIds) {
        const effective = [...baseIds].filter((id) => !excludeSet?.has(id));
        setEstimatedCount(effective.length);
        setMatchedPreviewList(matchesWithVal.filter((m) => !excludeSet?.has(m.id)));
      } else {
        let query = supabase
          .from('contacts')
          .select('*', { count: 'exact', head: true });
        if (activeProjectId) {
          query = query.eq('project_id', activeProjectId);
        }
        const { count } = await query;
        const total = count ?? 0;
        setEstimatedCount(excludeSet ? Math.max(0, total - excludeSet.size) : total);
        setMatchedPreviewList([]);
      }
    } finally {
      setLoadingCount(false);
    }
  }, [
    activeProjectId,
    audience.type,
    audience.tagIds,
    audience.customField,
    audience.csvContacts,
    audience.excludeTagIds,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  async function handleCreateCustomField() {
    const name = newFieldName.trim();
    if (!name) return;
    if (!user || !accountId) {
      toast.error('Not authenticated');
      return;
    }

    setCreatingField(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('custom_fields')
        .insert({
          field_name: name,
          field_type: 'text',
          user_id: user.id,
          account_id: accountId,
          project_id: activeProjectId,
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Custom field "${name}" created!`);
      setNewFieldName('');
      setCreateFieldOpen(false);
      await fetchFields();

      // Automatically select the newly created custom field
      if (data) {
        updateCustomField({ fieldId: data.id, operator: 'is', value: '' });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create custom field');
    } finally {
      setCreatingField(false);
    }
  }

  async function openAssignContactsModal() {
    setAssignModalOpen(true);
    setLoadingContactsList(true);
    setAssignContactIds([]);
    setAssignFieldValue(audience.customField?.value || '');

    try {
      const supabase = createClient();
      let query = supabase
        .from('contacts')
        .select('id, name, phone')
        .order('name', { ascending: true, nullsFirst: false });
      if (activeProjectId) {
        query = query.eq('project_id', activeProjectId);
      }
      const { data } = await query;
      setContactsList((data as SimpleContact[]) ?? []);
    } finally {
      setLoadingContactsList(false);
    }
  }

  async function handleSaveContactAssignment() {
    const fieldId = audience.customField?.fieldId;
    if (!fieldId) {
      toast.error('Please select a custom field first');
      return;
    }
    const val = assignFieldValue.trim();
    if (!val) {
      toast.error('Please enter a value for this custom field');
      return;
    }
    if (assignContactIds.length === 0) {
      toast.error('Please select at least one contact');
      return;
    }

    setSavingAssignment(true);
    try {
      const supabase = createClient();

      // Upsert/insert into contact_custom_values for each selected contact
      for (const contactId of assignContactIds) {
        await supabase
          .from('contact_custom_values')
          .delete()
          .eq('contact_id', contactId)
          .eq('custom_field_id', fieldId);

        await supabase.from('contact_custom_values').insert({
          contact_id: contactId,
          custom_field_id: fieldId,
          value: val,
        });
      }

      toast.success(`Assigned "${val}" to ${assignContactIds.length} contact(s)!`);
      setAssignModalOpen(false);

      // Refresh filter value & counts
      updateCustomField({ value: val });
      await fetchEstimatedCount();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign custom field to contacts');
    } finally {
      setSavingAssignment(false);
    }
  }

  function handleCsvFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    setCsvError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        if (!text) {
          setCsvError(t('selectAudience.errorCsvParse'));
          return;
        }

        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          setCsvError(t('selectAudience.errorCsvMissingPhone'));
          return;
        }

        const headerLine = lines[0];
        const headers = headerLine.split(',').map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
        const phoneIdx = headers.findIndex((h) => h.includes('phone') || h.includes('mobile') || h.includes('number'));
        const nameIdx = headers.findIndex((h) => h.includes('name') || h.includes('contact'));

        if (phoneIdx === -1) {
          setCsvError(t('selectAudience.errorCsvMissingPhone'));
          return;
        }

        const parsed: { phone: string; name?: string }[] = [];
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
          const rawPhone = row[phoneIdx];
          if (!rawPhone) continue;
          const phoneDigits = rawPhone.replace(/\D/g, '');
          if (!phoneDigits || phoneDigits.length < 7) continue;

          const phone = rawPhone.startsWith('+') ? rawPhone : `+${phoneDigits}`;
          const name = nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : undefined;
          parsed.push({ phone, name });
        }

        if (parsed.length === 0) {
          setCsvError(t('selectAudience.errorCsvMissingPhone'));
          return;
        }

        onUpdate({
          ...audience,
          csvContacts: parsed,
        });
      } catch (err) {
        console.error('CSV parse error:', err);
        setCsvError(t('selectAudience.errorCsvParse'));
      }
    };
    reader.readAsText(file);
  }

  const filteredContactsForAssign = useMemo(() => {
    if (!assignSearch.trim()) return contactsList;
    const term = assignSearch.toLowerCase();
    return contactsList.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(term)) ||
        c.phone.toLowerCase().includes(term)
    );
  }, [contactsList, assignSearch]);

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      (audience.customField.operator === 'has_value' ||
        audience.customField.value.trim().length > 0)) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0);

  const selectedField = customFields.find((f) => f.id === audience.customField?.fieldId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('selectAudience.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('selectAudience.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map((option) => {
          const isSelected = audience.type === option.type;
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              onClick={() =>
                onUpdate({
                  ...audience,
                  type: option.type,
                  tagIds: option.type === 'tags' ? audience.tagIds : undefined,
                  customField:
                    option.type === 'custom_field'
                      ? audience.customField
                      : undefined,
                  csvContacts:
                    option.type === 'csv' ? audience.csvContacts : undefined,
                })
              }
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-card/50 hover:border-border'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{option.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter by Tags */}
      {audience.type === 'tags' && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">{t('selectAudience.selectTags')}</p>
          {loadingTags ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : tags.length === 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center">
              <p className="text-xs text-muted-foreground">
                {t('selectAudience.noTagsFound')}
              </p>
              <p className="text-[11px] text-muted-foreground">
                You can organize contacts with tags in Contacts, or use <strong>All Contacts</strong> / <strong>Upload CSV</strong> for this broadcast.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Custom Field Audience */}
      {audience.type === 'custom_field' && (
        <div className="space-y-4 rounded-xl border border-border bg-card/50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-foreground">Filter by Custom Field</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setNewFieldName('');
                setCreateFieldOpen(true);
              }}
              className="h-7 text-xs border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Custom Field
            </Button>
          </div>

          {loadingFields ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
              Loading custom fields...
            </div>
          ) : customFields.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Sparkles className="h-8 w-8 text-primary/70" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No Custom Fields in this Project</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Create custom attributes like <strong>VIP Status</strong>, <strong>City</strong>, <strong>Customer Tier</strong>, or <strong>Plan</strong> to segment your audience.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => {
                  setNewFieldName('');
                  setCreateFieldOpen(true);
                }}
                className="bg-primary text-primary-foreground text-xs h-8"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Create First Custom Field
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
                {/* Field Selector */}
                <select
                  value={audience.customField?.fieldId ?? ''}
                  onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                  className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">{t('selectAudience.selectField')}</option>
                  {customFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.field_name}
                    </option>
                  ))}
                </select>

                {/* Operator Selector */}
                <select
                  value={audience.customField?.operator ?? 'is'}
                  onChange={(e) =>
                    updateCustomField({
                      operator: e.target.value as CustomFieldOperator,
                    })
                  }
                  className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {OPERATOR_OPTIONS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {/* Value Input */}
                {audience.customField?.operator === 'has_value' ? (
                  <div className="flex h-9 items-center rounded-lg border border-border/50 bg-muted/40 px-3 text-xs text-muted-foreground">
                    Matches any contact with a value
                  </div>
                ) : (
                  <input
                    type="text"
                    value={audience.customField?.value ?? ''}
                    onChange={(e) => updateCustomField({ value: e.target.value })}
                    placeholder={t('selectAudience.valuePlaceholder')}
                    className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>

              {/* Action Bar: Assign Contacts & Suggestions */}
              {selectedField && (
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {distinctValues.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Existing values:</span>
                        {distinctValues.map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => updateCustomField({ value: val })}
                            className={`rounded-full px-2 py-0.5 text-xs transition-colors border ${
                              audience.customField?.value === val
                                ? 'border-primary bg-primary/20 text-primary font-medium'
                                : 'border-border bg-muted/60 text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No contacts have values for <strong>{selectedField.field_name}</strong> yet.
                      </span>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openAssignContactsModal}
                      className="h-7 text-xs border-dashed border-border bg-card/40 hover:bg-muted"
                    >
                      <UserPlus className="mr-1.5 h-3.5 w-3.5 text-primary" />
                      Set &quot;{selectedField.field_name}&quot; on Contacts
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CSV Audience */}
      {audience.type === 'csv' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">{t('selectAudience.uploadCsv')}</p>
          <p className="text-xs text-muted-foreground">
            {t('selectAudience.csvFormatDesc')}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCsvFileSelect}
            className="hidden"
          />

          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <FileSpreadsheet className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {csvFileName ? csvFileName : 'Click to select CSV file'}
              </p>
              <p className="text-xs text-muted-foreground">
                Must contain a <code>phone</code> column header
              </p>
            </div>
          </div>

          {csvError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{csvError}</span>
            </div>
          )}

          {audience.csvContacts && audience.csvContacts.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                {t('selectAudience.csvContactsFound', { count: audience.csvContacts.length })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      {tags.length > 0 && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <X className="h-4 w-4 text-red-400" />
            <p className="text-sm font-medium text-foreground">
              {t('selectAudience.excludeTags')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-border bg-muted text-muted-foreground hover:border-border'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Audience Summary & Live Contacts Preview */}
      <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Audience Summary</p>
          {matchedPreviewList.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {showPreview ? 'Hide Contacts' : 'Preview Matching Contacts'}
              {showPreview ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Calculating…</span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">estimated recipients</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {audience.type === 'custom_field'
              ? 'Select a custom field and enter a matching value to calculate recipients.'
              : audience.type === 'tags'
                ? 'Select one or more tags above to calculate recipients.'
                : audience.type === 'csv'
                  ? 'Upload a CSV file with contact phone numbers to proceed.'
                  : 'Select an audience type to see the estimate.'}
          </p>
        )}

        {/* Live Matching Contacts Preview Dropdown */}
        {showPreview && matchedPreviewList.length > 0 && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/40 p-2">
            <ul className="divide-y divide-border/60">
              {matchedPreviewList.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-1.5 px-2 text-xs">
                  <div>
                    <span className="font-medium text-foreground">{c.name || 'Unnamed'}</span>
                    <span className="ml-2 text-muted-foreground">{c.phone}</span>
                  </div>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {c.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Modal 1: Quick Add Custom Field */}
      <Dialog open={createFieldOpen} onOpenChange={setCreateFieldOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create Custom Field</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a new custom field attribute for contacts in this project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="nfn" className="text-xs text-muted-foreground">
              Field Name (e.g. VIP Status, City, Customer Tier, Plan)
            </Label>
            <Input
              id="nfn"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              placeholder="e.g. VIP Status"
              className="bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreateCustomField();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateFieldOpen(false)}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateCustomField}
              disabled={creatingField || !newFieldName.trim()}
              className="bg-primary text-primary-foreground"
            >
              {creatingField && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Assign Custom Field Value to Contacts */}
      <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Set &quot;{selectedField?.field_name}&quot; for Contacts
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Choose contacts from this project and assign them a value for this custom field.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 flex-1 overflow-hidden flex flex-col">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Custom Field Value to Set</Label>
              <Input
                value={assignFieldValue}
                onChange={(e) => setAssignFieldValue(e.target.value)}
                placeholder="e.g. VIP, Platinum, Bangalore, Active"
                className="bg-muted border-border text-foreground text-sm"
              />
            </div>

            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Select Contacts ({assignContactIds.length} selected)
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    if (assignContactIds.length === filteredContactsForAssign.length) {
                      setAssignContactIds([]);
                    } else {
                      setAssignContactIds(filteredContactsForAssign.map((c) => c.id));
                    }
                  }}
                  className="text-[11px] text-primary hover:underline"
                >
                  {assignContactIds.length === filteredContactsForAssign.length
                    ? 'Deselect All'
                    : 'Select All'}
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Search contacts by name or phone..."
                  className="pl-8 h-8 text-xs bg-muted border-border text-foreground"
                />
              </div>

              <div className="flex-1 overflow-y-auto max-h-52 rounded-lg border border-border divide-y divide-border/60 bg-muted/20">
                {loadingContactsList ? (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary mr-2" />
                    Loading contacts...
                  </div>
                ) : filteredContactsForAssign.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No contacts found in this project.
                  </div>
                ) : (
                  filteredContactsForAssign.map((contact) => {
                    const isChecked = assignContactIds.includes(contact.id);
                    return (
                      <div
                        key={contact.id}
                        onClick={() => {
                          setAssignContactIds((prev) =>
                            isChecked
                              ? prev.filter((id) => id !== contact.id)
                              : [...prev, contact.id]
                          );
                        }}
                        className={`flex items-center justify-between p-2.5 text-xs cursor-pointer transition-colors ${
                          isChecked ? 'bg-primary/10' : 'hover:bg-muted/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded border ${
                              isChecked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/40'
                            }`}
                          >
                            {isChecked && <Check className="h-3 w-3" />}
                          </div>
                          <span className="font-medium text-foreground">
                            {contact.name || 'Unnamed Contact'}
                          </span>
                        </div>
                        <span className="text-muted-foreground font-mono text-[11px]">
                          {contact.phone}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAssignModalOpen(false)}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveContactAssignment}
              disabled={
                savingAssignment ||
                !assignFieldValue.trim() ||
                assignContactIds.length === 0
              }
              className="bg-primary text-primary-foreground"
            >
              {savingAssignment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save & Apply ({assignContactIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
