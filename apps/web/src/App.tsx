import { MarkdownForm } from '@/components/MarkdownForm'

export function App() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">Markdown Annotator</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Annotates terms in markdown with{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;kbd&gt;</code> index tags.
      </p>
      <MarkdownForm />
    </main>
  )
}
