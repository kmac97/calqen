import { randomBytes } from 'crypto'

export function generateShortId(): string {
  return randomBytes(4).toString('hex')
}
