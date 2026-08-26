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
import { Link, useNavigate } from "@tanstack/react-router"
import { Controller, useForm } from "react-hook-form"
import { PasswordInput } from "@/features/auth/components/password-input"
import { type SignupFormData, signupSchema } from "@/features/auth/schemas"
import { useSignupMutation } from "@/features/auth/services/signup"
import { getErrorMessage } from "@/lib/errors"

export function SignupForm({ redirect }: { redirect?: string }) {
  const navigate = useNavigate()
  const signup = useSignupMutation()
  const { control, handleSubmit } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  })

  function onSubmit({ name, email, password }: SignupFormData) {
    signup.mutate(
      { name, email, password },
      { onSuccess: () => navigate({ to: redirect ?? "/dashboard" }) }
    )
  }

  const serverError = signup.error
    ? getErrorMessage(signup.error, "Sign up failed")
    : ""

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-6"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Create account</h1>
          <p className="text-sm text-muted-foreground">Get started today.</p>
        </div>

        <AlertBanner variant="error" message={serverError} />

        <FieldGroup className="gap-4">
          <Controller
            name="name"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-3">
                <FieldLabel htmlFor={field.name}>Full name</FieldLabel>
                <div className="space-y-1">
                  <Input
                    {...field}
                    id={field.name}
                    type="text"
                    autoComplete="name"
                    aria-invalid={fieldState.invalid}
                    placeholder="Jane Doe"
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
            name="email"
            control={control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-3">
                <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                <div className="space-y-1">
                  <Input
                    {...field}
                    id={field.name}
                    type="email"
                    autoComplete="email"
                    aria-invalid={fieldState.invalid}
                    placeholder="name@company.com"
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
                    placeholder="Create a password"
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
                <FieldLabel htmlFor={field.name}>Confirm password</FieldLabel>
                <div className="space-y-1">
                  <PasswordInput
                    {...field}
                    id={field.name}
                    autoComplete="new-password"
                    aria-invalid={fieldState.invalid}
                    placeholder="Re-enter your password"
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

        <Button type="submit" className="w-full" disabled={signup.isPending}>
          {signup.isPending ? "Signing up..." : "Sign up"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
