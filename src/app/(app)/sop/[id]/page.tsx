"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  ListChecks,
  Pencil,
  Play,
  Target,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { mockProvider } from "@/lib/providers/mock-provider";
import { useAuth } from "@/lib/auth/auth-context";
import type { Difficulty, Sop, SopCategory } from "@/types";
import type { CreateSopInput } from "@/lib/providers/types";
import { PageHeader, LoadingState, EmptyState } from "@/components/shared/page-states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATEGORIES: SopCategory[] = [
  "IBO",
  "Banking",
  "MID",
  "CRM",
  "Bank Page",
  "Recovery",
  "Finance",
  "Shop",
  "Compliance",
];

const DIFFICULTY_VARIANT: Record<Difficulty, "success" | "warning" | "destructive"> = {
  easy: "success",
  medium: "warning",
  hard: "destructive",
};

function parseLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function linesToText(items: string[]) {
  return items.join("\n");
}

export default function SopDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { canWrite } = useAuth();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [sop, setSop] = useState<Sop | null>(null);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editForm, setEditForm] = useState<CreateSopInput>({
    title: "",
    category: "IBO",
    summary: "",
    objective: "",
    prerequisites: [],
    documents_needed: [],
    estimated_time: "",
    difficulty: "medium",
    owner: "",
    steps: [],
  });
  const [editPrereqText, setEditPrereqText] = useState("");
  const [editDocsText, setEditDocsText] = useState("");
  const [editStepsText, setEditStepsText] = useState("");

  const loadSop = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mockProvider.getSop(id);
      setSop(data);
      if (data) {
        setEditForm({
          title: data.title,
          category: data.category,
          summary: data.summary,
          objective: data.objective,
          prerequisites: data.prerequisites,
          documents_needed: data.documents_needed,
          estimated_time: data.estimated_time,
          difficulty: data.difficulty,
          owner: data.owner,
          steps: data.steps.map((s) => ({ title: s.title, description: s.description ?? undefined })),
        });
        setEditPrereqText(linesToText(data.prerequisites));
        setEditDocsText(linesToText(data.documents_needed));
        setEditStepsText(data.steps.map((s) => s.title).join("\n"));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadSop();
  }, [loadSop]);

  const completedCount = useMemo(
    () => Object.values(checkedSteps).filter(Boolean).length,
    [checkedSteps]
  );

  const progressPercent = sop
    ? Math.round((completedCount / Math.max(sop.steps.length, 1)) * 100)
    : 0;

  const startProcedure = () => {
    toast.success("Procedure started");
  };

  const handleSave = async () => {
    if (!sop || !editForm.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const updated = await mockProvider.updateSop(id, {
        ...editForm,
        prerequisites: parseLines(editPrereqText),
        documents_needed: parseLines(editDocsText),
        steps: parseLines(editStepsText).map((title) => ({ title })),
      });
      setSop(updated);
      setEditOpen(false);
      setCheckedSteps({});
      toast.success("SOP updated");
    } catch {
      toast.error("Failed to update SOP");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingState className="min-h-[480px]" />;
  }

  if (!sop) {
    return (
      <EmptyState
        title="Procedure not found"
        description="This SOP may have been removed or the link is invalid."
        action={
          <Button variant="outline" onClick={() => router.push("/sop")}>
            <ArrowLeft className="h-4 w-4" />
            Back to SOP library
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => router.push("/sop")}>
          <ArrowLeft className="h-4 w-4" />
          Back to SOP library
        </Button>

        <PageHeader
          title={sop.title}
          description={sop.summary}
          actions={
            <>
              <Button variant="outline" onClick={startProcedure}>
                <Play className="h-4 w-4" />
                Start procedure
              </Button>
              {canWrite ? (
                <Button onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge>{sop.category}</Badge>
        <Badge variant={DIFFICULTY_VARIANT[sop.difficulty]} className="capitalize">
          {sop.difficulty}
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          {sop.estimated_time}
        </Badge>
        <Badge variant="outline" className="gap-1">
          <User className="h-3 w-3" />
          {sop.owner}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-emerald-600" />
                Objective
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-slate-700">{sop.objective}</p>
            </CardContent>
          </Card>

          {sop.prerequisites.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Prerequisites
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                  {sop.prerequisites.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-4 w-4 text-emerald-600" />
                  Procedure steps
                </CardTitle>
                <span className="text-xs text-slate-500">
                  {completedCount}/{sop.steps.length} completed ({progressPercent}%)
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {sop.steps
                .slice()
                .sort((a, b) => a.step_order - b.step_order)
                .map((step) => (
                  <label
                    key={step.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition-colors hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={!!checkedSteps[step.id]}
                      onCheckedChange={(checked) =>
                        setCheckedSteps((prev) => ({
                          ...prev,
                          [step.id]: checked === true,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <div>
                      <div
                        className={
                          checkedSteps[step.id]
                            ? "text-sm text-slate-500 line-through"
                            : "text-sm font-medium text-slate-900"
                        }
                      >
                        {step.step_order}. {step.title}
                      </div>
                      {step.description ? (
                        <p className="mt-1 text-xs text-slate-500">{step.description}</p>
                      ) : null}
                    </div>
                  </label>
                ))}
            </CardContent>
          </Card>

          {sop.documents_needed.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  Documents needed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                  {sop.documents_needed.map((doc, i) => (
                    <li key={i}>{doc}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4 text-emerald-600" />
                Meta
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Category</span>
                <span className="font-medium text-slate-900">{sop.category}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Difficulty</span>
                <span className="font-medium capitalize text-slate-900">{sop.difficulty}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Estimated time</span>
                <span className="font-medium text-slate-900">{sop.estimated_time}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Owner</span>
                <span className="font-medium text-slate-900">{sop.owner}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Steps</span>
                <span className="font-medium text-slate-900">{sop.steps.length}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Created</span>
                <span className="font-medium text-slate-900">
                  {format(new Date(sop.created_at), "MMM d, yyyy")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Last updated</span>
                <span className="font-medium text-slate-900">
                  {format(new Date(sop.updated_at), "MMM d, yyyy")}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit SOP</DialogTitle>
            <DialogDescription>Update procedure content and steps.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={editForm.category}
                onValueChange={(v) => setEditForm((f) => ({ ...f, category: v as SopCategory }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Difficulty</Label>
              <Select
                value={editForm.difficulty}
                onValueChange={(v) =>
                  setEditForm((f) => ({ ...f, difficulty: v as Difficulty }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-summary">Summary</Label>
              <Textarea
                id="edit-summary"
                value={editForm.summary}
                onChange={(e) => setEditForm((f) => ({ ...f, summary: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-objective">Objective</Label>
              <Textarea
                id="edit-objective"
                value={editForm.objective}
                onChange={(e) => setEditForm((f) => ({ ...f, objective: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-time">Estimated time</Label>
              <Input
                id="edit-time"
                value={editForm.estimated_time}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, estimated_time: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-owner">Owner</Label>
              <Input
                id="edit-owner"
                value={editForm.owner}
                onChange={(e) => setEditForm((f) => ({ ...f, owner: e.target.value }))}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-prereq">Prerequisites (one per line)</Label>
              <Textarea
                id="edit-prereq"
                value={editPrereqText}
                onChange={(e) => setEditPrereqText(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-docs">Documents needed (one per line)</Label>
              <Textarea
                id="edit-docs"
                value={editDocsText}
                onChange={(e) => setEditDocsText(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="edit-steps">Steps (one per line)</Label>
              <Textarea
                id="edit-steps"
                value={editStepsText}
                onChange={(e) => setEditStepsText(e.target.value)}
                rows={6}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              Save changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
