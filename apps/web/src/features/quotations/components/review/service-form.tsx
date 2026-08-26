import { zodResolver } from "@hookform/resolvers/zod"
import { Field, FieldError, FieldLabel } from "@nom/ui/components/field"
import { Input } from "@nom/ui/components/input"
import { Textarea } from "@nom/ui/components/textarea"
import { useEffect, useRef } from "react"
import { Controller, useForm } from "react-hook-form"
import {
  buildServiceFormSchema,
  type ServiceFormValues,
  serviceToFormValues,
} from "@/features/quotations/mappers/rules-review-mappers"
import type { AttributeSet, ReviewService } from "@/features/quotations/types"

/**
 * Presentational edit form for a single service, shared by the Split
 * (`ServiceEditForm`) and Cards layouts. Renders only the fields — the caller
 * supplies the outer container. Pass `key={service.id}` so switching services
 * remounts with fresh `defaultValues`.
 */
export function ServiceFormFields({
  service,
  attributeSet,
  initial,
  onChange,
}: {
  service: ReviewService
  attributeSet: AttributeSet
  initial: ServiceFormValues | undefined
  onChange: (serviceId: string, values: ServiceFormValues) => void
}) {
  const { control, watch, trigger } = useForm<ServiceFormValues>({
    resolver: zodResolver(buildServiceFormSchema(attributeSet)),
    defaultValues: initial ?? serviceToFormValues(service, attributeSet),
    mode: "onChange",
  })

  /**
   * Sync every edit up to the provider's draft map; ref keeps the
   * subscription stable while always calling the latest onChange.
   */
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    const sub = watch((values) =>
      onChangeRef.current(service.id, values as ServiceFormValues)
    )
    return () => sub.unsubscribe()
  }, [watch, service.id])

  useEffect(() => {
    trigger()
  }, [trigger])

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-6">
        <Field>
          <FieldLabel>Name *</FieldLabel>
          <Input value={service.canonicalName ?? "—"} readOnly disabled />
        </Field>
        <Controller
          name="title"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Label *</FieldLabel>
              <Input
                {...field}
                id={field.name}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : null}
            </Field>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {attributeSet.attributes.map((attr) => (
          <Controller
            key={attr.key}
            name={attr.key}
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>
                  {attr.label}
                  {attr.nullable ? null : " *"}
                </FieldLabel>
                <Input
                  id={field.name}
                  type={attr.type === "number" ? "number" : "text"}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(
                      attr.type === "number"
                        ? e.target.value === ""
                          ? ""
                          : Number(e.target.value)
                        : e.target.value
                    )
                  }
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : null}
              </Field>
            )}
          />
        ))}
      </div>

      <Controller
        name="pricingContext"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Pricing context *</FieldLabel>
            <Textarea
              {...field}
              id={field.name}
              aria-invalid={fieldState.invalid}
            />
            {fieldState.invalid ? (
              <FieldError errors={[fieldState.error]} />
            ) : null}
          </Field>
        )}
      />
    </div>
  )
}
