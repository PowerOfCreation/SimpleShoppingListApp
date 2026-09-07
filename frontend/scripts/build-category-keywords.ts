/// <reference types="node" />
/**
 * Generates constants/category-keywords.generated.json from the Open Food
 * Facts taxonomies (food, beauty, petfood, product). Not run in CI - run
 * manually and commit the result. The tsconfig's "module": "preserve" makes
 * plain ts-node try native ESM resolution and fail on extensionless
 * imports, so force CommonJS for this one-off run:
 *
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' \
 *     node -r ts-node/register scripts/build-category-keywords.ts
 *
 * Deterministic: same taxonomy snapshot in -> byte-identical JSON out, so a
 * re-run shows up as a real diff, not noise.
 *
 * Data source: Open Food Facts, licensed under the Open Database License
 * (ODbL) - https://world.openfoodfacts.org/data. Attribution required on
 * reuse; see frontend/app/(about)/ for the in-app credit.
 */
import * as fs from "fs"
import * as path from "path"
import { Category } from "../constants/Categories"

const TAXONOMY_URLS: Record<string, string> = {
  food: "https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/food/categories.txt",
  beauty:
    "https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/beauty/categories.txt",
  petfood:
    "https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/petfood/categories.txt",
  product:
    "https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/product/categories.txt",
}

const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "constants",
  "category-keywords.generated.json"
)

// OFF taxonomy root node (English canonical name, lowercase) -> our category.
// Deliberately narrow: broad roots like "plant-based foods" or "fresh foods"
// are left unmapped, because in OFF almost everything plant-derived hangs
// off them, which would swamp Pantry items (spaghetti, honey, ketchup) into
// Fruit & Vegetables.
const ROOT_TO_CATEGORY: Record<string, Category> = {
  "frozen foods": Category.FROZEN,
  "ice creams and sorbets": Category.FROZEN,
  "frozen desserts": Category.FROZEN,
  "pet food": Category.PET_SUPPLIES,
  "dog food": Category.PET_SUPPLIES,
  "cat food": Category.PET_SUPPLIES,
  "pet supplies": Category.PET_SUPPLIES,
  hygiene: Category.PERSONAL_CARE,
  "body care": Category.PERSONAL_CARE,
  "hair care": Category.PERSONAL_CARE,
  "face care": Category.PERSONAL_CARE,
  cosmetics: Category.PERSONAL_CARE,
  "oral hygiene": Category.PERSONAL_CARE,
  deodorants: Category.PERSONAL_CARE,
  soaps: Category.PERSONAL_CARE,
  shampoos: Category.PERSONAL_CARE,
  toothpastes: Category.PERSONAL_CARE,
  "household products": Category.HOUSEHOLD,
  "cleaning products": Category.HOUSEHOLD,
  laundry: Category.HOUSEHOLD,
  "paper products": Category.HOUSEHOLD,
  "kitchen supplies": Category.HOUSEHOLD,
  detergents: Category.HOUSEHOLD,
  "beverages and beverages preparations": Category.DRINKS,
  beverages: Category.DRINKS,
  waters: Category.DRINKS,
  "alcoholic beverages": Category.DRINKS,
  juices: Category.DRINKS,
  wines: Category.DRINKS,
  beers: Category.DRINKS,
  "hot beverages": Category.DRINKS,
  dairies: Category.DAIRY_CHEESE,
  cheeses: Category.DAIRY_CHEESE,
  milks: Category.DAIRY_CHEESE,
  yogurts: Category.DAIRY_CHEESE,
  creams: Category.DAIRY_CHEESE,
  butters: Category.DAIRY_CHEESE,
  "eggs and their products": Category.DAIRY_CHEESE,
  eggs: Category.DAIRY_CHEESE,
  "meats and their products": Category.MEAT_FISH,
  seafood: Category.MEAT_FISH,
  fishes: Category.MEAT_FISH,
  poultry: Category.MEAT_FISH,
  charcuteries: Category.MEAT_FISH,
  hams: Category.MEAT_FISH,
  sausages: Category.MEAT_FISH,
  breads: Category.BREAD_BAKERY,
  viennoiseries: Category.BREAD_BAKERY,
  pastries: Category.BREAD_BAKERY,
  "bakery products": Category.BREAD_BAKERY,
  confectioneries: Category.SWEETS_SNACKS,
  snacks: Category.SWEETS_SNACKS,
  "biscuits and crackers": Category.SWEETS_SNACKS,
  "chips and fries": Category.SWEETS_SNACKS,
  chocolates: Category.SWEETS_SNACKS,
  "cocoa and its products": Category.SWEETS_SNACKS,
  candies: Category.SWEETS_SNACKS,
  "salty snacks": Category.SWEETS_SNACKS,
  fruits: Category.FRUIT_VEGETABLES,
  vegetables: Category.FRUIT_VEGETABLES,
  legumes: Category.FRUIT_VEGETABLES,
  mushrooms: Category.FRUIT_VEGETABLES,
  "fresh vegetables": Category.FRUIT_VEGETABLES,
  "fresh fruits": Category.FRUIT_VEGETABLES,
  salads: Category.FRUIT_VEGETABLES,
  herbs: Category.FRUIT_VEGETABLES,
  "canned foods": Category.PANTRY,
  condiments: Category.PANTRY,
  "cooking helpers": Category.PANTRY,
  "pastas and dumplings": Category.PANTRY,
  "cereals and their products": Category.PANTRY,
  "cereals and potatoes": Category.PANTRY,
  spreads: Category.PANTRY,
  fats: Category.PANTRY,
  broths: Category.PANTRY,
  breakfasts: Category.PANTRY,
  sauces: Category.PANTRY,
  seasonings: Category.PANTRY,
  spices: Category.PANTRY,
  flours: Category.PANTRY,
  rices: Category.PANTRY,
  pastas: Category.PANTRY,
  oils: Category.PANTRY,
  honeys: Category.PANTRY,
  jams: Category.PANTRY,
  sugars: Category.PANTRY,
  noodles: Category.PANTRY,
}

type TaxonomyNode = { langTerms: Map<string, string[]>; parents: string[] }

function parseTaxonomy(text: string): Map<string, TaxonomyNode> {
  const nodes = new Map<string, TaxonomyNode>()
  for (const block of text.split("\n\n")) {
    const lines = block
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
    const parents = lines
      .filter((l) => l.startsWith("<"))
      .map((l) => l.slice(1).trim())
    const entries = lines.filter(
      (l) => !l.startsWith("<") && /^[a-z]{2}(_[a-z]{2})?:/.test(l)
    )
    if (entries.length === 0) continue

    const langTerms = new Map<string, string[]>()
    for (const line of entries) {
      const idx = line.indexOf(":")
      const lang = line.slice(0, idx).trim()
      const terms = line
        .slice(idx + 1)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
      langTerms.set(lang, [...(langTerms.get(lang) ?? []), ...terms])
    }
    const en = langTerms.get("en")
    if (!en || en.length === 0) continue
    const key = en[0].toLowerCase()
    const parentKeys = parents.map((p) => {
      const i = p.indexOf(":")
      return (i >= 0 ? p.slice(i + 1) : p).trim().toLowerCase()
    })
    nodes.set(key, { langTerms, parents: parentKeys })
  }
  return nodes
}

// Nearest mapped ancestor in the taxonomy DAG, not a fixed priority order -
// picking a fixed priority instead sent "spaghetti"/"honey"/"ketchup" to
// Fruit & Vegetables, because they're transitively under broad plant-based
// roots that are deliberately excluded from ROOT_TO_CATEGORY above.
function nearestCategory(
  key: string,
  nodes: Map<string, TaxonomyNode>,
  depth = 0,
  seen = new Set<string>()
): { depth: number; category: Category } | undefined {
  const direct = ROOT_TO_CATEGORY[key]
  if (direct) return { depth, category: direct }
  if (seen.has(key) || depth > 12) return undefined
  seen.add(key)
  let best: { depth: number; category: Category } | undefined
  for (const parent of nodes.get(key)?.parents ?? []) {
    const result = nearestCategory(parent, nodes, depth + 1, seen)
    if (result && (!best || result.depth < best.depth)) best = result
  }
  return best
}

const INVALID_TERM = /[0-9%()/]/

function cleanTerm(term: string): string | undefined {
  const t = term.trim().toLowerCase()
  if (INVALID_TERM.test(t)) return undefined
  if (t.length < 4 || t.length > 24) return undefined
  if (t.split(" ").length > 2) return undefined
  return t
}

async function main() {
  const keywordDepth = new Map<string, { depth: number; category: Category }>()
  const stats: Record<string, number> = {}

  for (const [name, url] of Object.entries(TAXONOMY_URLS)) {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to fetch ${name} taxonomy: HTTP ${res.status}`)
    }
    const text = await res.text()
    const nodes = parseTaxonomy(text)

    for (const [key, node] of nodes) {
      const result = nearestCategory(key, nodes)
      if (!result) {
        stats.unmapped = (stats.unmapped ?? 0) + 1
        continue
      }
      stats[result.category] = (stats[result.category] ?? 0) + 1
      for (const lang of ["de", "en"]) {
        for (const term of node.langTerms.get(lang) ?? []) {
          const cleaned = cleanTerm(term)
          if (!cleaned) continue
          const existing = keywordDepth.get(cleaned)
          if (!existing || result.depth < existing.depth) {
            keywordDepth.set(cleaned, result)
          }
        }
      }
    }
  }

  const sortedKeywords = [...keywordDepth.keys()].sort()
  const output: Record<string, Category> = {}
  for (const keyword of sortedKeywords) {
    output[keyword] = keywordDepth.get(keyword)!.category
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 0) + "\n")

  console.log(`Wrote ${sortedKeywords.length} keywords to ${OUTPUT_PATH}`)
  console.log("Nodes without a mapping:", stats.unmapped ?? 0)
  for (const [category, count] of Object.entries(stats)) {
    if (category !== "unmapped") console.log(`  ${category}: ${count}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
