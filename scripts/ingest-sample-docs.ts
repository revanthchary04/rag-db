#!/usr/bin/env tsx

/**
 * Script to ingest all sample markdown documents from data/sample_docs/
 * Extracts titles from markdown headers and ingests them via the API
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

interface Document {
  source: string
  title: string
  text: string
  is_markdown: boolean
}

function extractMarkdownTitle(text: string): string | null {
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

async function ingestDocument(doc: Document): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Ingest failed with status ${res.status}`)
  }

  const result = await res.json()
  console.log(`✓ Ingested: ${doc.title}`)
  return result
}

async function main() {
  const sampleDocsDir = join(process.cwd(), 'data', 'sample_docs')
  const files = readdirSync(sampleDocsDir).filter(f => f.endsWith('.md'))

  console.log(`Found ${files.length} markdown files to ingest...\n`)

  const documents: Document[] = []

  // Read and parse all files
  for (const file of files) {
    const filePath = join(sampleDocsDir, file)
    const text = readFileSync(filePath, 'utf-8')
    const title = extractMarkdownTitle(text)

    if (!title) {
      console.warn(`⚠ Warning: Could not extract title from ${file}, skipping`)
      continue
    }

    const source = file.replace(/\.md$/, '')
    documents.push({
      source,
      title,
      text,
      is_markdown: true,
    })
  }

  // Ingest all documents
  console.log('Ingesting documents...\n')
  for (const doc of documents) {
    try {
      await ingestDocument(doc)
    } catch (error: any) {
      console.error(`✗ Failed to ingest ${doc.title}:`, error.message)
    }
  }

  console.log(`\n✅ Completed! Ingested ${documents.length} documents.`)
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
