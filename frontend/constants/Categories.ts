export const Category = {
  FRUIT_VEGETABLES: "fruit_vegetables",
  DAIRY_CHEESE: "dairy_cheese",
  MEAT_FISH: "meat_fish",
  BREAD_BAKERY: "bread_bakery",
  DRINKS: "drinks",
  SWEETS_SNACKS: "sweets_snacks",
  FROZEN: "frozen",
  PANTRY: "pantry",
  HOUSEHOLD: "household",
  PERSONAL_CARE: "personal_care",
  PET_SUPPLIES: "pet_supplies",
  OTHER: "other",
} as const

// eslint-disable-next-line @typescript-eslint/no-redeclare -- type/value namespace merge, not an actual redeclaration
export type Category = (typeof Category)[keyof typeof Category]

// Display order in the UI. OTHER is deliberately last so unclassified
// items sink to the bottom of a category-sorted list.
const CATEGORY_ORDER: Record<Category, number> = {
  [Category.FRUIT_VEGETABLES]: 0,
  [Category.DAIRY_CHEESE]: 1,
  [Category.MEAT_FISH]: 2,
  [Category.BREAD_BAKERY]: 3,
  [Category.DRINKS]: 4,
  [Category.SWEETS_SNACKS]: 5,
  [Category.FROZEN]: 6,
  [Category.PANTRY]: 7,
  [Category.HOUSEHOLD]: 8,
  [Category.PERSONAL_CARE]: 9,
  [Category.PET_SUPPLIES]: 10,
  [Category.OTHER]: 11,
}

export function categoryOrder(category: Category): number {
  return CATEGORY_ORDER[category]
}

export function formatCategory(category: Category): string {
  switch (category) {
    case Category.FRUIT_VEGETABLES:
      return "Fruit & Vegetables"
    case Category.DAIRY_CHEESE:
      return "Dairy & Cheese"
    case Category.MEAT_FISH:
      return "Meat & Fish"
    case Category.BREAD_BAKERY:
      return "Bread & Bakery"
    case Category.DRINKS:
      return "Drinks"
    case Category.SWEETS_SNACKS:
      return "Sweets & Snacks"
    case Category.FROZEN:
      return "Frozen"
    case Category.PANTRY:
      return "Pantry"
    case Category.HOUSEHOLD:
      return "Household"
    case Category.PERSONAL_CARE:
      return "Personal Care"
    case Category.PET_SUPPLIES:
      return "Pet Supplies"
    case Category.OTHER:
      return "Other"
  }
}
