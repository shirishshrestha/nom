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
import { type LoginFormData, loginSchema } from "@/features/auth/schemas"
import { useLoginMutation } from "@/features/auth/services/login"
import { getErrorMessage } from "@/lib/errors"
import { cn } from "@nom/ui/lib/utils"

export function LoginForm({ redirect }: { redirect?: string }) {
  const navigate = useNavigate()
  const login = useLoginMutation()
  const { control, handleSubmit } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  function onSubmit(data: LoginFormData) {
    login.mutate(data, {
      onSuccess: () => navigate({ to: redirect ?? "/dashboard" }),
    })
  }

  const serverError = login.error
    ? getErrorMessage(login.error, "Sign in failed")
    : ""

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-6"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">
            Welcome to <span className="font-medium">NomanBhoy</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Verify every charge with confidence.
          </p>
        </div>

        <AlertBanner variant="error" message={serverError} />

        <FieldGroup className="gap-4">
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
                    autoComplete="current-password"
                    aria-invalid={fieldState.invalid}
                    placeholder="Password"
                    className="text-base"
                  />

                  <div
                    className={cn(
                      "flex items-center justify-between gap-2",
                      !fieldState.invalid && "justify-end"
                    )}
                  >
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                    <Link
                      to="/forgot-password"
                      className="text-end text-sm text-muted-foreground underline underline-offset-4"
                    >
                      Forgot password?
                    </Link>
                  </div>
                </div>
              </Field>
            )}
          />
        </FieldGroup>

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? "Signing in..." : "Sign in"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link to="/signup" className="underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  )
}
