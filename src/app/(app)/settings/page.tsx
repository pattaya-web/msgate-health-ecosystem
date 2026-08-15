"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Database, Lock, Save, Shield } from "lucide-react";
import { toast } from "sonner";
import { mockProvider } from "@/lib/providers/mock-provider";
import { useAuth } from "@/lib/auth/auth-context";
import type { AppSettings, SystemHealthRule } from "@/types";
import { PageHeader, LoadingState } from "@/components/shared/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

const thresholdsSchema = z.object({
  min_active_banks: z.number().int().min(0),
  min_active_mids: z.number().int().min(0),
  recommended_banks_per_ibo: z.number().int().min(1),
  max_underwriting_days: z.number().int().min(1),
  max_payout_delay_days: z.number().int().min(1),
  churn_threshold: z.number().min(0).max(100),
});

const localeSchema = z.object({
  currency: z.string().min(3).max(3),
  timezone: z.string().min(1),
  sync_frequency_minutes: z.number().int().min(5),
});

type ThresholdsForm = z.infer<typeof thresholdsSchema>;
type LocaleForm = z.infer<typeof localeSchema>;

const CURRENCIES = ["USD", "EUR", "GBP", "CAD"];
const TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

export default function SettingsPage() {
  const { canWrite, isAdmin } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [healthRules, setHealthRules] = useState<SystemHealthRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRules, setSavingRules] = useState(false);

  const thresholdsForm = useForm<ThresholdsForm>({
    resolver: zodResolver(thresholdsSchema) as Resolver<ThresholdsForm>,
  });

  const localeForm = useForm<LocaleForm>({
    resolver: zodResolver(localeSchema) as Resolver<LocaleForm>,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [settingsData, rulesData] = await Promise.all([
      mockProvider.getSettings(),
      mockProvider.getHealthRules(),
    ]);
    setSettings(settingsData);
    setHealthRules(rulesData);
    thresholdsForm.reset({
      min_active_banks: settingsData.min_active_banks,
      min_active_mids: settingsData.min_active_mids,
      recommended_banks_per_ibo: settingsData.recommended_banks_per_ibo,
      max_underwriting_days: settingsData.max_underwriting_days,
      max_payout_delay_days: settingsData.max_payout_delay_days,
      churn_threshold: settingsData.churn_threshold,
    });
    localeForm.reset({
      currency: settingsData.currency,
      timezone: settingsData.timezone,
      sync_frequency_minutes: settingsData.sync_frequency_minutes,
    });
    setLoading(false);
  }, [thresholdsForm, localeForm]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function saveThresholds(values: ThresholdsForm) {
    if (!canWrite) return;
    try {
      const updated = await mockProvider.updateSettings(values);
      setSettings(updated);
      toast.success("Thresholds saved");
    } catch {
      toast.error("Failed to save thresholds");
    }
  }

  async function saveLocale(values: LocaleForm) {
    if (!canWrite) return;
    try {
      const updated = await mockProvider.updateSettings(values);
      setSettings(updated);
      toast.success("Locale settings saved");
    } catch {
      toast.error("Failed to save locale settings");
    }
  }

  function updateRule(id: string, patch: Partial<SystemHealthRule>) {
    setHealthRules((prev) =>
      prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    );
  }

  async function saveHealthRules() {
    if (!isAdmin) return;
    setSavingRules(true);
    try {
      const updated = await mockProvider.updateHealthRules(healthRules);
      setHealthRules(updated);
      toast.success("Health rules saved");
    } catch {
      toast.error("Failed to save health rules");
    } finally {
      setSavingRules(false);
    }
  }

  if (loading || !settings) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure operational thresholds, locale preferences, and system health scoring rules."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-600" />
              Thresholds
            </CardTitle>
            <CardDescription>
              Infrastructure and business alert thresholds used across the cockpit.
              {!canWrite ? " Read-only for your role." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={thresholdsForm.handleSubmit(saveThresholds)}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="min_active_banks">Min active banks</Label>
                  <Input
                    id="min_active_banks"
                    type="number"
                    disabled={!canWrite}
                    {...thresholdsForm.register("min_active_banks", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="min_active_mids">Min active MIDs</Label>
                  <Input
                    id="min_active_mids"
                    type="number"
                    disabled={!canWrite}
                    {...thresholdsForm.register("min_active_mids", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recommended_banks_per_ibo">Recommended banks / IBO</Label>
                  <Input
                    id="recommended_banks_per_ibo"
                    type="number"
                    disabled={!canWrite}
                    {...thresholdsForm.register("recommended_banks_per_ibo", {
                      valueAsNumber: true,
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max_underwriting_days">Max underwriting days</Label>
                  <Input
                    id="max_underwriting_days"
                    type="number"
                    disabled={!canWrite}
                    {...thresholdsForm.register("max_underwriting_days", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max_payout_delay_days">Max payout delay days</Label>
                  <Input
                    id="max_payout_delay_days"
                    type="number"
                    disabled={!canWrite}
                    {...thresholdsForm.register("max_payout_delay_days", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="churn_threshold">Churn threshold (%)</Label>
                  <Input
                    id="churn_threshold"
                    type="number"
                    step="0.1"
                    disabled={!canWrite}
                    {...thresholdsForm.register("churn_threshold", { valueAsNumber: true })}
                  />
                </div>
              </div>
              {canWrite ? (
                <Button type="submit" disabled={thresholdsForm.formState.isSubmitting}>
                  <Save className="h-4 w-4" />
                  Save thresholds
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Locale & sync</CardTitle>
            <CardDescription>
              Display currency, timezone, and mock sync frequency.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={localeForm.handleSubmit(saveLocale)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select
                    value={localeForm.watch("currency")}
                    onValueChange={(v) => localeForm.setValue("currency", v)}
                    disabled={!canWrite}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select
                    value={localeForm.watch("timezone")}
                    onValueChange={(v) => localeForm.setValue("timezone", v)}
                    disabled={!canWrite}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sync_frequency_minutes">Sync frequency (minutes)</Label>
                  <Input
                    id="sync_frequency_minutes"
                    type="number"
                    disabled={!canWrite}
                    {...localeForm.register("sync_frequency_minutes", { valueAsNumber: true })}
                  />
                </div>
              </div>
              {canWrite ? (
                <Button type="submit" disabled={localeForm.formState.isSubmitting}>
                  <Save className="h-4 w-4" />
                  Save locale
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  System health rules
                  {!isAdmin ? (
                    <Badge variant="outline" className="gap-1 font-normal">
                      <Lock className="h-3 w-3" />
                      Admin only
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>
                  Penalty rules applied when calculating the ecosystem health score.
                </CardDescription>
              </div>
              {isAdmin ? (
                <Button onClick={saveHealthRules} disabled={savingRules}>
                  <Save className="h-4 w-4" />
                  {savingRules ? "Saving…" : "Save rules"}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {healthRules.map((rule) => (
              <div
                key={rule.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-900">{rule.label}</p>
                    {!rule.enabled ? (
                      <Badge variant="secondary">Disabled</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">{rule.description}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`penalty-${rule.id}`} className="text-xs text-slate-500">
                      Penalty
                    </Label>
                    <Input
                      id={`penalty-${rule.id}`}
                      type="number"
                      className="w-20"
                      value={rule.penalty}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        updateRule(rule.id, { penalty: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`enabled-${rule.id}`} className="text-xs text-slate-500">
                      Enabled
                    </Label>
                    <Switch
                      id={`enabled-${rule.id}`}
                      checked={rule.enabled}
                      disabled={!isAdmin}
                      onCheckedChange={(checked) => updateRule(rule.id, { enabled: checked })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-600" />
              Airtable integration
              {!isAdmin ? (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Lock className="h-3 w-3" />
                  Admin only
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Future Airtable sync configuration. API credentials are stored server-side only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Base ID</Label>
                <Input
                  value={settings.airtable_base_id ?? "Not configured"}
                  readOnly
                  disabled
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="flex h-10 items-center">
                  <Badge variant={settings.airtable_configured ? "success" : "secondary"}>
                    {settings.airtable_configured ? "Configured" : "Not configured"}
                  </Badge>
                </div>
              </div>
            </div>
            <Separator />
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Server-only API key</p>
              <p className="mt-1">
                The Airtable API key is read from{" "}
                <code className="rounded bg-white px-1.5 py-0.5 text-xs">AIRTABLE_API_KEY</code>{" "}
                environment variable on the server. It is never exposed to the client.
              </p>
              {isAdmin ? (
                <p className="mt-2 text-xs text-slate-500">
                  Set{" "}
                  <code className="rounded bg-white px-1 py-0.5">AIRTABLE_BASE_ID</code> in your
                  deployment environment to enable sync.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
