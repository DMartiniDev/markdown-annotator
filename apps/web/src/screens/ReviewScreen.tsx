import type { AppState, Action } from '@/types'
import { Button } from '@/components/ui/button'

interface Props {
  state: AppState
  dispatch: React.Dispatch<Action>
}

// Full implementation in Phase 4
export function ReviewScreen({ state, dispatch }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: 'BACK_TO_CONFIGURE' })}
        >
          ← Back to Configure
        </Button>
        <h2 className="text-lg font-semibold">Review Matches</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Screen 3 — coming in Phase 4. {state.matches.length} matches found.
      </p>
    </div>
  )
}
