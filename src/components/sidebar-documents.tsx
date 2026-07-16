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
}

export function SidebarDocuments() {
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [ingestOpen, setIngestOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null)

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
            {documents.map(doc => (
              <SidebarMenuItem key={doc.id}>
                <SidebarMenuButton
                  onClick={() => {
                    setPreviewDoc(doc)
                    setPreviewOpen(true)
                  }}
                  title={doc.title || doc.source}
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{doc.title || doc.source}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
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
