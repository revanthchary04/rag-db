import { generateId } from 'ai'
import { genSaltSync, hashSync } from 'bcrypt-ts'

export function generateHashedPassword(password: string) {
  const salt = genSaltSync(10)
  return hashSync(password, salt)
}

export function generateDummyPassword() {
  return generateHashedPassword(generateId())
}
