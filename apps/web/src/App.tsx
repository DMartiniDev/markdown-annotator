import { useReducer, useRef, useState } from "react";
import { Upload, Sun, Moon, Monitor, Heart } from "lucide-react";
import { Toaster, toast } from "sonner";
import { appReducer, INITIAL_STATE } from "@/types";
import { MarkdownInputScreen } from "@/screens/MarkdownInputScreen";
import { ConfigureScreen } from "@/screens/ConfigureScreen";
import { ReviewScreen } from "@/screens/ReviewScreen";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SessionSchema } from "@/lib/schemas";
import { useTheme, type Theme } from "@/hooks/use-theme";

const NEXT_THEME: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const THEME_LABEL: Record<Theme, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};

export function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [sessionImportPending, setSessionImportPending] = useState(false);
  const { theme, setTheme } = useTheme();

  function handleImportSession(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== "string") {
        toast.error("Invalid session file.");
        return;
      }
      try {
        const json = JSON.parse(text);
        const result = SessionSchema.safeParse(json);
        if (!result.success) {
          toast.error("Invalid session file.");
          return;
        }
        const annotateEntries = result.data.annotateEntries.map((entry) => ({
          ...entry,
          id: crypto.randomUUID(),
        }));
        dispatch({
          type: "IMPORT_SESSION",
          payload: {
            matches: result.data.matchesInfo,
            markdown: result.data.markdown,
            annotateEntries,
          },
        });
        dispatch({ type: "GO_TO_SCREEN", payload: "review" });
        toast.success("Session imported!");
      } catch {
        toast.error("Invalid session file.");
      }
    };
    reader.readAsText(file);
    if (importInputRef.current) importInputRef.current.value = "";
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="container mx-auto max-w-5xl px-4 py-8 flex-1">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h1
              className={`text-2xl font-bold${state.screen !== 'input' ? ' cursor-pointer hover:underline' : ''}`}
              onClick={state.screen !== 'input' ? () => dispatch({ type: 'BACK_TO_INPUT' }) : undefined}
            >
              Markdown Annotator
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Annotate terms in markdown with{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                &lt;kbd&gt;
              </code>{" "}
              index tags.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSessionImportPending(true)}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              Import session
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => handleImportSession(e.target.files?.[0])}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(NEXT_THEME[theme])}
              title={THEME_LABEL[theme]}
              aria-label={THEME_LABEL[theme]}
            >
              {theme === "light" && <Sun className="h-4 w-4" />}
              {theme === "dark" && <Moon className="h-4 w-4" />}
              {theme === "system" && <Monitor className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="mt-8">
          {state.screen === "input" && (
            <MarkdownInputScreen state={state} dispatch={dispatch} />
          )}
          {state.screen === "configure" && (
            <ConfigureScreen state={state} dispatch={dispatch} />
          )}
          {state.screen === "review" && (
            <ReviewScreen state={state} dispatch={dispatch} />
          )}
        </div>

        <ConfirmDialog
          open={sessionImportPending}
          title="Replace current session?"
          description="Your current markdown, annotation config, and review decisions will be overwritten. Any unsaved progress will be lost."
          onConfirm={() => {
            setSessionImportPending(false);
            importInputRef.current?.click();
          }}
          onCancel={() => setSessionImportPending(false)}
        />
        <Toaster />
      </main>
      <footer className="py-4 text-center text-sm text-muted-foreground space-y-1">
        <p>Markdown Annotator: v{__APP_VERSION__}</p>
        <p>
          Made with{" "}
          <Heart
            className="inline h-4 w-4 fill-red-500 text-red-500"
            aria-label="love"
          />{" "}
          by{" "}
          <a href="https://github.com/DMartiniDev" target="_blank">
            DMartiniDev
          </a>
        </p>
      </footer>
    </div>
  );
}
