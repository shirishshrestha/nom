import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@nom/ui/lib/utils"

const alertBannerVariants = cva(
  "w-full rounded-md p-3 text-sm font-medium [&_p]:m-0",
  {
    variants: {
      variant: {
        error: "bg-destructive/10 text-destructive",
        success: "bg-green-50 text-green-700",
      },
    },
    defaultVariants: {
      variant: "error",
    },
  }
)

export type AlertBannerProps = React.ComponentProps<"div"> &
  VariantProps<typeof alertBannerVariants> & {
    /** Plain text; rendered in a paragraph. Omit and use `children` for rich content. */
    message?: string
  }

function AlertBanner({
  className,
  variant,
  message,
  children,
  ...props
}: AlertBannerProps) {
  const hasMessage = message != null && message !== ""
  const hasChildren = children != null && children !== false

  if (!hasMessage && !hasChildren) {
    return null
  }

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      data-slot="alert-banner"
      className={cn(alertBannerVariants({ variant }), className)}
      {...props}
    >
      {hasMessage ? <p>{message}</p> : children}
    </div>
  )
}

export { AlertBanner, alertBannerVariants }
