import { findMatches } from './find-matches'
import type { WebAnnotateInfo, MatchInfo } from '@/types'

interface WorkerRequest {
  markdown: string
  annotateEntries: WebAnnotateInfo[]
}

interface WorkerSuccessResponse {
  matches: MatchInfo[]
}

interface WorkerErrorResponse {
  error: string
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { markdown, annotateEntries } = event.data
  try {
    const matches = findMatches(markdown, annotateEntries)
    const response: WorkerSuccessResponse = { matches }
    self.postMessage(response)
  } catch (err) {
    const response: WorkerErrorResponse = {
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
}
