export function getDisplayInitial(displayName?: string): string {
  const trimmed = displayName?.trim()
  if (!trimmed) {
    return '—'
  }

  const [firstCharacter] = [...trimmed]
  return firstCharacter ?? '—'
}
