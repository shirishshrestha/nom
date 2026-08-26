import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@nom/ui/components/button"
import { toast } from "@nom/ui/components/sonner"
import { useNavigate } from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { VendorFields } from "@/features/vendors/components/vendor-fields"
import {
  type CreateVendorFormData,
  createVendorSchema,
} from "@/features/vendors/schemas"
import { useCreateVendorMutation } from "@/features/vendors/services/vendors"
import { getErrorMessage } from "@/lib/errors"

export function AddVendorForm() {
  const navigate = useNavigate()
  const create = useCreateVendorMutation()
  const { control, handleSubmit } = useForm<CreateVendorFormData>({
    resolver: zodResolver(createVendorSchema),
    defaultValues: { name: "", code: "", type: "", location: "", comments: "" },
  })

  function onSubmit(data: CreateVendorFormData) {
    create.mutate(data, {
      onSuccess: () => {
        toast.success("Vendor created successfully")
        navigate({ to: "/vendor" })
      },
      onError: (error) =>
        toast.error(getErrorMessage(error, "Failed to create vendor")),
    })
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="flex w-full max-w-xl flex-col gap-6 min-[1745px]:max-w-1/2"
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
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Submitting..." : "Submit"}
        </Button>
      </div>
    </form>
  )
}
