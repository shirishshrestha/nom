import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@nom/ui/components/button"
import { toast } from "@nom/ui/components/sonner"
import { useNavigate } from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { VendorFields } from "@/features/vendors/components/vendor-fields"
import {
  type CreateVendorFormData,
  createVendorSchema,
  type Vendor,
} from "@/features/vendors/schemas"
import { useUpdateVendorMutation } from "@/features/vendors/services/vendors"
import { getErrorMessage } from "@/lib/errors"

export function EditVendorForm({ vendor }: { vendor: Vendor }) {
  const navigate = useNavigate()
  const update = useUpdateVendorMutation(vendor.id)
  const { control, handleSubmit } = useForm<CreateVendorFormData>({
    resolver: zodResolver(createVendorSchema),
    defaultValues: {
      name: vendor.name,
      code: vendor.code ?? "",
      type: vendor.type ?? "",
      location: vendor.location ?? "",
      comments: vendor.comments ?? "",
    },
  })

  function onSubmit(data: CreateVendorFormData) {
    update.mutate(data, {
      onSuccess: () => {
        toast.success("Vendor updated successfully")
        navigate({ to: "/vendor" })
      },
      onError: (error) =>
        toast.error(getErrorMessage(error, "Failed to update vendor")),
    })
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="flex w-full max-w-xl flex-col gap-6"
    >
      <VendorFields control={control} />
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: "/vendor" })}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  )
}
