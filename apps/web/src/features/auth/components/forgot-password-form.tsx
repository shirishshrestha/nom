import { zodResolver } from "@hookform/resolvers/zod"
import { AlertBanner } from "@nom/ui/components/alert-banner"
import { Button } from "@nom/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@nom/ui/components/field"
import { Input } from "@nom/ui/components/input"
import { Controller, useForm } from "react-hook-form"
import {
  type ForgotPasswordFormData,
  forgotPasswordSchema,
} from "@/features/auth/schemas"
import { useForgotPasswordMutation } from "@/features/auth/services/forgot-password"
import { getErrorMessage } from "@/lib/errors"

export function ForgotPasswordForm() {
  const forgotPassword = useForgotPasswordMutation()
  const { control, handleSubmit } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  })

  function onSubmit(data: ForgotPasswordFormData) {
    forgotPassword.mutate(data)
  }

  const serverError = forgotPassword.error
    ? getErrorMessage(forgotPassword.error, "Could not send reset link")
    : ""

  if (forgotPassword.isSuccess) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold">Forgot Password</h1>
          </div>
          <AlertBanner
            variant="success"
            message="Check your email for a reset link."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-6"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Forgot Password</h1>
          <p className="text-sm text-muted-foreground">
            Enter email to get email password link.
          </p>
        </div>

        <AlertBanner variant="error" message={serverError} />

        <FieldGroup className="gap-4">
          <Controller
            name="email"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-3">
                <FieldLabel htmlFor={field.name}>Enter Email</FieldLabel>
                <div className="space-y-1">
                  <Input
                    {...field}
                    id={field.name}
                    type="email"
                    autoComplete="email"
                    aria-invalid={fieldState.invalid}
                    placeholder="user@nomanbhoy.sg"
                    className="text-base"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </div>
              </Field>
            )}
          />
        </FieldGroup>

        <Button
          type="submit"
          className="w-full"
          disabled={forgotPassword.isPending}
        >
          {forgotPassword.isPending ? "Sending..." : "Reset"}
        </Button>
      </form>
    </div>
  )
}
