import { toast } from "@nom/ui/components/sonner"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import type { Mock } from "vitest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  RulesReviewProvider,
  useRulesReview,
} from "@/features/quotations/components/review/rules-review-context"
import { api } from "@/lib/api"
import type {
  AttributeSet,
  CommitAllResult,
  ReviewService,
  UncommittedDocument,
} from "@/features/quotations/types"

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock("@nom/ui/components/sonner", () => ({ toast: { error: vi.fn() } }))

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }))
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>()
  return { ...actual, useNavigate: () => navigateSpy }
})

const mockGet = api.get as unknown as Mock
const mockPost = api.post as unknown as Mock
const toastError = toast.error as unknown as Mock

const attributeSet: AttributeSet = {
  key: "insurance",
  label: "Insurance",
  documentType: "insurance",
  attributes: [
    { key: "price", label: "Price", type: "number", nullable: false },
  ],
}

function makeService(
  id: string,
  overrides: Partial<ReviewService> = {}
): ReviewService {
  return {
    id,
    canonicalName: "Cargo cover",
    title: "Premium",
    category: null,
    tier: null,
    pricingContext: "Base rate",
    attributes: { price: 10 },
    meta: {
      foundAt: null,
      sourceText: "",
      contentId: "chunk-1",
      sectionLabel: "",
      position: 0,
    },
    log: "",
    ...overrides,
  }
}

function makeDoc(
  id: string,
  overrides: Partial<UncommittedDocument> = {}
): UncommittedDocument {
  return {
    documentId: id,
    fileId: `file-${id}`,
    fileName: `${id}.pdf`,
    status: "staged",
    effectiveFrom: null,
    metadata: null,
    services: [makeService(`svc-${id}`)],
    reviewStatus: "staged",
    stagedId: `staged-${id}`,
    ...overrides,
  }
}

let docs: UncommittedDocument[]
let commitAllResponse: CommitAllResult
let queryClient: QueryClient

beforeEach(() => {
  docs = [makeDoc("doc-1"), makeDoc("doc-2")]
  commitAllResponse = { committed: [], failed: [] }
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  mockGet.mockReset().mockImplementation(async (url: string) => {
    if (url === "/source/uncommitted")
      return { data: { data: { documents: docs, attributeSet } } }
    throw new Error(`unexpected GET ${url}`)
  })

  mockPost.mockReset().mockImplementation(async (url: string) => {
    const markReady = url.match(/^\/source\/documents\/(.+)\/mark-ready$/)
    if (markReady) {
      const doc = docs.find((d) => d.documentId === markReady[1])
      if (doc) doc.reviewStatus = "ready_to_commit"
      return {
        data: {
          data: {
            documentId: markReady[1],
            version: 1,
            reviewStatus: "ready_to_commit",
          },
        },
      }
    }
    const unmarkReady = url.match(/^\/source\/documents\/(.+)\/unmark-ready$/)
    if (unmarkReady) {
      const doc = docs.find((d) => d.documentId === unmarkReady[1])
      if (doc) doc.reviewStatus = "staged"
      return {
        data: {
          data: {
            documentId: unmarkReady[1],
            version: 1,
            reviewStatus: "staged",
          },
        },
      }
    }
    if (url === "/source/commit-all")
      return { data: { data: commitAllResponse } }
    throw new Error(`unexpected POST ${url}`)
  })

  navigateSpy.mockClear()
  toastError.mockClear()
})

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RulesReviewProvider vendorId="vendor-1">{children}</RulesReviewProvider>
    </QueryClientProvider>
  )
}

describe("RulesReviewProvider state machine", () => {
  it("opens the first service on landing but stays closed once deselected", async () => {
    docs = [
      makeDoc("doc-1", { services: [makeService("a"), makeService("b")] }),
    ]
    const { result } = renderHook(() => useRulesReview(), { wrapper })
    await waitFor(() => expect(result.current.documents).toHaveLength(1))

    expect(result.current.activeServiceId).toBe("a")

    act(() => {
      result.current.selectService("b")
    })
    expect(result.current.activeServiceId).toBe("b")

    act(() => {
      result.current.selectService(null)
    })
    expect(result.current.activeServiceId).toBeNull()
  })

  it("markReadyNext persists the active doc's edits and advances to the next document", async () => {
    const { result } = renderHook(() => useRulesReview(), { wrapper })
    await waitFor(() => expect(result.current.documents).toHaveLength(2))

    act(() => {
      result.current.setDraft("svc-doc-1", {
        title: "Premium (edited)",
        pricingContext: "Base rate",
        price: 10,
      })
    })
    act(() => {
      result.current.markReadyNext()
    })

    await waitFor(() =>
      expect(result.current.activeDoc?.documentId).toBe("doc-2")
    )

    expect(mockPost).toHaveBeenCalledWith(
      "/source/documents/doc-1/mark-ready",
      {
        services: [
          {
            id: "svc-doc-1",
            attributes: { price: 10 },
            title: "Premium (edited)",
            pricingContext: "Base rate",
          },
        ],
        deletedServiceIds: [],
      }
    )
  })

  it("commitAll navigates back to the vendor page when every file commits", async () => {
    docs = [
      makeDoc("doc-1", { reviewStatus: "ready_to_commit" }),
      makeDoc("doc-2", { reviewStatus: "ready_to_commit" }),
    ]
    commitAllResponse = {
      committed: [
        {
          stagedId: "staged-doc-1",
          documentId: "doc-1",
          version: 1,
          serviceCount: 1,
          canonicalCount: 1,
        },
        {
          stagedId: "staged-doc-2",
          documentId: "doc-2",
          version: 1,
          serviceCount: 1,
          canonicalCount: 1,
        },
      ],
      failed: [],
    }

    const { result } = renderHook(() => useRulesReview(), { wrapper })
    await waitFor(() => expect(result.current.allReady).toBe(true))

    act(() => {
      result.current.commitAll()
    })

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: "/vendor/$vendorId",
        params: { vendorId: "vendor-1" },
      })
    )
  })

  it("commitAll surfaces a toast and does not navigate when a file fails to commit", async () => {
    docs = [
      makeDoc("doc-1", { reviewStatus: "ready_to_commit" }),
      makeDoc("doc-2", { reviewStatus: "ready_to_commit" }),
    ]
    commitAllResponse = {
      committed: [
        {
          stagedId: "staged-doc-1",
          documentId: "doc-1",
          version: 1,
          serviceCount: 1,
          canonicalCount: 1,
        },
      ],
      failed: [{ stagedId: "staged-doc-2", reason: "conflicting version" }],
    }

    const { result } = renderHook(() => useRulesReview(), { wrapper })
    await waitFor(() => expect(result.current.allReady).toBe(true))

    act(() => {
      result.current.commitAll()
    })

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0][0]).toContain("conflicting version")
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
