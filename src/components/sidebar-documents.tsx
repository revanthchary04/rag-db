'use client'

import { FileText, Loader2, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import IngestDialog from '@/features/console/IngestDialog'
import DocumentPreviewDialog from '@/features/console/DocumentPreviewDialog'
import { listDocuments } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

interface DocumentRow {
  id: string
  source: string
  title?: string
  created_at: string
  original_available?: boolean
  /** ISO timestamp when this guest upload is auto-deleted (absent = never expires). */
  expires_at?: string | null
}

/** Human countdown to auto-deletion, or null when the document never expires. */
function formatExpiry(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null
  const msLeft = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(msLeft)) return null
  if (msLeft <= 0) return 'Expired'

  const minutes = Math.floor(msLeft / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m left`
  // Hours stay readable up to 2 days — the guest TTL is 24h, so "24h left" beats "1d left".
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h left`
  return `${Math.floor(hours / 24)}d left`
}

export function SidebarDocuments() {
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [ingestOpen, setIngestOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null)
  // Ticks once a minute purely to refresh the expiry countdown labels.
  const [, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await listDocuments()
      setDocuments(res.documents || [])
    } catch {
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Re-render every minute so the "expires in" countdown stays current without a refetch.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between pr-1">
        <span>Documents{documents.length > 0 ? ` (${documents.length})` : ''}</span>
        <Button
          aria-label="Ingest document"
          className="size-6"
          onClick={() => setIngestOpen(true)}
          size="icon"
          variant="ghost"
        >
          <Plus className="size-4" />
        </Button>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-xs">
            <Loader2 className="size-3 animate-spin" /> Loading…
          </div>
        ) : documents.length === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            No documents yet. Click + to ingest.
          </p>
        ) : (
          <SidebarMenu>
            {documents.map(doc => {
              const expiry = formatExpiry(doc.expires_at)
              return (
                <SidebarMenuItem key={doc.id}>
                  <SidebarMenuButton
                    onClick={() => {
                      setPreviewDoc(doc)
                      setPreviewOpen(true)
                    }}
                    title={
                      expiry
                        ? `${doc.title || doc.source} — auto-deletes ${new Date(doc.expires_at as string).toLocaleString()}`
                        : doc.title || doc.source
                    }
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{doc.title || doc.source}</span>
                    {expiry ? (
                      <span
                        className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-medium text-[10px] tabular-nums ${
                          expiry === 'Expired'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {expiry}
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        )}
      </SidebarGroupContent>

      <IngestDialog onOpenChange={setIngestOpen} onSuccess={load} open={ingestOpen} />
      <DocumentPreviewDialog
        document={previewDoc}
        onOpenChange={setPreviewOpen}
        open={previewOpen}
      />
    </SidebarGroup>
  )
}
