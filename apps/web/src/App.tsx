import { useReducer } from 'react'
import { appReducer, INITIAL_STATE } from '@/types'
import { MarkdownInputScreen } from '@/screens/MarkdownInputScreen'
import { ConfigureScreen } from '@/screens/ConfigureScreen'
import { ReviewScreen } from '@/screens/ReviewScreen'

export function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE)

  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">Markdown Annotator</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Annotate terms in markdown with{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;kbd&gt;</code> index tags.
      </p>

      {state.screen === 'input' && (
        <MarkdownInputScreen state={state} dispatch={dispatch} />
      )}
      {state.screen === 'configure' && (
        <ConfigureScreen state={state} dispatch={dispatch} />
      )}
      {state.screen === 'review' && (
        <ReviewScreen state={state} dispatch={dispatch} />
      )}
    </main>
  )
}
