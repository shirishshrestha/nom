import { Field, FieldError, FieldLabel } from "@nom/ui/components/field"
import { Input } from "@nom/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nom/ui/components/select"
import { Textarea } from "@nom/ui/components/textarea"
import { type Control, Controller } from "react-hook-form"
import {
  categoryLabel,
  RULE_CATEGORIES,
} from "@/features/rules/lib/rule-category"
import type { RuleFormData } from "@/features/rules/schemas"

/**
 * Shared field body for the add/edit rule variants. Behaviour (which mutation,
 * defaults, actions) lives in each variant; this only renders the inputs.
 */
export function RuleFields({ control }: { control: Control<RuleFormData> }) {
  return (
    <>
      <div className="flex items-start gap-4">
        <Controller
          name="title"
          control={control}
          render={({ field, fieldState }) => (
            <Field className="flex-1 gap-3" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Title *</FieldLabel>
              <div className="space-y-1">
                <Input
                  {...field}
                  id={field.name}
                  aria-invalid={fieldState.invalid}
                  placeholder="Enter details"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Controller
          name="category"
          control={control}
          render={({ field }) => (
            <Field className="flex-1 gap-3">
              <FieldLabel htmlFor={field.name}>Category *</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={field.name} className="w-full">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {RULE_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {categoryLabel(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
      </div>

      <Controller
        name="content"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid} className="gap-3 pt-2">
            <FieldLabel htmlFor={field.name}>Content *</FieldLabel>
            <div className="space-y-1">
              <Textarea
                {...field}
                id={field.name}
                aria-invalid={fieldState.invalid}
                placeholder="Describe the rule"
                rows={3}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </div>
          </Field>
        )}
      />
    </>
  )
}
