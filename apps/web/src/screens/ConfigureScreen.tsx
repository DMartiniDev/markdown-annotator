import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, Plus, Upload, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AppState, Action, WebAnnotateInfo } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnnotateEntryDialog } from "@/components/AnnotateEntryDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { AnnotateEntryFormValues } from "@/lib/schemas";
import { AnnotationConfigSchema, formatZodError } from "@/lib/schemas";
import { downloadJson } from "@/lib/export";
import { timestampPrefix } from "@/lib/timestamp";
import FindMatchesWorker from "../lib/find-matches.worker?worker";
import type { WorkerResponse } from "@/lib/find-matches.worker";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

type DialogState =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "edit"; index: number };

export function ConfigureScreen({ state, dispatch }: Props) {
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [jsonImportPending, setJsonImportPending] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Terminate any in-flight worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Entry CRUD
  // ---------------------------------------------------------------------------

  function handleAddSubmit(values: AnnotateEntryFormValues) {
    const newEntry: WebAnnotateInfo = {
      id: crypto.randomUUID(),
      name: values.name,
      terms: values.terms.map((t) => t.value),
      parent: values.parent ?? undefined,
    };
    dispatch({
      type: "SET_ANNOTATE_ENTRIES",
      payload: [...state.annotateEntries, newEntry],
    });
    setDialog({ mode: "closed" });
  }

  function handleEditSubmit(values: AnnotateEntryFormValues) {
    if (dialog.mode !== "edit") return;
    const updated = state.annotateEntries.map((entry, i) =>
      i === dialog.index
        ? {
            ...entry,
            name: values.name,
            terms: values.terms.map((t) => t.value),
            parent: values.parent ?? undefined,
          }
        : entry,
    );
    dispatch({ type: "SET_ANNOTATE_ENTRIES", payload: updated });
    setDialog({ mode: "closed" });
  }

  function handleDelete(index: number) {
    const updated = state.annotateEntries.filter((_, i) => i !== index);
    dispatch({ type: "SET_ANNOTATE_ENTRIES", payload: updated });
  }

  // ---------------------------------------------------------------------------
  // Import / Export
  // ---------------------------------------------------------------------------

  function handleExport() {
    downloadJson(
      {
        annotateInfo: state.annotateEntries.map(({ name, terms, parent }) => ({
          name,
          terms,
          parent,
        })),
      },
      `${timestampPrefix()}_annotations.json`,
    );
    toast.success("Annotations exported!");
  }

  function handleImportFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== "string") {
        toast.error("Failed to read file.");
        return;
      }
      try {
        const json = JSON.parse(text);
        const result = AnnotationConfigSchema.safeParse(json);
        if (!result.success) {
          toast.error(formatZodError(result.error));
          return;
        }
        const entries: WebAnnotateInfo[] = result.data.annotateInfo.map(
          (info) => ({
            id: crypto.randomUUID(),
            name: info.name,
            terms: [...info.terms],
            parent: info.parent,
          }),
        );
        dispatch({ type: "SET_ANNOTATE_ENTRIES", payload: entries });
        toast.success("Annotations imported!");
      } catch {
        toast.error("Invalid JSON file.");
      }
    };
    reader.onerror = () => toast.error("Failed to read file.");
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    if (importInputRef.current) importInputRef.current.value = "";
  }

  // ---------------------------------------------------------------------------
  // Process (Web Worker)
  // ---------------------------------------------------------------------------

  function handleProcess() {
    if (isProcessing) return;

    // Terminate any stale worker
    workerRef.current?.terminate();

    const worker = new FindMatchesWorker();

    workerRef.current = worker;
    setIsProcessing(true);
    setProcessError(null);

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      setIsProcessing(false);
      workerRef.current = null;
      const response = e.data;
      if ("error" in response) {
        setProcessError(response.error);
      } else {
        dispatch({ type: "MERGE_MATCHES", payload: { newMatches: response.matches, priorMatches: state.matches } });
        dispatch({ type: "GO_TO_SCREEN", payload: "review" });
      }
      worker.terminate();
    };
    worker.onerror = (e) => {
      setIsProcessing(false);
      setProcessError(e.message ?? "Worker error");
      workerRef.current = null;
      worker.terminate();
    };

    worker.postMessage({
      markdown: state.markdown,
      annotateEntries: state.annotateEntries,
    });
  }

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const editingEntry =
    dialog.mode === "edit"
      ? (state.annotateEntries[dialog.index] ?? null)
      : null;

  const canProcess = state.annotateEntries.length > 0 && !isProcessing;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "BACK_TO_INPUT" })}
          disabled={isProcessing}
        >
          ← Back
        </Button>
        <h2 className="text-lg font-semibold">Configure Annotations</h2>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setDialog({ mode: "add" })}>
          <Plus className="mr-1 h-4 w-4" />
          Add Entry
        </Button>

        <div className="flex gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={isProcessing || dialog.mode !== "closed"}
            onClick={() => {
              if (state.annotateEntries.length > 0) {
                setJsonImportPending(true)
              } else {
                importInputRef.current?.click()
              }
            }}
          >
            <Upload className="mr-1 h-4 w-4" />
            Import JSON
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => handleImportFile(e.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={state.annotateEntries.length === 0}
          >
            <Download className="mr-1 h-4 w-4" />
            Export JSON
          </Button>
        </div>
      </div>

      {/* Entry table */}
      {state.annotateEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No entries yet. Add an entry or import a JSON config.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.annotateEntries.map((entry, index) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {entry.parent ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {entry.terms.map((term) => (
                        <Badge
                          key={term}
                          variant="secondary"
                          className="text-xs"
                        >
                          {term}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDialog({ mode: "edit", index })}
                        aria-label={`Edit ${entry.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(index)}
                        aria-label={`Delete ${entry.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Process */}
      {processError && (
        <p className="text-sm text-destructive">{processError}</p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleProcess} disabled={!canProcess}>
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing…
            </>
          ) : (
            "Process Document →"
          )}
        </Button>
      </div>

      {/* Add / Edit dialog */}
      <AnnotateEntryDialog
        open={dialog.mode !== "closed"}
        initialValues={editingEntry}
        onSubmit={dialog.mode === "add" ? handleAddSubmit : handleEditSubmit}
        onClose={() => setDialog({ mode: "closed" })}
      />

      {/* Import JSON confirmation */}
      <ConfirmDialog
        open={jsonImportPending}
        title="Replace annotation config?"
        description="Your current annotation entries will be overwritten by the imported file."
        onConfirm={() => {
          setJsonImportPending(false)
          importInputRef.current?.click()
        }}
        onCancel={() => setJsonImportPending(false)}
      />
    </div>
  );
}
