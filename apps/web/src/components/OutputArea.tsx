import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface OutputAreaProps {
  value: string
}

export function OutputArea({ value }: OutputAreaProps) {
  return (
    <div className="space-y-2">
      <Label>Annotated Output</Label>
      <Textarea
        value={value}
        readOnly
        placeholder="Annotated markdown will appear here..."
        className="min-h-[200px] font-mono text-sm bg-muted"
      />
    </div>
  )
}
