#!/usr/bin/env tsx

/**
 * Script to list all documents and help identify ones to delete
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

async function listDocuments() {
  const res = await fetch(`${API_BASE_URL}/api/v1/documents?limit=1000`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `List documents failed with status ${res.status}`)
  }

  return res.json()
}

async function main() {
  try {
    const response = await listDocuments()
    const documents = response.documents || []

    console.log(`\nFound ${documents.length} documents:\n`)
    console.log('ID'.padEnd(40), 'Title'.padEnd(50), 'Source')
    console.log('-'.repeat(120))

    documents.forEach((doc: any) => {
      const id = doc.id.substring(0, 40)
      const title = (doc.title || 'No title').substring(0, 50)
      const source = doc.source.substring(0, 30)
      console.log(id.padEnd(40), title.padEnd(50), source)
    })

    // Identify problematic documents
    const testDocs = documents.filter(
      (d: any) =>
        d.title?.toLowerCase().includes('test') || d.source?.toLowerCase().includes('test')
    )
    const duplicateTitles = documents.filter(
      (d: any, idx: number) =>
        documents.findIndex((doc: any) => doc.title === d.title) !== idx && d.title
    )

    if (testDocs.length > 0) {
      console.log(`\n⚠ Found ${testDocs.length} test documents:`)
      testDocs.forEach((doc: any) => {
        console.log(`  - ${doc.title || doc.source} (ID: ${doc.id})`)
      })
    }

    if (duplicateTitles.length > 0) {
      console.log(`\n⚠ Found ${duplicateTitles.length} documents with duplicate titles:`)
      duplicateTitles.forEach((doc: any) => {
        console.log(`  - ${doc.title} (ID: ${doc.id})`)
      })
    }

    console.log('\nTo delete documents, you can use SQL directly on the database:')
    console.log("DELETE FROM documents WHERE id = '<document_id>';")
    console.log('\nOr delete by title:')
    console.log("DELETE FROM documents WHERE title = 'Test';")
  } catch (error: any) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

main()
