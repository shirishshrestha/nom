import { z } from "zod"

export const createVendorSchema = z.object({
  name: z.string().trim().min(1, "This field is required"),
  code: z.string().trim().min(1, "This field is required"),
  type: z.string().trim().min(1, "This field is required"),
  location: z.string().trim().min(1, "This field is required"),
  comments: z.string().trim().optional(),
})

export type CreateVendorFormData = z.infer<typeof createVendorSchema>

export type Vendor = {
  id: string
  name: string
  code?: string | null
  type?: string | null
  location?: string | null
  comments?: string | null
  createdAt: string
  updatedAt: string
}
