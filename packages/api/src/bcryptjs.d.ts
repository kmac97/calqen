declare module 'bcryptjs' {
  export function compare(data: string, encrypted: string): Promise<boolean>
  export function hash(data: string, saltOrRounds: number | string): Promise<string>
  export function compareSync(data: string, encrypted: string): boolean
  export function hashSync(data: string, saltOrRounds: number | string): string
  export function genSalt(rounds?: number): Promise<string>
}
