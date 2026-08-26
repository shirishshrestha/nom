import { useRef, useState } from "react"

/** Open a tooltip only when the element is actually truncated (text overflows). */
export function useTruncatedTooltip<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [open, setOpen] = useState(false)

  const handleMouseEnter = () => {
    const el = ref.current
    if (!el) return
    setOpen(
      el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight
    )
  }

  const handleMouseLeave = () => setOpen(false)

  return { ref, open, handleMouseEnter, handleMouseLeave }
}
