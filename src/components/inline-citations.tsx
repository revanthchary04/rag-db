'use client'

import { Children, type ComponentProps, Fragment, type ReactNode } from 'react'
import type { Streamdown } from 'streamdown'

// Use Streamdown's own components type (its bundled react-markdown) so overrides
// stay assignable to what <Response> passes through.
type StreamdownComponents = ComponentProps<typeof Streamdown>['components']

// Split on bracketed numeric refs like [1] or [12] while keeping the delimiters.
const CITATION_SPLIT = /(\[\d+\])/g
const CITATION_TOKEN = /^\[(\d+)\]$/

function CitationRef({ n, onClick }: { n: number; onClick: (n: number) => void }) {
  return (
    <button
      aria-label={`Show source ${n}`}
      className="mx-0.5 inline-flex h-[1.15em] min-w-[1.15em] translate-y-[-0.1em] items-center justify-center rounded bg-muted px-1 align-middle text-[0.7em] font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-accent hover:text-foreground"
      data-testid="inline-citation"
      onClick={e => {
        e.preventDefault()
        onClick(n)
      }}
      type="button"
    >
      {n}
    </button>
  )
}

/**
 * Replace `[n]` refs in plain-text runs with clickable chips, leaving non-string
 * children (bold/italic/code) untouched so their formatting is preserved. Refs
 * outside the available citation range are left as literal text.
 */
function renderChildrenWithCitations(
  children: ReactNode,
  onCitationClick: (n: number) => void,
  count: number
): ReactNode {
  return Children.map(children, child => {
    if (typeof child !== 'string') return child
    const segments = child.split(CITATION_SPLIT)
    if (segments.length === 1) return child
    return segments.map((segment, i) => {
      const match = segment.match(CITATION_TOKEN)
      if (match) {
        const n = Number(match[1])
        if (n >= 1 && n <= count) {
          return <CitationRef key={i} n={n} onClick={onCitationClick} />
        }
      }
      return <Fragment key={i}>{segment}</Fragment>
    })
  })
}

/**
 * Streamdown/react-markdown component overrides that make `[n]` citation refs in
 * paragraphs and list items clickable. Returns undefined when there are no
 * citations to link to.
 */
export function createCitationComponents(
  onCitationClick: (n: number) => void,
  count: number
): StreamdownComponents | undefined {
  if (count <= 0) return undefined
  return {
    p: ({ children }) => <p>{renderChildrenWithCitations(children, onCitationClick, count)}</p>,
    li: ({ children }) => <li>{renderChildrenWithCitations(children, onCitationClick, count)}</li>,
  }
}
