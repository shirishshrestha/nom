/** One-shot handoff for files dropped outside the form that consumes them
 *  (dashboard → /invoice/add). File objects can't cross a route via search
 *  params or router state, both of which are JSON-serialized. Not a store:
 *  nothing re-renders on this — the consumer reads once on mount and discards. */
let pending: File[] = []

export function setPendingFiles(files: File[]) {
  pending = files
}

export function takePendingFiles() {
  const files = pending
  pending = []
  return files
}
