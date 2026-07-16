'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useState, useRef, useEffect } from 'react'
import {
  ingestDocument,
  extractTextFromFile,
  fileToBase64,
  type IngestResponsePayload,
} from '@/lib/api/client'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Upload, Loader2, Sparkles, ClipboardCopy, Check, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

/** Guard against oversized uploads that would stall extraction with no feedback. */
const MAX_FILE_SIZE_BYTES = 15_000_000

function humanizeStep(step: string): string {
  const [head, tail] = step.split(':', 2)
  const headKey = head.replace(/_to_max_\d+$/, '') // e.g. collapsed_blank_line_runs_to_max_2
  const labels: Record<string, string> = {
    removed_utf8_bom: 'Removed UTF-8 BOM',
    unicode_nfc: 'Unicode NFC',
    normalized_crlf: 'Normalized line endings',
    stripped_control_chars: 'Stripped control characters',
    stripped_trailing_line_whitespace: 'Trimmed line endings',
    collapsed_blank_line_runs: 'Collapsed blank lines',
    deduped_consecutive_paragraphs: 'Deduped paragraphs',
  }
  const base = labels[head] ?? labels[headKey] ?? head.replace(/_/g, ' ')
  return tail ? `${base} (${tail})` : base
}

function formatLengthStat(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function ChunkSpreadBar({
  min,
  median,
  max,
  mean,
}: {
  min: number
  median: number
  max: number
  mean: number
}) {
  if (min === max) {
    return (
      <section className="rounded-xl border border-border bg-muted/40 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Chunk length (characters)
        </h3>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          All shards are the same length:{' '}
          <span className="font-mono font-semibold text-foreground">{min.toLocaleString()}</span>{' '}
          chars
        </p>
      </section>
    )
  }
  const span = Math.max(1e-9, max - min)
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100))
  const markers = [
    { label: 'Min', value: min, dot: 'bg-foreground' },
    { label: 'Median', value: median, dot: 'bg-violet-500' },
    { label: 'Mean', value: mean, dot: 'bg-sky-500' },
    { label: 'Max', value: max, dot: 'bg-amber-500' },
  ] as const

  return (
    <section className="rounded-xl border border-border bg-muted/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Chunk length (characters)
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Distribution of stored shard sizes after merging.
      </p>
      <div className="relative mx-auto mt-4 h-5 max-w-xl">
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-muted shadow-inner" />
        {markers.map(({ label, value, dot }) => (
          <span
            key={`tick-${label}`}
            className={cn(
              'absolute top-1/2 z-[1] block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-sm',
              dot
            )}
            style={{ left: `${pct(value)}%` }}
            title={`${value}`}
          />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {markers.map(({ label, value, dot }) => (
          <div
            key={label}
            className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
          >
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="font-mono text-sm font-semibold tabular-nums leading-snug text-foreground">
                {formatLengthStat(value)}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  )
}

function IngestInsightPanel({
  outcome,
  onIngestAnother,
  onBackToForm,
  onClose,
}: {
  outcome: IngestResponsePayload
  onIngestAnother: () => void
  onBackToForm: () => void
  onClose: () => void
}) {
  const { preprocessing, chunking } = outcome
  const [copied, setCopied] = useState(false)
  const [idCopied, setIdCopied] = useState(false)

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(outcome, null, 2))
      setCopied(true)
      toast.message('Copied ingest report')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const copyDocumentId = async () => {
    try {
      await navigator.clipboard.writeText(outcome.document_id)
      setIdCopied(true)
      toast.message('Document ID copied')
      window.setTimeout(() => setIdCopied(false), 2000)
    } catch {
      toast.error('Could not copy ID')
    }
  }

  const chunkingSideTitle = chunking.adaptive_chunking ? 'Adaptive chunking' : 'Chunk configuration'

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border shadow-sm">
      <CardHeader className="shrink-0 space-y-4 border-b border-border bg-muted/30 pb-4 pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                {outcome.replaced_existing ? 'Index updated' : 'Indexed successfully'}
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed text-muted-foreground">
                {chunking.chunks_created.toLocaleString()} chunks · mean shard{' '}
                {formatLengthStat(chunking.chunk_length_mean)} chars · window{' '}
                {chunking.chunk_target_size}/{chunking.chunk_overlap}
              </CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            {chunking.adaptive_chunking ? (
              <Badge className="font-medium">Adaptive</Badge>
            ) : (
              <Badge variant="secondary" className="font-medium">
                Fixed size
              </Badge>
            )}
            {outcome.replaced_existing ? (
              <Badge variant="outline" className="font-medium">
                Replaced existing
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Document ID
            </p>
            <p className="mt-0.5 break-all font-mono text-xs text-foreground">
              {outcome.document_id}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 self-start sm:self-auto"
            onClick={() => void copyDocumentId()}
          >
            {idCopied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <ClipboardCopy className="h-3.5 w-3.5" />
            )}
            {idCopied ? 'Copied' : 'Copy ID'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 space-y-6 overflow-y-auto py-5 text-sm">
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Shard summary
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <div className="rounded-lg border border-border bg-card p-3 text-left shadow-sm sm:p-3.5">
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {chunking.chunks_created.toLocaleString()}
              </p>
              <p className="mt-1 text-xs font-medium leading-snug text-muted-foreground">
                Chunks stored
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-left shadow-sm sm:p-3.5">
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {formatLengthStat(chunking.chunk_length_mean)}
              </p>
              <p className="mt-1 text-xs font-medium leading-snug text-muted-foreground">
                Avg. shard length
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-left shadow-sm sm:p-3.5">
              <p className="text-lg font-semibold tabular-nums leading-tight text-foreground sm:text-xl">
                {chunking.chunk_target_size}
                <span className="font-normal text-muted-foreground"> / </span>
                {chunking.chunk_overlap}
              </p>
              <p className="mt-1 text-xs font-medium leading-snug text-muted-foreground">
                Window / overlap
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-left shadow-sm sm:p-3.5">
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {chunking.undersized_chunk_merges.toLocaleString()}
              </p>
              <p className="mt-1 text-xs font-medium leading-snug text-muted-foreground">
                Undersize merges
              </p>
            </div>
          </div>
        </div>

        <ChunkSpreadBar
          min={chunking.chunk_length_min}
          median={chunking.chunk_length_median}
          max={chunking.chunk_length_max}
          mean={chunking.chunk_length_mean}
        />

        <Separator className="bg-border" />

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Preprocessing
            </h3>
            <p className="text-sm text-foreground">
              <span className="font-mono tabular-nums">
                {preprocessing.original_character_count.toLocaleString()}
              </span>
              <span className="text-muted-foreground"> → </span>
              <span className="font-mono tabular-nums">
                {preprocessing.normalized_character_count.toLocaleString()}
              </span>
              <span className="text-muted-foreground"> characters</span>
              {preprocessing.character_delta !== 0 ? (
                <span
                  className={cn(
                    'ml-1.5 font-medium tabular-nums',
                    preprocessing.character_delta < 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  )}
                >
                  ({preprocessing.character_delta > 0 ? '+' : ''}
                  {preprocessing.character_delta.toLocaleString()})
                </span>
              ) : null}
            </p>
            {preprocessing.steps_applied.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {preprocessing.steps_applied.map(s => (
                  <Badge key={s} variant="secondary" className="max-w-full font-normal">
                    <span className="break-words">{humanizeStep(s)}</span>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No structural changes (already clean).
              </p>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {chunkingSideTitle}
            </h3>
            <ul className="space-y-2 text-sm text-foreground">
              <li className="flex justify-between gap-4 border-b border-border pb-2">
                <span className="text-muted-foreground">Est. target shards</span>
                <span className="font-mono font-medium tabular-nums">
                  {chunking.estimated_target_chunks.toLocaleString()}
                </span>
              </li>
              <li className="flex justify-between gap-4 border-b border-border pb-2">
                <span className="text-muted-foreground">Defaults (env)</span>
                <span className="font-mono font-medium tabular-nums">
                  {chunking.config_chunk_size} / {chunking.config_chunk_overlap}
                </span>
              </li>
              <li className="flex justify-between gap-4">
                <span className="text-muted-foreground">Merge soft cap</span>
                <span className="font-mono font-medium tabular-nums">
                  {chunking.merged_chunk_soft_cap_chars.toLocaleString()} chars
                </span>
              </li>
            </ul>
          </div>
        </div>

        {preprocessing.warnings.length > 0 ? (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertTitle className="text-amber-700 dark:text-amber-300">
              Preprocessing notice
            </AlertTitle>
            <AlertDescription className="text-sm text-amber-700/90 dark:text-amber-200/90">
              {preprocessing.warnings.join(' · ')}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      <CardFooter className="flex shrink-0 flex-col gap-3 border-t border-border bg-muted/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onBackToForm}
        >
          Back to form
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void copyJson()}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onIngestAnother}>
            Ingest another
          </Button>
          <Button type="button" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

export default function IngestDialog({ open, onOpenChange, onSuccess }: Props) {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('')
  const [text, setText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showManualInput, setShowManualInput] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [ingestInsight, setIngestInsight] = useState<IngestResponsePayload | null>(null)
  /** PDF bytes for server-side original preview (cleared when source file is not a PDF). */
  const [pendingOriginalPdfBase64, setPendingOriginalPdfBase64] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prevOpenRef = useRef(open)

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setIngestInsight(null)
    }
    prevOpenRef.current = open
  }, [open])

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  const resetForm = () => {
    setTitle('')
    setSource('')
    setText('')
    setError(null)
    setShowManualInput(false)
    setIngestInsight(null)
    setPendingOriginalPdfBase64(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClose = (next: boolean) => {
    if (!next && !isLoading) {
      resetForm()
    }
    onOpenChange(next)
  }

  const handleIngestAnother = () => {
    resetForm()
  }

  const handleInsightClose = () => {
    resetForm()
    onOpenChange(false)
  }

  // Extract text from PDF/DOCX files using backend API
  const extractTextFromPDF = async (file: File): Promise<string> => {
    return extractTextFromFile(file)
  }

  const extractTextFromDOCX = async (file: File): Promise<string> => {
    return extractTextFromFile(file)
  }

  const extractMarkdownTitle = (text: string): string | null => {
    // Extract title from first markdown header (# Title)
    const lines = text.trim().split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('# ')) {
        return trimmed.substring(2).trim()
      }
      if (trimmed.startsWith('## ')) {
        return trimmed.substring(3).trim()
      }
    }
    return null
  }

  // Auto-extract title from markdown when text is pasted manually
  useEffect(() => {
    if (text && !title && text.trim().startsWith('#')) {
      const extractedTitle = extractMarkdownTitle(text)
      if (extractedTitle) {
        setTitle(extractedTitle)
      }
    }
  }, [text, title])

  const handleFileSelect = async (file: File) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(
        `File is too large (${(file.size / 1_000_000).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE_BYTES / 1_000_000} MB.`
      )
      return
    }
    try {
      setError(null)
      setIsExtracting(true)
      let fileText = ''

      // Determine file type and extract text accordingly
      const fileName = file.name.toLowerCase()
      if (fileName.endsWith('.pdf')) {
        fileText = await extractTextFromPDF(file)
        try {
          setPendingOriginalPdfBase64(await fileToBase64(file))
        } catch {
          setPendingOriginalPdfBase64(null)
        }
      } else if (fileName.endsWith('.docx')) {
        fileText = await extractTextFromDOCX(file)
        setPendingOriginalPdfBase64(null)
      } else {
        // For text-based files (txt, md, json, etc.)
        fileText = await readFileAsText(file)
        setPendingOriginalPdfBase64(null)
      }

      setText(fileText)

      // Auto-fill source from filename if empty
      if (!source) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
        setSource(nameWithoutExt)
      }

      // Auto-fill title from markdown header if it's a markdown file, otherwise use filename
      if (!title) {
        const isMarkdown = isMarkdownFile(file.name)
        if (isMarkdown) {
          const extractedTitle = extractMarkdownTitle(fileText)
          if (extractedTitle) {
            setTitle(extractedTitle)
          } else {
            // Fallback to filename without extension
            setTitle(file.name.replace(/\.[^/.]+$/, ''))
          }
        } else {
          setTitle(file.name)
        }
      }
    } catch (err) {
      setError('Failed to read file')
      console.error(err)
    } finally {
      setIsExtracting(false)
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      void handleFileSelect(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging to false if we're actually leaving the drop zone
    // (not just moving between child elements)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const file = files[0]
      // Validate file type
      const allowedExtensions = ['.txt', '.md', '.markdown', '.json', '.pdf', '.docx']
      const fileName = file.name.toLowerCase()
      const isValidFile = allowedExtensions.some(ext => fileName.endsWith(ext))

      if (!isValidFile) {
        setError(`Invalid file type. Please upload: ${allowedExtensions.join(', ')}`)
        return
      }

      await handleFileSelect(file)
    }
  }

  const isMarkdownFile = (filename: string): boolean => {
    return /\.(md|markdown)$/i.test(filename)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!source.trim()) {
      setError('Source is required')
      return
    }

    if (!text.trim()) {
      setError('Text content is required')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Determine if markdown based on file extension or content
      const isMarkdown = isMarkdownFile(title) || text.trim().startsWith('#')

      const outcome = await ingestDocument({
        source: source.trim(),
        title: title.trim() || undefined,
        text: text.trim(),
        is_markdown: isMarkdown,
        ...(pendingOriginalPdfBase64
          ? {
              original_file_base64: pendingOriginalPdfBase64,
              original_media_type: 'application/pdf' as const,
            }
          : {}),
      })

      setIngestInsight(outcome)
      onSuccess?.()

      toast.success(outcome.replaced_existing ? 'Document replaced' : 'Document ingested', {
        description: 'Full pipeline report is shown in the dialog below.',
        duration: 5000,
      })
    } catch (err: unknown) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to ingest document')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          'flex max-h-[92vh] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-h-[92vh]',
          ingestInsight ? 'w-[min(100vw-1rem,48rem)]' : 'w-[min(100vw-1rem,36rem)]'
        )}
      >
        <div
          className={cn(
            'shrink-0 border-b border-border px-6 pb-5 pt-7 sm:px-8',
            ingestInsight && 'bg-muted/40'
          )}
        >
          <DialogHeader
            className={cn('space-y-2', ingestInsight ? 'text-left sm:text-left' : 'text-center')}
          >
            <div
              className={cn(
                'mb-2 flex',
                ingestInsight ? 'justify-start' : 'justify-center sm:justify-center'
              )}
            >
              {ingestInsight ? (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 ring-4 ring-emerald-500/20 dark:text-emerald-400">
                  <CheckCircle2 className="h-7 w-7" strokeWidth={2.25} aria-hidden />
                </div>
              ) : (
                <div className="rounded-full bg-muted p-3 ring-1 ring-border">
                  <Upload className="h-7 w-7 text-muted-foreground" aria-hidden />
                </div>
              )}
            </div>
            <DialogTitle className={cn(ingestInsight && 'text-xl font-semibold tracking-tight')}>
              {ingestInsight ? 'Ingest report' : 'Ingest a document'}
            </DialogTitle>
            <DialogDescription
              className={cn(
                ingestInsight ? 'text-sm text-muted-foreground' : 'text-base text-muted-foreground'
              )}
            >
              {ingestInsight
                ? 'Normalization, chunking, and merge stats for this run. Use the card below for details and actions.'
                : 'Upload a file or paste text to add it to the RAG index.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        {ingestInsight ? (
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-4 sm:px-8">
            <IngestInsightPanel
              outcome={ingestInsight}
              onIngestAnother={handleIngestAnother}
              onBackToForm={() => setIngestInsight(null)}
              onClose={handleInsightClose}
            />
          </div>
        ) : null}

        <form
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-6 pb-8 pt-2 sm:px-8',
            ingestInsight && 'hidden'
          )}
          onSubmit={handleSubmit}
        >
          {/* File upload area */}
          <div
            role="button"
            tabIndex={isExtracting ? -1 : 0}
            aria-label="Upload a document: drag and drop a file here, or activate to browse"
            aria-disabled={isExtracting}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => {
              if (!isExtracting) fileInputRef.current?.click()
            }}
            onKeyDown={e => {
              if (isExtracting) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            className={cn(
              'border-2 border-dashed rounded-lg text-center transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isExtracting
                ? 'cursor-wait border-border bg-muted/40'
                : isDragging
                  ? 'cursor-pointer border-foreground bg-accent scale-[1.02]'
                  : 'cursor-pointer border-border bg-muted/40 hover:border-foreground/30 hover:bg-muted'
            )}
            style={{
              padding: '2.5rem',
              minHeight: '120px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isExtracting ? (
              <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Extracting text…
              </p>
            ) : isDragging ? (
              <p className="text-sm font-medium text-foreground">Drop file here</p>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Drag and drop a file here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supported: .txt, .md, .markdown, .json, .pdf, .docx · up to 15 MB
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.json,.pdf,.docx"
              onChange={handleFileInputChange}
              className="hidden"
              style={{ display: 'none' }}
              id="file-upload"
            />
          </div>

          {/* Manual text input toggle */}
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowManualInput(!showManualInput)}
            >
              {showManualInput ? 'Hide' : 'Enter text manually'}
            </Button>
            {showManualInput && (
              <Textarea
                ref={textareaRef}
                rows={8}
                placeholder="Enter document text..."
                value={text}
                onChange={e => setText(e.target.value)}
                disabled={isLoading}
              />
            )}
          </div>

          {/* Source and Title inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label className="text-sm font-medium">Source</label>
              <Input
                value={source}
                onChange={e => setSource(e.target.value)}
                placeholder="Source (e.g. URL, system name)"
                disabled={isLoading}
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label className="text-sm font-medium">
                Title <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Auto-filled from the file name if left blank"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive" style={{ marginTop: '0.5rem' }}>
              {error}
            </p>
          )}

          {/* Submit buttons */}
          <div className="flex justify-end gap-2" style={{ paddingTop: '1rem' }}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleClose(false)}
              disabled={isLoading || Boolean(ingestInsight)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !source.trim() || !text.trim() || Boolean(ingestInsight)}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Ingesting...
                </>
              ) : (
                'Ingest'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
