import { useReducer, useRef } from 'react'
import { Upload } from 'lucide-react'
import { appReducer, INITIAL_STATE } from '@/types'
import { MarkdownInputScreen } from '@/screens/MarkdownInputScreen'
import { ConfigureScreen } from '@/screens/ConfigureScreen'
import { ReviewScreen } from '@/screens/ReviewScreen'
import { Button } from '@/components/ui/button'
import { SessionSchema } from '@/lib/schemas'

export function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE)
  const importInputRef = useRef<HTMLInputElement>(null)

  function handleImportSession(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text !== 'string') return
      try {
        const json = JSON.parse(text)
        const result = SessionSchema.safeParse(json)
        if (!result.success) return
        dispatch({ type: 'IMPORT_SESSION', payload: { matches: result.data.matchesInfo } })
        dispatch({ type: 'GO_TO_SCREEN', payload: 'review' })
      } catch { /* ignore malformed JSON */ }
    }
    reader.readAsText(file)
    if (importInputRef.current) importInputRef.current.value = ''
  }

  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold">Markdown Annotator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Annotate terms in markdown with{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;kbd&gt;</code> index tags.
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            Import session
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={e => handleImportSession(e.target.files?.[0])}
          />
        </div>
      </div>

      <div className="mt-8">
        {state.screen === 'input' && (
          <MarkdownInputScreen state={state} dispatch={dispatch} />
        )}
        {state.screen === 'configure' && (
          <ConfigureScreen state={state} dispatch={dispatch} />
        )}
        {state.screen === 'review' && (
          <ReviewScreen state={state} dispatch={dispatch} />
        )}
      </div>
    </main>
  )
}
