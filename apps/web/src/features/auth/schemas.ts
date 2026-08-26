import { z } from "zod"

/** Shared strong-password rules for signup. */
export const authPasswordField = z
  .string()
  .trim()
  .min(1, "This field is required")
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Include at least one uppercase letter")
  .regex(/\d/, "Include at least one number")
  .regex(/[^A-Za-z0-9]/, "Include at least one special character")

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "This field is required")
    .email("Please enter a valid email address"),
  password: z.string().min(1, "This field is required"),
})

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, "This field is required"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "This field is required")
      .email("Please enter a valid email address"),
    password: authPasswordField,
    confirmPassword: z.string().min(1, "This field is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "This field is required")
    .email("Please enter a valid email address"),
})

export const resetPasswordSchema = z
  .object({
    password: authPasswordField,
    confirmPassword: z.string().min(1, "This field is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export type LoginFormData = z.infer<typeof loginSchema>
export type SignupFormData = z.infer<typeof signupSchema>
export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>
