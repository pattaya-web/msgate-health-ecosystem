"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  BookOpen,
  Clock,
  FileUp,
  Plus,
  Search,
  Sparkles,
  Play,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { mockProvider } from "@/lib/providers/mock-provider";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";
import type { Difficulty, Sop, SopCategory } from "@/types";
import type { CreateSopInput } from "@/lib/providers/types";
import { PageHeader, LoadingState, EmptyState } from "@/components/shared/page-states";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
    .map((line) => line.replace(/^[\s\-•*\d.)]+/, "").trim())
    .filter(Boolean);
}

function parseMiroNotes(text: string) {
  return parseLines(text).map((title) => ({ title }));
}

const emptySopForm = (): CreateSopInput => ({
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

export default function SopListPage() {
  const router = useRouter();
  const { canWrite } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sops, setSops] = useState<Sop[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<SopCategory | "all">("all");

  const [newOpen, setNewOpen] = useState(false);
  const [miroOpen, setMiroOpen] = useState(false);
  const [newForm, setNewForm] = useState<CreateSopInput>(emptySopForm());
  const [newStepsText, setNewStepsText] = useState("");
  const [newPrereqText, setNewPrereqText] = useState("");
  const [newDocsText, setNewDocsText] = useState("");
  const [creating, setCreating] = useState(false);

  const [miroText, setMiroText] = useState("");
  const [miroCategory, setMiroCategory] = useState<SopCategory>("Recovery");
  const [miroTitle, setMiroTitle] = useState("Imported from Miro");

  const loadSops = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mockProvider.getSops();
      setSops(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSops();
  }, [loadSops]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return sops.filter((s) => {
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    });
  }, [sops, search, categoryFilter]);

  const miroPreview = useMemo(() => parseMiroNotes(miroText), [miroText]);

  const startProcedure = (id: string) => {
    toast.success("Procedure started");
    router.push(`/sop/${id}`);
  };

  const handleCreateSop = async () => {
    if (!newForm.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setCreating(true);
    try {
      const input: CreateSopInput = {
        ...newForm,
        prerequisites: parseLines(newPrereqText),
        documents_needed: parseLines(newDocsText),
        steps: parseLines(newStepsText).map((title) => ({ title })),
      };
      const created = await mockProvider.createSop(input);
      toast.success("SOP created");
      setNewOpen(false);
      setNewForm(emptySopForm());
      setNewStepsText("");
      setNewPrereqText("");
      setNewDocsText("");
      await loadSops();
      router.push(`/sop/${created.id}`);
    } catch {
      toast.error("Failed to create SOP");
    } finally {
      setCreating(false);
    }
  };

  const handleMiroImport = async () => {
    const steps = parseMiroNotes(miroText);
    if (steps.length === 0) {
      toast.error("Paste Miro notes with at least one step");
      return;
    }
    setCreating(true);
    try {
      const created = await mockProvider.createSop({
        title: miroTitle.trim() || "Imported from Miro",
        category: miroCategory,
        summary: "Draft SOP imported from Miro notes.",
        objective: "Complete the procedure steps outlined in the imported notes.",
        prerequisites: [],
        documents_needed: [],
        estimated_time: "TBD",
        difficulty: "medium",
        owner: "Operations",
        steps,
      });
      toast.success("Draft SOP created");
      setMiroOpen(false);
      setMiroText("");
      setMiroTitle("Imported from Miro");
      await loadSops();
      router.push(`/sop/${created.id}`);
    } catch {
      toast.error("Failed to create draft SOP");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <LoadingState className="min-h-[480px]" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Standard Operating Procedures"
        description="Operational library for IBO, banking, MID, CRM, recovery, and compliance workflows."
        actions={
          canWrite ? (
            <>
              <Dialog open={miroOpen} onOpenChange={setMiroOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <FileUp className="h-4 w-4" />
                    Import from Miro notes
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Import from Miro notes</DialogTitle>
                    <DialogDescription>
                      Paste sticky notes or checklist items from Miro — one step per line.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="miro-title">Title</Label>
                        <Input
                          id="miro-title"
                          value={miroTitle}
                          onChange={(e) => setMiroTitle(e.target.value)}
                          placeholder="Imported from Miro"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Select
                          value={miroCategory}
                          onValueChange={(v) => setMiroCategory(v as SopCategory)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Recovery">Recovery</SelectItem>
                            <SelectItem value="IBO">IBO</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="miro-text">Miro notes</Label>
                      <Textarea
                        id="miro-text"
                        value={miroText}
                        onChange={(e) => setMiroText(e.target.value)}
                        placeholder={"1. Notify IBO\n2. Switch MID to backup bank\n3. Open recovery case"}
                        className="min-h-[160px] font-mono text-sm"
                      />
                    </div>
                    {miroPreview.length > 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Preview ({miroPreview.length} steps)
                        </div>
                        <ol className="list-inside list-decimal space-y-1 text-sm text-slate-700">
                          {miroPreview.map((step, i) => (
                            <li key={i}>{step.title}</li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                    <Button onClick={handleMiroImport} disabled={creating} className="w-full">
                      <Sparkles className="h-4 w-4" />
                      Create draft SOP
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={newOpen} onOpenChange={setNewOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4" />
                    New SOP
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>New SOP</DialogTitle>
                    <DialogDescription>
                      Create a new standard operating procedure for your team.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="title">Title</Label>
                      <Input
                        id="title"
                        value={newForm.title}
                        onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="Procedure title"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select
                        value={newForm.category}
                        onValueChange={(v) =>
                          setNewForm((f) => ({ ...f, category: v as SopCategory }))
                        }
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
                        value={newForm.difficulty}
                        onValueChange={(v) =>
                          setNewForm((f) => ({ ...f, difficulty: v as Difficulty }))
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
                      <Label htmlFor="summary">Summary</Label>
                      <Textarea
                        id="summary"
                        value={newForm.summary}
                        onChange={(e) => setNewForm((f) => ({ ...f, summary: e.target.value }))}
                        placeholder="Brief description"
                        rows={2}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="objective">Objective</Label>
                      <Textarea
                        id="objective"
                        value={newForm.objective}
                        onChange={(e) => setNewForm((f) => ({ ...f, objective: e.target.value }))}
                        placeholder="What this procedure achieves"
                        rows={2}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="time">Estimated time</Label>
                      <Input
                        id="time"
                        value={newForm.estimated_time}
                        onChange={(e) =>
                          setNewForm((f) => ({ ...f, estimated_time: e.target.value }))
                        }
                        placeholder="e.g. 2–5 days"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="owner">Owner</Label>
                      <Input
                        id="owner"
                        value={newForm.owner}
                        onChange={(e) => setNewForm((f) => ({ ...f, owner: e.target.value }))}
                        placeholder="Team or role"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="prereq">Prerequisites (one per line)</Label>
                      <Textarea
                        id="prereq"
                        value={newPrereqText}
                        onChange={(e) => setNewPrereqText(e.target.value)}
                        placeholder="Active IBO&#10;Bank page ready"
                        rows={3}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="docs">Documents needed (one per line)</Label>
                      <Textarea
                        id="docs"
                        value={newDocsText}
                        onChange={(e) => setNewDocsText(e.target.value)}
                        placeholder="Identity docs&#10;Bank statements"
                        rows={3}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="steps">Steps (one per line)</Label>
                      <Textarea
                        id="steps"
                        value={newStepsText}
                        onChange={(e) => setNewStepsText(e.target.value)}
                        placeholder="Step 1&#10;Step 2&#10;Step 3"
                        rows={5}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setNewOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateSop} disabled={creating}>
                      Create SOP
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : null
        }
      />

      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search procedures..."
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter("all")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              categoryFilter === "all"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                categoryFilter === cat
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No procedures found"
          description={
            search || categoryFilter !== "all"
              ? "Try a different search or category filter."
              : "Create your first SOP to get started."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((sop) => (
            <Card key={sop.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <Badge>{sop.category}</Badge>
                </div>
                <CardTitle className="mt-3 line-clamp-2">{sop.title}</CardTitle>
                <CardDescription className="line-clamp-2">{sop.summary}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge variant={DIFFICULTY_VARIANT[sop.difficulty]} className="capitalize">
                    {sop.difficulty}
                  </Badge>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {sop.estimated_time}
                  </span>
                  <span>Updated {format(new Date(sop.updated_at), "MMM d, yyyy")}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => router.push(`/sop/${sop.id}`)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => startProcedure(sop.id)}>
                    <Play className="h-3.5 w-3.5" />
                    Start procedure
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
