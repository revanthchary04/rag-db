import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * PageHeader — one header for every observability surface.
 *
 * Before this, metrics / query-logs / eval / strategies each rolled their own
 * header (different title sizes, back-button treatments, alignment). Unifying
 * them is what makes the app read as one designed system rather than four pages.
 * Back-to-chat ghost icon on the left, title + optional subtitle, actions slot
 * on the right.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  backHref = '/',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  backHref?: string
}) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild aria-label="Back to chat">
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
