import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nom/ui/components/tooltip"
import { cn } from "@nom/ui/lib/utils"
import { useTruncatedTooltip } from "@/shared/hooks/use-truncated-tooltip"

/**
 * Needs a width cap (e.g. max-w-*) via className for truncation to engage.
 * `lines` > 1 switches from single-line ellipsis to an N-line clamp; the
 * tooltip opens on either horizontal or vertical overflow.
 */
export function TruncatedText({
  children,
  className,
  lines = 1,
}: {
  children: string
  className?: string
  lines?: number
}) {
  const { ref, open, handleMouseEnter, handleMouseLeave } =
    useTruncatedTooltip<HTMLSpanElement>()

  const multiline = lines > 1

  return (
    <Tooltip open={open}>
      <TooltipTrigger asChild>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: hover only measures text overflow, not an interactive control */}
        <span
          ref={ref}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={cn(
            multiline ? "block whitespace-normal" : "block truncate",
            className
          )}
          style={
            multiline
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: lines,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }
              : undefined
          }
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="break-all">{children}</TooltipContent>
    </Tooltip>
  )
}
