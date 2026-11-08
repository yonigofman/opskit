// Vendored from shadcn/ui (MIT, https://github.com/shadcn-ui/ui), registry/bases/radix. Icons resolved to lucide-react.
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("cn-skeleton animate-pulse", className)}
      {...props}
    />
  )
}

export { Skeleton }
