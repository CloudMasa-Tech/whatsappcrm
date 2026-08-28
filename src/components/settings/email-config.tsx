'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Mail, Server, ShieldCheck, Send, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPresetSmtpConfig } from '@/lib/email/presets';

export function EmailConfigPanel() {
  const [provider, setProvider] = useState<'gmail' | 'outlook' | 'zoho' | 'custom'>('custom');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [fromName, setFromName] = useState('MaSa CRM');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch('/api/email/config');
        const data = await res.json();
        if (data?.configured && data?.config) {
          setConfigured(true);
          setHost(data.config.host || '');
          setPort(data.config.port || 587);
          setSecure(Boolean(data.config.secure));
          setUser(data.config.user || '');
          setFromName(data.config.fromName || 'MaSa CRM');
          setFromEmail(data.config.fromEmail || '');
          setReplyTo(data.config.replyTo || '');
        }
      } catch (err) {
        console.error('Failed to load email configuration:', err);
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleProviderSelect = (selected: 'gmail' | 'outlook' | 'zoho' | 'custom') => {
    setProvider(selected);
    if (selected !== 'custom') {
      const preset = getPresetSmtpConfig(selected);
      if (preset.host) setHost(preset.host);
      if (preset.port) setPort(preset.port);
      if (preset.secure !== undefined) setSecure(preset.secure);
    }
  };

  const handleUserChange = (val: string) => {
    setUser(val);
    if (!fromEmail || fromEmail === user) {
      setFromEmail(val);
    }
    // Auto-detect preset if domain matches
    if (val.includes('@gmail.com') && provider !== 'gmail') {
      handleProviderSelect('gmail');
    } else if (
      (val.includes('@outlook.com') || val.includes('@hotmail.com') || val.includes('@office365.com')) &&
      provider !== 'outlook'
    ) {
      handleProviderSelect('outlook');
    } else if (val.includes('@zoho.com') && provider !== 'zoho') {
      handleProviderSelect('zoho');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim() || !user.trim() || !fromEmail.trim()) {
      toast.error('Host, Username/Email, and From Email are required');
      return;
    }

    setSaving(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port,
          secure,
          user,
          pass,
          fromName,
          fromEmail,
          replyTo: replyTo || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save email configuration');
        return;
      }

      toast.success('Email configuration saved successfully');
      setConfigured(true);
    } catch {
      toast.error('Network error saving email settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!host.trim() || !user.trim() || (!pass.trim() && !configured)) {
      toast.error('Please enter email host, email user, and password to test');
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port,
          secure,
          user,
          pass,
          fromName,
          fromEmail: fromEmail || user,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setTestResult({
          success: false,
          message: data.error || 'Connection failed. Please verify credentials.',
        });
        toast.error(data.error || 'Test failed');
        return;
      }

      setTestResult({
        success: true,
        message: data.message || 'Connection verified! Test email sent successfully.',
      });
      toast.success('Email connection verified!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setTestResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Email Connection & SMTP</h2>
        <p className="text-sm text-muted-foreground">
          Connect your email account to send customer welcome invitations, onboarding credentials, and bulk email broadcasts.
        </p>
      </div>

      {configured && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">Email Gateway Active</p>
            <p className="text-xs text-emerald-400/80">
              Sending from <strong>{user}</strong> via <strong>{host}:{port}</strong>
            </p>
          </div>
        </div>
      )}

      {/* Provider Quick Presets */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Email Provider
        </Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { id: 'gmail', label: 'Gmail / Google', icon: Mail },
            { id: 'outlook', label: 'Outlook / 365', icon: Mail },
            { id: 'zoho', label: 'Zoho Mail', icon: Mail },
            { id: 'custom', label: 'Custom SMTP', icon: Server },
          ].map((item) => {
            const isSelected = provider === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleProviderSelect(item.id as any)}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm font-medium transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-user">Email ID / Username *</Label>
            <Input
              id="smtp-user"
              type="email"
              placeholder="e.g. notifications@yourcompany.com"
              value={user}
              onChange={(e) => handleUserChange(e.target.value)}
              required
            />
            {provider === 'gmail' && (
              <p className="text-[11px] text-muted-foreground">
                For Gmail, generate an <strong>App Password</strong> in Google Account Security.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp-pass">
              Password {configured ? '(Leave blank to keep current)' : '*'}
            </Label>
            <Input
              id="smtp-pass"
              type="password"
              placeholder={configured ? '••••••••••••' : 'Enter email or app password'}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              required={!configured}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="smtp-host">SMTP Host *</Label>
            <Input
              id="smtp-host"
              placeholder="e.g. smtp.gmail.com or mail.yourdomain.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp-port">Port *</Label>
            <Input
              id="smtp-port"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="from-name">Sender Name</Label>
            <Input
              id="from-name"
              placeholder="e.g. MaSa CRM Team"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="from-email">From Email Address *</Label>
            <Input
              id="from-email"
              type="email"
              placeholder="e.g. no-reply@yourcompany.com"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reply-to">Reply-To Email (Optional)</Label>
          <Input
            id="reply-to"
            type="email"
            placeholder="e.g. support@yourcompany.com"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
          />
        </div>

        {testResult && (
          <div
            className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${
              testResult.success
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            )}
            <div>
              <p className="font-semibold">{testResult.success ? 'Success' : 'Connection Error'}</p>
              <p className="mt-0.5">{testResult.message}</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || saving}
            className="border-border text-foreground hover:bg-muted"
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing Connection...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Test Email
              </>
            )}
          </Button>

          <Button type="submit" disabled={saving || testing} className="bg-primary text-primary-foreground">
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 h-4 w-4" />
                Save Email Configuration
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
