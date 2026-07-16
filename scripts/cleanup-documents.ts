#!/usr/bin/env tsx

/**
 * Script to clean up old/test documents
 * Deletes documents with titles containing "Test" or other unwanted patterns
 */

const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

interface Document {
  id: string
  source: string
  title?: string
  created_at?: string
}

async function listDocuments(): Promise<Document[]> {
  const res = await fetch(`${API_BASE_URL}/api/v1/documents?limit=1000`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `List documents failed with status ${res.status}`)
  }

  const response = await res.json()
  return response.documents || []
}

async function deleteDocument(documentId: string): Promise<void> {
  // Try DELETE endpoint first
  let res = await fetch(`${API_BASE_URL}/api/v1/documents/${documentId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  })

  // If DELETE endpoint doesn't exist, we'll need to use SQL directly
  if (res.status === 404 || res.status === 405) {
    console.log(
      `⚠ Delete endpoint not available. Document ${documentId} needs to be deleted via SQL.`
    )
    console.log(`   Run: DELETE FROM documents WHERE id = '${documentId}';`)
    return
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Delete failed with status ${res.status}`)
  }
}

async function main() {
  try {
    console.log('Fetching documents...\n')
    const documents = await listDocuments()

    // Identify documents to delete
    const toDelete = new Set<string>()
    const titleMap = new Map<string, any[]>()

    // Group documents by title
    documents.forEach(doc => {
      const title = (doc.title || '').trim()
      if (title) {
        if (!titleMap.has(title)) {
          titleMap.set(title, [])
        }
        titleMap.get(title)!.push(doc)
      }
    })

    // Find duplicates - keep the most recent, delete others
    titleMap.forEach((docs, title) => {
      if (docs.length > 1) {
        // Sort by created_at (most recent first)
        docs.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
          return dateB - dateA
        })

        // Keep the first (most recent), mark others for deletion
        for (let i = 1; i < docs.length; i++) {
          toDelete.add(docs[i].id)
          console.log(`  Marking duplicate: "${title}" (keeping newest, deleting: ${docs[i].id})`)
        }
      }
    })

    // Also delete test documents and typos
    documents.forEach(doc => {
      const title = (doc.title || '').toLowerCase()
      const source = (doc.source || '').toLowerCase()

      // Delete documents with "test" in title or source
      if (title.includes('test') || source.includes('test')) {
        toDelete.add(doc.id)
      }

      // Delete documents with typos like "Explination"
      if (title.includes('explination')) {
        toDelete.add(doc.id)
      }

      // Delete documents with generic names
      if (title === 'rag documentation' || title === 'rag explination') {
        toDelete.add(doc.id)
      }
    })

    const toDeleteArray = Array.from(toDelete)
      .map(id => documents.find(d => d.id === id)!)
      .filter(Boolean)

    if (toDeleteArray.length === 0) {
      console.log('✅ No documents found matching cleanup criteria.')
      return
    }

    console.log(`\nFound ${toDeleteArray.length} documents to delete:\n`)
    toDeleteArray.forEach(doc => {
      console.log(`  - ${doc.title || doc.source} (ID: ${doc.id})`)
    })

    console.log('\n⚠️  Note: Delete endpoint may not be available.')
    console.log('If delete fails, use SQL directly:\n')
    toDelete.forEach(doc => {
      console.log(`DELETE FROM documents WHERE id = '${doc.id}';`)
    })
    console.log()

    // Try to delete via API
    for (const doc of toDeleteArray) {
      try {
        await deleteDocument(doc.id)
        console.log(`✓ Deleted: ${doc.title || doc.source}`)
      } catch (error: any) {
        console.log(`✗ Failed to delete ${doc.title || doc.source}: ${error.message}`)
        console.log(`  Use SQL: DELETE FROM documents WHERE id = '${doc.id}';`)
      }
    }

    console.log(`\n✅ Cleanup complete!`)
  } catch (error: any) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
