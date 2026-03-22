import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { InputArea } from '@/components/InputArea'
import { OutputArea } from '@/components/OutputArea'
import { processMarkdown } from '@/lib/process-markdown'

const schema = z.object({
  markdown: z.string().min(1, 'Please enter some markdown text'),
})

type FormValues = z.infer<typeof schema>

export function MarkdownForm() {
  const [output, setOutput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { markdown: '' },
  })

  async function onSubmit(values: FormValues) {
    setIsProcessing(true)
    // Yield to let React paint the disabled state before blocking the main thread
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    try {
      const result = processMarkdown(values.markdown)
      setOutput(result)
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <InputArea />
        <Button type="submit" disabled={isProcessing}>
          {isProcessing ? 'Processing…' : 'Annotate'}
        </Button>
        <OutputArea value={output} />
      </form>
    </Form>
  )
}
