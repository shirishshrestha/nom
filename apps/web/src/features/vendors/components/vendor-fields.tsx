import { Field, FieldError, FieldLabel } from "@nom/ui/components/field"
import { Input } from "@nom/ui/components/input"
import { Textarea } from "@nom/ui/components/textarea"
import { type Control, Controller } from "react-hook-form"
import { VendorTypeCombobox } from "@/features/vendors/components/vendor-type-combobox"
import type { CreateVendorFormData } from "@/features/vendors/schemas"

/**
 * Shared field body for the add/edit vendor variants. Behaviour (which
 * mutation, defaults, actions) lives in each variant; this only renders the
 * inputs.
 */
export function VendorFields({
  control,
}: {
  control: Control<CreateVendorFormData>
}) {
  return (
    <>
      <div className="flex items-start gap-4">
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState }) => (
            <Field className="flex-1" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Vendor Name *</FieldLabel>
              <div className="space-y-2">
                <Input
                  {...field}
                  id={field.name}
                  aria-invalid={fieldState.invalid}
                  placeholder="Insurance"
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Provide a unique vendor name to identify.
                  </p>
                )}
              </div>
            </Field>
          )}
        />

        <Controller
          name="code"
          control={control}
          render={({ field, fieldState }) => (
            <Field className="w-38" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Code *</FieldLabel>
              <div className="space-y-2">
                <Input
                  {...field}
                  id={field.name}
                  aria-invalid={fieldState.invalid}
                  placeholder="INS"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />
      </div>

      <Controller
        name="type"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Vendor Type *</FieldLabel>
            <div className="space-y-2">
              <VendorTypeCombobox
                id={field.name}
                value={field.value}
                onChange={field.onChange}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </div>
          </Field>
        )}
      />

      <Controller
        name="location"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Location *</FieldLabel>
            <div className="space-y-2">
              <Input
                {...field}
                id={field.name}
                aria-invalid={fieldState.invalid}
                placeholder="John Doe"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </div>
          </Field>
        )}
      />

      <Controller
        name="comments"
        control={control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Comments</FieldLabel>
            <Textarea
              {...field}
              id={field.name}
              placeholder="Add any additional comments"
            />
          </Field>
        )}
      />
    </>
  )
}
