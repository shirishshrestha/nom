import { Toaster as Sonner, type ToasterProps } from "sonner"

function Toaster(props: ToasterProps) {
  return <Sonner richColors position="top-center" {...props} />
}

export { Toaster }
export { toast } from "sonner"
