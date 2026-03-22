import type { AppState, Action } from '@/types'
import { Button } from '@/components/ui/button'

interface Props {
  state: AppState
  dispatch: React.Dispatch<Action>
}

// Full implementation in Phase 3
export function ConfigureScreen({ state, dispatch }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'BACK_TO_INPUT' })}>
          ← Back
        </Button>
        <h2 className="text-lg font-semibold">Configure Annotations</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Screen 2 — coming in Phase 3. Markdown length: {state.markdown.length} chars.
      </p>
    </div>
  )
}
