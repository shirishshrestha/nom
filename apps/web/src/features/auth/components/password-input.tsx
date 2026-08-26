import { Input } from "@nom/ui/components/input"
import { cn } from "@nom/ui/lib/utils"
import { Eye, EyeOff } from "lucide-react"
import * as React from "react"

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type">

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  PasswordInputProps
>(function PasswordInput({ className, ...props }, ref) {
  const [show, setShow] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  return (
    <div className="relative">
      <Input
        ref={(node) => {
          inputRef.current = node
          if (typeof ref === "function") ref(node)
          else if (ref) ref.current = node
        }}
        type={show ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const input = inputRef.current
          const start = input?.selectionStart
          const end = input?.selectionEnd
          setShow((s) => !s)
          /** Restore cursor after the type toggle re-renders the input. */
          requestAnimationFrame(() => {
            input?.setSelectionRange(start ?? 0, end ?? 0)
          })
        }}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  )
})
