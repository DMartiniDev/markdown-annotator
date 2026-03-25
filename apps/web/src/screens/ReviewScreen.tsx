import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { AppState, Action, MatchInfo } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isEffectivelySuppressed } from "@/lib/match-utils";
import { buildPositionAnnotatedMarkdown, downloadJson, downloadText } from "@/lib/export";
import { timestampPrefix } from "@/lib/timestamp";

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

// ---------------------------------------------------------------------------
// Per-match form — remounts on every index change via key={currentMatchIndex}
// so all useState values initialise fresh from the new match.
// ---------------------------------------------------------------------------

interface MatchFormProps {
  match: MatchInfo;
  onAccept: (values: {
    name: string;
    parent?: string;
    important: boolean;
  }) => void;
  onSkip: () => void;
  onReset: () => void;
}

function MatchForm({ match, onAccept, onSkip, onReset }: MatchFormProps) {
  const [name, setName] = useState(match.name);
  const [parent, setParent] = useState(match.parent ?? "");
  const [important, setImportant] = useState(match.important);
  const markRef = useRef<HTMLElement>(null);

  // Scroll the highlighted term into view whenever this match is displayed
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  function handleAccept() {
    onAccept({
      name: name.trim() || match.sourceName,
      parent: parent.trim() || undefined,
      important,
    });
  }

  const alreadyDecided = match.status !== "pending";

  return (
    <div className="space-y-4">
      {/* Context display — plain React interpolation, never dangerouslySetInnerHTML.
          contextBefore/contextAfter come from raw user markdown and may contain
          <, >, & — React escapes them automatically when rendered as text nodes. */}
      <div className="h-40 overflow-y-auto rounded-md border border-input bg-background px-3 py-2 font-mono text-sm whitespace-pre-wrap break-words text-foreground">
        <span>{match.contextBefore}</span>
        <mark
          ref={markRef}
          className="bg-yellow-200 dark:bg-yellow-800 text-foreground rounded px-0.5"
        >
          {match.matchedTerm}
        </mark>
        <span>{match.contextAfter}</span>
      </div>

      {/* Badges */}
      <div className="flex gap-2 flex-wrap">
        {match.footnote && (
          <Badge variant="outline" className="text-xs">
            in footnote
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs font-mono">
          {match.matchedTerm}
        </Badge>
      </div>

      {/* Editable fields */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="match-name">Index entry name</Label>
          <Input
            id="match-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={match.sourceName}
            disabled={alreadyDecided}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="match-parent">
            Parent{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </Label>
          <Input
            id="match-parent"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            placeholder={match.sourceParent ?? "none"}
            disabled={alreadyDecided}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="match-important"
            checked={important}
            onChange={(e) => setImportant(e.target.checked)}
            disabled={alreadyDecided}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          <Label
            htmlFor="match-important"
            className="font-normal cursor-pointer"
          >
            Important
          </Label>
        </div>
      </div>

      {/* Decision buttons */}
      {alreadyDecided ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          This match was{" "}
          <span
            className={
              match.status === "accepted"
                ? "text-green-600"
                : "text-muted-foreground"
            }
          >
            {match.status}
          </span>
          .
          <Button variant="outline" size="sm" onClick={onReset}>
            Reset
          </Button>
        </p>
      ) : (
        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onSkip} className="flex-1">
            Skip
          </Button>
          <Button onClick={handleAccept} className="flex-1">
            Accept →
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewScreen
// ---------------------------------------------------------------------------

export function ReviewScreen({ state, dispatch }: Props) {
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const hasAutoExported = useRef(false);

  const { matches, currentMatchIndex } = state;
  const currentMatch = matches[currentMatchIndex];

  const acceptedCount = matches.filter((m) => m.status === "accepted").length;
  // Suppressed matches (pending but covered by an accepted longer match from the same entry)
  // count as decided — exclude them from the actionable pending count.
  const pendingCount = matches.filter(
    (m) => m.status === "pending" && !isEffectivelySuppressed(m, matches),
  ).length;
  const allDecided = matches.length > 0 && pendingCount === 0;

  // Auto-scroll the match list to keep the active item visible
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentMatchIndex]);

  // Auto-export once when all matches are decided and at least one was accepted
  useEffect(() => {
    if (allDecided && acceptedCount > 0 && !hasAutoExported.current) {
      hasAutoExported.current = true;
      const ok = handleExportMarkdown();
      if (ok) toast.success("Document exported!");
    }
    // handleExportMarkdown is stable for this one-shot use; ref guard makes stale closure safe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDecided, acceptedCount]);

  // ---------------------------------------------------------------------------
  // Accept / Skip handlers
  // ---------------------------------------------------------------------------

  function handleAccept(values: {
    name: string;
    parent?: string;
    important: boolean;
  }) {
    dispatch({ type: "ACCEPT_MATCH", payload: values });
  }

  function handleSkip() {
    dispatch({ type: "SKIP_MATCH" });
  }

  function handleReset() {
    dispatch({ type: "RESET_MATCH" });
  }

  // ---------------------------------------------------------------------------
  // Export session
  // ---------------------------------------------------------------------------

  function handleExportSession() {
    downloadJson(
      {
        markdown: state.markdown,
        matchesInfo: state.matches,
        annotateEntries: state.annotateEntries.map(({ name, terms, parent }) => ({ name, terms, parent })),
      },
      `${timestampPrefix()}_session.json`,
    );
    toast.success("Session saved!");
  }

  // ---------------------------------------------------------------------------
  // Export annotated markdown
  function handleExportMarkdown(): boolean {
    const accepted = matches.filter(m => m.status === 'accepted')
    const result = buildPositionAnnotatedMarkdown(state.markdown, accepted)
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    const stem = state.sourceFilename
      ? state.sourceFilename.slice(0, state.sourceFilename.lastIndexOf('.')) || 'noname'
      : 'noname'
    downloadText(result.value, `${timestampPrefix()}_${stem}.md`);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (matches.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: "BACK_TO_CONFIGURE" })}
          >
            ← Back to Configure
          </Button>
          <h2 className="text-lg font-semibold">Review Matches</h2>
        </div>
        <p className="text-sm text-muted-foreground">No matches found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "BACK_TO_CONFIGURE" })}
        >
          ← Back to Configure
        </Button>
        <h2 className="text-lg font-semibold">Review Matches</h2>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {acceptedCount} accepted · {pendingCount} pending
          </span>

          <Button variant="outline" size="sm" onClick={handleExportSession}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Save session
          </Button>

          <Button
            size="sm"
            onClick={() => {
              const ok = handleExportMarkdown();
              if (ok) toast.success("Document exported!");
            }}
            disabled={!allDecided || acceptedCount === 0}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Export .md
          </Button>
        </div>
      </div>

      {/* Body: match list + current match form */}
      <div className="flex gap-6 items-stretch">
        {/* Left: match list — height matches right column, scrollable */}
        <div className="w-56 shrink-0 overflow-y-auto pr-1 self-stretch h-[426px] border-2 border-solid">
          {matches.map((match, index) => {
            const isActive = index === currentMatchIndex
            const suppressed = isEffectivelySuppressed(match, matches)
            return (
              <button
                key={match.id}
                ref={isActive ? activeItemRef : null}
                onClick={() =>
                  dispatch({ type: "SET_CURRENT_INDEX", payload: index })
                }
                className={cn(
                  "w-full text-left rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                  suppressed && !isActive && "opacity-40",
                )}
              >
                <div className="flex items-center gap-2">
                  <StatusDot
                    status={match.status}
                    active={isActive}
                    suppressed={suppressed}
                  />
                  <span className="truncate font-medium">{match.sourceName}</span>
                </div>
                <div className="truncate text-xs mt-0.5 opacity-70 font-mono">
                  {match.matchedTerm}
                </div>
              </button>
            )
          })}
        </div>

        {/* Right: per-match form — key forces remount on navigation or status change */}
        <div key={`${currentMatchIndex}-${currentMatch?.status ?? ''}`} className="flex-1 min-w-0">
          {currentMatch ? (
            isEffectivelySuppressed(currentMatch, matches) ? (
              <p className="text-sm text-muted-foreground p-1">
                This match is suppressed — another match was accepted at this location.
              </p>
            ) : (
              <MatchForm
                match={currentMatch}
                onAccept={handleAccept}
                onSkip={handleSkip}
                onReset={handleReset}
              />
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a match to review.
            </p>
          )}
        </div>
      </div>

      {allDecided && (
        <p className="text-sm text-green-600">
          All matches reviewed.{" "}
          {acceptedCount > 0
            ? 'Click "Export .md" to download the annotated document.'
            : "No matches accepted — nothing to export."}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status indicator dot
// ---------------------------------------------------------------------------

function StatusDot({
  status,
  active,
  suppressed,
}: {
  status: MatchInfo["status"];
  active: boolean;
  suppressed?: boolean;
}) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full shrink-0",
        active
          ? "bg-primary-foreground"
          : suppressed
            ? "bg-muted-foreground/30"
            : status === "accepted"
              ? "bg-green-500"
              : status === "skipped"
                ? "bg-muted-foreground/40"
                : "bg-yellow-400",
      )}
    />
  );
}
