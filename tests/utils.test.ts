import { describe, it, expect } from '@jest/globals'
import { cosineSimilarity } from '@/lib/utils'

describe('Utils', () => {
  describe('cosineSimilarity', () => {
    it('should calculate cosine similarity between two vectors', () => {
      const a = [1, 0, 0]
      const b = [1, 0, 0]
      const similarity = cosineSimilarity(a, b)
      expect(similarity).toBe(1)
    })

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0]
      const b = [0, 1, 0]
      const similarity = cosineSimilarity(a, b)
      expect(similarity).toBe(0)
    })

    it('should throw error for vectors of different lengths', () => {
      const a = [1, 2]
      const b = [1, 2, 3]
      expect(() => cosineSimilarity(a, b)).toThrow()
    })
  })
})
