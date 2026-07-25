// Duplicate-detection heuristic (user decision): token-sort + edit distance.
// Normalize (lowercase, strip punctuation), sort words, then compare the
// joined strings with a Levenshtein ratio. Word order and typos are caught;
// "Phase 2"-style suffixes intentionally read as different buildings.
const SIMILARITY_THRESHOLD = 0.8

function normalizeTokens(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1
  const cols = b.length + 1
  let previous = Array.from({ length: cols }, (_, j) => j)

  for (let i = 1; i < rows; i++) {
    const current = [i]
    for (let j = 1; j < cols; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        previous[j] + 1, // deletion
        current[j - 1] + 1, // insertion
        previous[j - 1] + substitutionCost,
      )
    }
    previous = current
  }
  return previous[cols - 1]
}

function levenshteinRatio(a, b) {
  const maxLength = Math.max(a.length, b.length)
  if (maxLength === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLength
}

export function isSimilarName(a, b) {
  const na = normalizeTokens(a).join(' ')
  const nb = normalizeTokens(b).join(' ')
  return levenshteinRatio(na, nb) >= SIMILARITY_THRESHOLD
}
