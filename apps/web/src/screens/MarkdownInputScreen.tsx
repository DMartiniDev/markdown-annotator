import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AppState, Action } from '@/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 // 2MB
const ACCEPTED_EXTENSIONS = /\.(md|markdown)$/i

interface Props {
  state: AppState
  dispatch: React.Dispatch<Action>
}

export function MarkdownInputScreen({ state, dispatch }: Props) {
  const [mode, setMode] = useState<'upload' | 'type'>(state.markdown ? 'type' : 'upload')
  const [isDragActive, setIsDragActive] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const dragCounter = useRef(0)
  const activeReaderRef = useRef<FileReader | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Read file via FileReader with cancellation support
  useEffect(() => {
    if (!selectedFile) return

    let cancelled = false
    const reader = new FileReader()
    activeReaderRef.current = reader

    reader.onload = (e) => {
      if (cancelled) return
      const result = e.target?.result
      if (typeof result === 'string') {
        dispatch({ type: 'SET_MARKDOWN', payload: result })
        dispatch({ type: 'SET_SOURCE_FILENAME', payload: selectedFile.name })
        setMode('type')
        toast.success('File loaded!')
      }
      activeReaderRef.current = null
    }

    reader.onerror = () => {
      if (!cancelled) toast.error('Failed to read file. Please try again.')
      activeReaderRef.current = null
    }

    reader.readAsText(selectedFile)

    return () => {
      cancelled = true
      reader.abort()
      activeReaderRef.current = null
    }
  }, [selectedFile, dispatch])

  function processFile(file: File | undefined) {
    if (!file) return

    // Abort any in-flight read
    if (activeReaderRef.current) {
      activeReaderRef.current.abort()
      activeReaderRef.current = null
    }

    if (!ACCEPTED_EXTENSIONS.test(file.name)) {
      toast.error('Please upload a .md or .markdown file.')
      return
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error('File is too large. Maximum size is 2MB.')
      return
    }

    setSelectedFile(file)
  }

  // Drag and drop handlers using a counter to avoid child-element flicker
  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    if (dragCounter.current === 1) setIsDragActive(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current === 0) setIsDragActive(false)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault() // required to allow drop
    e.stopPropagation()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragActive(false)
    processFile(e.dataTransfer.files[0])
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    processFile(e.target.files?.[0])
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    dispatch({ type: 'SET_MARKDOWN', payload: e.target.value })
  }

  const canProceed = state.markdown.trim().length > 0

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-2 border-b pb-4">
        <Button
          variant={mode === 'upload' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('upload')}
        >
          Upload File
        </Button>
        <Button
          variant={mode === 'type' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('type')}
        >
          Write Text
        </Button>
      </div>

      {mode === 'upload' && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 transition-colors',
              isDragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50',
            )}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div className="text-center">
              <p className="text-sm font-medium">
                {isDragActive ? 'Drop your file here' : 'Drag and drop a .md file here'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">or</p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Browse files
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown"
              className="hidden"
              onChange={handleFileInputChange}
            />

            <p className="text-xs text-muted-foreground">
              Accepts .md and .markdown files up to 2MB
            </p>
          </div>

          {/* File loaded confirmation */}
          {state.markdown && selectedFile && (
            <p className="text-sm text-muted-foreground">
              ✓ Loaded: <span className="font-medium">{selectedFile.name}</span>{' '}
              ({Math.round(selectedFile.size / 1024)}KB)
            </p>
          )}
        </div>
      )}

      {mode === 'type' && (
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="markdown-input">
            Markdown content
          </label>
          <Textarea
            id="markdown-input"
            placeholder="Paste or write your markdown here..."
            className="min-h-[300px] font-mono text-sm"
            value={state.markdown}
            onChange={handleTextareaChange}
          />
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-end">
        <Button
          disabled={!canProceed}
          onClick={() => dispatch({ type: 'GO_TO_SCREEN', payload: 'configure' })}
        >
          Next: Configure Annotations →
        </Button>
      </div>

    </div>
  )
}
