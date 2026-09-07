import { categorizeIngredient } from "@/utils/categorize"
import { Category } from "@/constants/Categories"

describe("categorizeIngredient", () => {
  describe("basic cases, one per category, German and English", () => {
    const cases: [string, Category][] = [
      ["Banane", Category.FRUIT_VEGETABLES],
      ["banana", Category.FRUIT_VEGETABLES],
      ["Vollmilch", Category.DAIRY_CHEESE],
      ["milk", Category.DAIRY_CHEESE],
      ["Hackfleisch", Category.MEAT_FISH],
      ["chicken breast", Category.MEAT_FISH],
      ["Baguette", Category.BREAD_BAKERY],
      ["bread", Category.BREAD_BAKERY],
      ["Mineralwasser", Category.DRINKS],
      ["coffee", Category.DRINKS],
      ["Haribo", Category.SWEETS_SNACKS],
      ["chocolate", Category.SWEETS_SNACKS],
      ["Tiefkühlpizza", Category.FROZEN],
      ["frozen pizza", Category.FROZEN],
      ["Spaghetti", Category.PANTRY],
      ["rice", Category.PANTRY],
      ["Klopapier", Category.HOUSEHOLD],
      ["toilet paper", Category.HOUSEHOLD],
      ["Zahnpasta", Category.PERSONAL_CARE],
      ["toothpaste", Category.PERSONAL_CARE],
      ["Katzenfutter", Category.PET_SUPPLIES],
      ["cat food", Category.PET_SUPPLIES],
    ]

    it.each(cases)("%s -> %s", (name, expected) => {
      expect(categorizeIngredient(name)).toBe(expected)
    })
  })

  describe("German compounds resolve via their base word", () => {
    const cases: [string, Category][] = [
      ["Bio Vollmilch 3,5%", Category.DAIRY_CHEESE],
      ["6 Eier Freiland", Category.DAIRY_CHEESE],
      ["Rinderhackfleisch", Category.MEAT_FISH],
      ["Spülmaschinentabs", Category.HOUSEHOLD],
      ["Vollkorntoast", Category.BREAD_BAKERY],
      ["Apfelschorle 1,5l", Category.DRINKS],
      ["Zahnbürsten 2er", Category.PERSONAL_CARE],
      ["Sonnenblumenöl", Category.PANTRY],
      ["Weintrauben kernlos", Category.FRUIT_VEGETABLES],
      ["2 Liter Milch", Category.DAIRY_CHEESE],
    ]

    it.each(cases)("%s -> %s", (name, expected) => {
      expect(categorizeIngredient(name)).toBe(expected)
    })
  })

  describe("longest matching keyword wins over a shorter false match", () => {
    const cases: [string, Category, string][] = [
      ["Preiselbeeren", Category.FRUIT_VEGETABLES, "not pantry via 'reis'"],
      ["Fleisch", Category.MEAT_FISH, "not frozen via 'eis'"],
      ["Apfelsaft", Category.DRINKS, "not fruit via 'apfel'"],
      ["Mayonnaise", Category.PANTRY, "not frozen via 'eis'"],
    ]

    it.each(cases)("%s -> %s (%s)", (name, expected) => {
      expect(categorizeIngredient(name)).toBe(expected)
    })
  })

  describe("curated table takes precedence over the generated fallback", () => {
    // TK-Erbsen must resolve via the curated "tk-" -> FROZEN keyword, not
    // via a longer keyword the generated table might have for "erbsen"
    // (peas) under Fruit & Vegetables. This is the regression guard for the
    // bug that made a naive single-tier merge score worse than the curated
    // table alone (93% vs. 95% on the benchmark corpus).
    it("TK-Erbsen -> Frozen, not Fruit & Vegetables", () => {
      expect(categorizeIngredient("TK-Erbsen")).toBe(Category.FROZEN)
    })
  })

  describe("generated fallback covers terms the curated table doesn't know", () => {
    const cases: [string, Category][] = [
      ["Halloumi", Category.DAIRY_CHEESE],
      ["Wolfsbarsch", Category.MEAT_FISH],
      ["Bulgur", Category.PANTRY],
      ["Ciabatta", Category.BREAD_BAKERY],
    ]

    it.each(cases)("%s -> %s", (name, expected) => {
      expect(categorizeIngredient(name)).toBe(expected)
    })
  })

  describe("fallback behaviour", () => {
    it("returns OTHER for an unrecognized name", () => {
      expect(categorizeIngredient("Xyzzyzzq")).toBe(Category.OTHER)
    })

    it("returns OTHER for an empty string", () => {
      expect(categorizeIngredient("")).toBe(Category.OTHER)
    })

    it("returns OTHER for whitespace only", () => {
      expect(categorizeIngredient("   ")).toBe(Category.OTHER)
    })

    it("returns OTHER for an emoji", () => {
      expect(categorizeIngredient("🍕")).toBe(Category.OTHER)
    })

    it("returns OTHER for a bare number", () => {
      expect(categorizeIngredient("12345")).toBe(Category.OTHER)
    })

    it("is case-insensitive", () => {
      expect(categorizeIngredient("BANANE")).toBe(Category.FRUIT_VEGETABLES)
      expect(categorizeIngredient("banane")).toBe(Category.FRUIT_VEGETABLES)
    })
  })
})
