import { Badge } from "@nom/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@nom/ui/components/card"
import { Skeleton } from "@nom/ui/components/skeleton"
import { useQuery } from "@tanstack/react-query"
import { TrendingDown, TrendingUp } from "lucide-react"
import { dashboardMetricsQuery } from "@/features/dashboard/services/dashboard"
import { toStatCards } from "@/features/dashboard/services/dashboard.mappers"
import type { Stat, Trend } from "@/features/dashboard/types"

function TrendIcon({ dir, className }: { dir: Trend; className?: string }) {
  const Icon = dir === "up" ? TrendingUp : TrendingDown
  return <Icon className={className} />
}

function StatCard({ label, value, delta, note, sub }: Stat) {
  return (
    <Card className="py-6">
      <CardHeader className="gap-3">
        <div className="flex justify-between gap-1.5">
          <CardDescription className="text-sm">{label}</CardDescription>
          {delta ? (
            <Badge className="font-mono font-semibold" variant="outline">
              <TrendIcon dir={delta.dir} /> {delta.text}
            </Badge>
          ) : null}
        </div>
        <p className="font-mono text-2xl font-semibold text-card-foreground">
          {value}
        </p>
      </CardHeader>
      {note || sub ? (
        <CardContent className="flex flex-col gap-1.5">
          {note ? (
            <div className="flex items-center gap-1">
              <span className="flex-1 text-sm font-medium text-card-foreground">
                {note.text}
              </span>
              {note.dir ? (
                <TrendIcon
                  dir={note.dir}
                  className="size-4 text-card-foreground"
                />
              ) : null}
            </div>
          ) : null}
          {sub ? <p className="text-sm text-muted-foreground">{sub}</p> : null}
        </CardContent>
      ) : null}
    </Card>
  )
}

function StatCardSkeleton() {
  return (
    <Card className="py-6">
      <CardHeader className="gap-3">
        <div className="flex justify-between gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-14" />
        </div>
        <Skeleton className="h-8 w-24" />
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-28" />
      </CardContent>
    </Card>
  )
}

export function StatsOverview() {
  const { data, isPending } = useQuery(dashboardMetricsQuery)
  const stats = data ? toStatCards(data) : []

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {isPending
        ? ["a", "b", "c", "d"].map((k) => <StatCardSkeleton key={k} />)
        : stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
    </div>
  )
}
