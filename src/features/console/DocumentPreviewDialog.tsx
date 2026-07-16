'use client'

import { useState, useEffect, useLayoutEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, FileText, Layers } from 'lucide-react'
import { getDocumentChunks, documentOriginalUrl, getDocument } from '@/lib/api/client'
import { cn } from '@/lib/utils'

interface DocumentPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: {
    id: string
    title?: string
    source: string
    original_available?: boolean
    /** Some proxies/clients may camelCase JSON keys */
    originalAvailable?: boolean
  } | null
}

type PreviewTab = 'original' | 'chunks'

interface Chunk {
  id: string
  document_id: string
  chunk_index: number
  content: string
  metadata?: Record<string, unknown>
  created_at?: string
}

export default function DocumentPreviewDialog({
  open,
  onOpenChange,
  document,
}: DocumentPreviewDialogProps) {
  const [tab, setTab] = useState<PreviewTab>('chunks')
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [isLoadingChunks, setIsLoadingChunks] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Authoritative flag from GET /documents/:id (null = still fetching or dialog closed). */
  const [serverOriginalAvailable, setServerOriginalAvailable] = useState<boolean | null>(null)

  const documentId = document?.id

  const listSaysOriginal = Boolean(document?.original_available ?? document?.originalAvailable)
  const originalAvailable =
    serverOriginalAvailable !== null ? serverOriginalAvailable : listSaysOriginal

  useEffect(() => {
    if (!open || !documentId) {
      setServerOriginalAvailable(null)
      return
    }

    let cancelled = false
    setServerOriginalAvailable(null)
    ;(async () => {
      try {
        const meta = await getDocument(documentId)
        if (!cancelled) {
          setServerOriginalAvailable(meta.original_available)
        }
      } catch {
        if (!cancelled) {
          setServerOriginalAvailable(listSaysOriginal)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, documentId, listSaysOriginal])

  // Before paint: choose tab so we don't flash chunked view when PDF exists.
  useLayoutEffect(() => {
    if (!open || !documentId) {
      setChunks([])
      setIsLoadingChunks(false)
      setError(null)
      return
    }
    setTab(originalAvailable ? 'original' : 'chunks')
    setChunks([])
    setError(null)
  }, [open, documentId, originalAvailable])

  useEffect(() => {
    if (!open || !documentId || tab !== 'chunks') {
      return
    }

    let cancelled = false

    const fetchChunks = async () => {
      setIsLoadingChunks(true)
      setError(null)
      try {
        const data = await getDocumentChunks(documentId)
        if (cancelled) return
        setChunks(data || [])
      } catch (err: unknown) {
        if (cancelled) return
        console.error('Failed to fetch document chunks:', err)
        setError(err instanceof Error ? err.message : 'Failed to load document chunks')
      } finally {
        if (!cancelled) {
          setIsLoadingChunks(false)
        }
      }
    }

    void fetchChunks()
    return () => {
      cancelled = true
    }
  }, [open, documentId, tab])

  if (!document) return null

  const pdfSrc = documentOriginalUrl(document.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[92vh]',
          tab === 'chunks'
            ? 'max-w-6xl w-[min(96rem,calc(100vw-1.5rem))]'
            : 'max-w-5xl w-[min(56rem,calc(100vw-1.5rem))]'
        )}
      >
        <DialogHeader className="flex-shrink-0 space-y-3 border-b border-slate-200 pl-6 pr-14 pb-4 pt-6">
          <DialogTitle className="pr-2">{document.title || document.source}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-3 text-left">
              <div className="flex w-full min-w-0 max-w-full flex-wrap gap-2">
                {originalAvailable ? (
                  <Button
                    type="button"
                    variant={tab === 'original' ? 'default' : 'outline'}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setTab('original')}
                  >
                    <FileText className="h-4 w-4" />
                    Original PDF
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={tab === 'chunks' ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setTab('chunks')}
                >
                  <Layers className="h-4 w-4" />
                  Chunked view
                  {tab === 'chunks' && chunks.length > 0 ? (
                    <span className="tabular-nums text-slate-500">({chunks.length})</span>
                  ) : null}
                </Button>
              </div>
              <p className="text-sm text-slate-600">
                {tab === 'original' && originalAvailable
                  ? 'Source file stored at ingest time. Switch to chunked view to inspect retrieval shards.'
                  : 'Chunks used for embeddings and retrieval (ordered).'}
              </p>
              {!originalAvailable ? (
                <p className="text-xs text-slate-500">
                  Upload a PDF via ingest to store the original file for preview here.
                </p>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === 'original' && originalAvailable ? (
            <div className="flex h-[min(72vh,calc(92vh-11rem))] flex-col gap-2 px-6 pb-6 pt-4">
              <iframe
                title={`PDF preview: ${document.title || document.source}`}
                src={pdfSrc}
                className="w-full flex-1 rounded-lg border border-slate-200 bg-slate-50 shadow-inner"
              />
            </div>
          ) : null}

          {tab === 'chunks' ? (
            <div
              className="h-[min(72vh,calc(92vh-11rem))] overflow-y-auto overflow-x-hidden px-6 pb-6 pt-4"
              tabIndex={0}
            >
              {isLoadingChunks ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  <span className="ml-2 text-sm text-slate-500">Loading chunks…</span>
                </div>
              ) : error ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              ) : chunks.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-slate-500">No chunks found for this document.</p>
                </div>
              ) : (
                <div className="mx-auto grid max-w-5xl gap-4 pb-4">
                  {chunks.map(chunk => (
                    <article
                      key={chunk.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-blue-100 px-2 text-xs font-semibold text-blue-800">
                            {chunk.chunk_index + 1}
                          </span>
                          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Chunk {chunk.chunk_index + 1}
                          </span>
                        </div>
                        {chunk.metadata && Object.keys(chunk.metadata).length > 0 ? (
                          <span className="text-xs text-slate-400">
                            {Object.keys(chunk.metadata).length} metadata field
                            {Object.keys(chunk.metadata).length !== 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </div>
                      <div className="rounded-lg bg-slate-50/80 px-4 py-3 text-sm leading-relaxed text-slate-800">
                        <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap font-sans">
                          {chunk.content}
                        </div>
                      </div>
                      {chunk.metadata && Object.keys(chunk.metadata).length > 0 ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                            Metadata
                          </summary>
                          <pre className="mt-2 overflow-x-auto rounded-md bg-slate-100 p-3 text-xs text-slate-600">
                            {JSON.stringify(chunk.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
