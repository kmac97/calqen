// parseInt(process.env[X] ?? fallback, 10) looks safe but isn't: `??` only catches null/undefined,
// not a non-numeric string, which parses to NaN and silently breaks anything comparing against it
// (e.g. a `for` loop bound becomes `<= NaN`, which is always false).
export function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10)
  return Number.isNaN(parsed) ? fallback : parsed
}
