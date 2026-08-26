export type EllipsisItem = "ellipsis-left" | "ellipsis-right"
export type PageItem = number | EllipsisItem

export function isEllipsis(item: PageItem): item is EllipsisItem {
  return typeof item === "string"
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

/**
 * Builds a windowed list of page numbers with ellipsis markers,
 * e.g. [1, "ellipsis-left", 4, 5, 6, "ellipsis-right", 10].
 */
export function buildPageItems(
  currentPage: number,
  totalPages: number,
  siblingCount = 1
): PageItem[] {
  if (totalPages <= siblingCount * 2 + 5) {
    return range(1, totalPages)
  }

  const leftSibling = Math.max(currentPage - siblingCount, 1)
  const rightSibling = Math.min(currentPage + siblingCount, totalPages)
  const showLeftDots = leftSibling > 2
  const showRightDots = rightSibling < totalPages - 1

  if (!showLeftDots && showRightDots) {
    return [...range(1, siblingCount * 2 + 3), "ellipsis-right", totalPages]
  }

  if (showLeftDots && !showRightDots) {
    return [
      1,
      "ellipsis-left",
      ...range(totalPages - (siblingCount * 2 + 2), totalPages),
    ]
  }

  return [
    1,
    "ellipsis-left",
    ...range(leftSibling, rightSibling),
    "ellipsis-right",
    totalPages,
  ]
}
