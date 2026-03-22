import { useFormContext } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

export function InputArea() {
  const form = useFormContext()

  return (
    <FormField
      control={form.control}
      name="markdown"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Markdown Input</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Paste your markdown here..."
              className="min-h-[200px] font-mono text-sm"
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
