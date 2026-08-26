import { AiFileIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { findSourceRange } from "@/features/quotations/lib/highlight-source"
import { contentChunkQuery } from "@/features/quotations/services/rules-review"

/**
 * Inline "View source" panel: fetches the content chunk a service line was
 * extracted from and shows it with the service's `sourceText` phrase
 * highlighted in context.
 */
export function SourceChunkPanel({
  contentId,
  highlight,
}: {
  contentId: string
  highlight: string
}) {
  const { data, isPending, isError } = useQuery(contentChunkQuery(contentId))

  if (isPending)
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading source…
      </div>
    )

  if (isError || !data)
    return (
      <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Couldn't load the source for this line.
      </div>
    )

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2.5 text-sm">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <HugeiconsIcon icon={AiFileIcon} className="size-4" />
          <span className="truncate text-sm font-semibold text-muted-foreground">
            {data.fileName || "Source document"}
          </span>
        </span>
        {data.page != null ? (
          <span className="shrink-0 font-semibold text-muted-foreground">
            Page {data.page}
            {data.totalPages ? ` of ${data.totalPages}` : ""}
          </span>
        ) : null}
      </div>
      <div className="flex px-5 py-6 text-sm">
        <div className="w-0.75 self-stretch rounded-xl bg-blue-400"></div>
        <div className="px-4">
          {data.label ? (
            <p className="text-base leading-6 font-semibold">{data.label}:</p>
          ) : null}
          <p className="leading-8 whitespace-pre-wrap text-foreground">
            <Highlighted text={data.text} needle={highlight} />
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Highlights `needle` within `text`, tolerating whitespace/line-break
 * differences between the chunk text and the normalized sourceText.
 */
function Highlighted({ text, needle }: { text: string; needle: string }) {
  const range = findSourceRange(text, needle)
  if (!range) return <>{text}</>
  return (
    <>
      {text.slice(0, range.start)}
      <mark className="rounded-sm bg-blue-100 px-0.5 py-0.5 font-mono text-blue-500">
        {text.slice(range.start, range.end)}
      </mark>
      {text.slice(range.end)}
    </>
  )
}
