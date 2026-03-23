import { useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { AnnotateEntryFormSchema, type AnnotateEntryFormValues } from '@/lib/schemas'
import type { WebAnnotateInfo } from '@/types'

interface Props {
  open: boolean
  initialValues: WebAnnotateInfo | null  // null = add mode
  onSubmit: (values: AnnotateEntryFormValues) => void
  onClose: () => void
}

export function AnnotateEntryDialog({ open, initialValues, onSubmit, onClose }: Props) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<AnnotateEntryFormValues>({
    resolver: zodResolver(AnnotateEntryFormSchema),
    defaultValues: { name: '', terms: [{ value: '' }], parent: '' },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'terms' })

  // Populate form when editing an existing entry
  useEffect(() => {
    if (open) {
      if (initialValues) {
        reset({
          name: initialValues.name,
          terms: initialValues.terms.map(t => ({ value: t })),
          parent: initialValues.parent ?? '',
        })
      } else {
        reset({ name: '', terms: [{ value: '' }], parent: '' })
      }
    }
  }, [open, initialValues, reset])

  function handleFormSubmit(values: AnnotateEntryFormValues) {
    // Normalise: treat empty parent string as undefined
    onSubmit({
      ...values,
      parent: values.parent?.trim() || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initialValues ? 'Edit Entry' : 'Add Entry'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="entry-name">Name</Label>
            <Input
              id="entry-name"
              placeholder="e.g. Artificial Intelligence"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* Terms */}
          <div className="space-y-1">
            <Label>Terms</Label>
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id} className="flex gap-2">
                  <Input
                    placeholder={`Term ${index + 1}`}
                    {...register(`terms.${index}.value`)}
                    className="flex-1"
                  />
                  {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(index)}
                      aria-label="Remove term"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {errors.terms && !Array.isArray(errors.terms) && (
              <p className="text-xs text-destructive">{errors.terms.message}</p>
            )}
            {Array.isArray(errors.terms) && errors.terms.map((e, i) =>
              e?.value ? (
                <p key={i} className="text-xs text-destructive">
                  Term {i + 1}: {e.value.message}
                </p>
              ) : null,
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ value: '' })}
              className="mt-1"
            >
              <Plus className="mr-1 h-3 w-3" />
              Add Term
            </Button>
          </div>

          {/* Parent (optional) */}
          <div className="space-y-1">
            <Label htmlFor="entry-parent">
              Parent <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="entry-parent"
              placeholder="e.g. Computer Science"
              {...register('parent')}
            />
            {errors.parent && (
              <p className="text-xs text-destructive">{errors.parent.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {initialValues ? 'Save Changes' : 'Add Entry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
