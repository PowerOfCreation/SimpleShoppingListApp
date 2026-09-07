import { Category } from "@/constants/Categories"
import { CURATED_CATEGORY_KEYWORDS } from "@/constants/category-keywords"
import generatedKeywords from "@/constants/category-keywords.generated.json"

// Applies only to the generated table: those keywords are unreviewed taxonomy
// synonyms, and short ones are prone to matching inside unrelated words.
// Curated keywords are hand-reviewed, so a short domain-specific one (e.g.
// "tk-" for Tiefkühl-) is trusted as-is.
const MIN_GENERATED_KEYWORD_LENGTH = 4

function byLengthDescending([a]: [string, Category], [b]: [string, Category]) {
  return b.length - a.length
}

// Tier 1: curated, always wins. Sorted once at module load so lookup is a
// linear scan for the (already longest-first) match.
const CURATED = [...CURATED_CATEGORY_KEYWORDS].sort(byLengthDescending)

// Tier 2: generated from Open Food Facts taxonomies, used only as a fallback
// for terms tier 1 doesn't know. See scripts/build-category-keywords.ts.
const GENERATED = (
  Object.entries(generatedKeywords as Record<string, Category>) as [
    string,
    Category,
  ][]
)
  .filter(([keyword]) => keyword.length >= MIN_GENERATED_KEYWORD_LENGTH)
  .sort(byLengthDescending)

function findLongestMatch(
  name: string,
  table: [string, Category][]
): Category | undefined {
  for (const [keyword, category] of table) {
    if (name.includes(keyword)) {
      return category
    }
  }
  return undefined
}

/**
 * Classifies a shopping list item name into a category by longest matching
 * keyword, curated table first, generated table as fallback. Pure and
 * synchronous - no model, no I/O, safe to call on every render.
 */
export function categorizeIngredient(name: string): Category {
  const normalized = name.trim().toLowerCase()
  if (!normalized) {
    return Category.OTHER
  }
  return (
    findLongestMatch(normalized, CURATED) ??
    findLongestMatch(normalized, GENERATED) ??
    Category.OTHER
  )
}
