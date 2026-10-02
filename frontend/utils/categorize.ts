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

// Multi-word keywords match as a word set in any order and with anything in
// between ("tomaten, stückig", "stückige bio tomaten"); single words stay
// plain substrings. Longer keywords still win, so these beat "tomate".
function matches(name: string, keyword: string): boolean {
  return keyword.includes(" ")
    ? keyword.split(" ").every((part) => name.includes(part))
    : name.includes(keyword)
}

function findLongestMatch(
  name: string,
  table: [string, Category][]
): Category | undefined {
  for (const [keyword, category] of table) {
    if (matches(name, keyword)) {
      return category
    }
  }
  return undefined
}

// Capped FIFO cache, keyed by normalized name. Cap must stay well above a
// session's total distinct item names - eviction forces a re-scan on the
// next sort/section render, not just extra memory. 5000 covers realistic
// usage while still bounding runaway growth over very long sessions.
const CATEGORY_CACHE_CAPACITY = 5000
const categoryCache = new Map<string, Category>()

/**
 * Classifies a shopping list item name into a category by longest matching
 * keyword, curated table first, generated table as fallback. Pure and
 * synchronous, and memoized - the keyword scan is expensive (~8.8k entries),
 * so repeated calls for the same name (e.g. sorting/sectioning a list) are
 * cheap after the first.
 */
export function categorizeIngredient(name: string): Category {
  const normalized = name.trim().toLowerCase()
  if (!normalized) {
    return Category.OTHER
  }
  const cached = categoryCache.get(normalized)
  if (cached !== undefined) {
    return cached
  }
  const category =
    findLongestMatch(normalized, CURATED) ??
    findLongestMatch(normalized, GENERATED) ??
    Category.OTHER
  categoryCache.set(normalized, category)
  if (categoryCache.size > CATEGORY_CACHE_CAPACITY) {
    categoryCache.delete(categoryCache.keys().next().value as string)
  }
  return category
}
