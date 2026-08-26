import { zodResolver } from "@hookform/resolvers/zod"
import { AlertBanner } from "@nom/ui/components/alert-banner"
import { Button } from "@nom/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@nom/ui/components/field"
import { Link, useNavigate } from "@tanstack/react-router"
import { Controller, useForm } from "react-hook-form"
import { PasswordInput } from "@/features/auth/components/password-input"
import {
  type ResetPasswordFormData,
  resetPasswordSchema,
} from "@/features/auth/schemas"
import { useResetPasswordMutation } from "@/features/auth/services/reset-password"
import { getErrorMessage } from "@/lib/errors"

export function ResetPasswordForm({ token }: { token?: string }) {
  const navigate = useNavigate()
  const resetPassword = useResetPasswordMutation()
  const { control, handleSubmit } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  function onSubmit({ password }: ResetPasswordFormData) {
    if (!token) return
    resetPassword.mutate(
      { newPassword: password, token },
      { onSuccess: () => navigate({ to: "/login" }) }
    )
  }

  const serverError = resetPassword.error
    ? getErrorMessage(resetPassword.error, "Could not reset password")
    : ""

  if (!token) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold">Reset Password</h1>
          </div>
          <AlertBanner
            variant="error"
            message="This reset link is invalid or has expired."
          />
          <p className="text-center text-sm text-muted-foreground">
            <Link
              to="/forgot-password"
              className="underline underline-offset-4"
            >
              Request a new link
            </Link>
          </p>
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
          <h1 className="text-xl font-semibold">Reset Password</h1>
        </div>

        <AlertBanner variant="error" message={serverError} />

        <FieldGroup className="gap-4">
          <Controller
            name="password"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-3">
                <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                <div className="space-y-1">
                  <PasswordInput
                    {...field}
                    id={field.name}
                    autoComplete="new-password"
                    aria-invalid={fieldState.invalid}
                    className="text-base"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </div>
              </Field>
            )}
          />

          <Controller
            name="confirmPassword"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-3">
                <FieldLabel htmlFor={field.name}>Confirm Password</FieldLabel>
                <div className="space-y-1">
                  <PasswordInput
                    {...field}
                    id={field.name}
                    autoComplete="new-password"
                    aria-invalid={fieldState.invalid}
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
          disabled={resetPassword.isPending}
        >
          {resetPassword.isPending ? "Resetting..." : "Reset"}
        </Button>
      </form>
    </div>
  )
}
