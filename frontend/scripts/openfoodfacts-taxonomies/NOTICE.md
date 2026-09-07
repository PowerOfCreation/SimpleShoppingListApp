# Open Food Facts taxonomies

These 4 files are vendored, unmodified, from the `openfoodfacts-server`
repository's `taxonomies/` folder:

- `food-categories.txt`
- `beauty-categories.txt`
- `petfood-categories.txt`
- `product-categories.txt`

Source: https://github.com/openfoodfacts/openfoodfacts-server/tree/main/taxonomies
Retrieved: 2026-09-07

## License

The Open Food Facts database is available under the **Open Database
License (ODbL)**; individual contents under the **Database Contents
License (DbCL)**. See https://world.openfoodfacts.org/data and
https://opendatacommons.org/licenses/odbl/.

Reuse requires attribution to Open Food Facts with a link to
https://openfoodfacts.org, and derivative works must be shared under the
same license. This project's attribution lives in the About screen
(`app/(about)/index.tsx`); the derivative produced from these files
(`constants/category-keywords.generated.json`) is committed to this
public, open-source repository, satisfying share-alike.

Note: the `openfoodfacts-server` code itself (the Perl/JS application) is
AGPL-licensed - that license applies to the server software, not to the
taxonomy data files, which OFF publishes as open data under ODbL/DbCL.

## Regenerating

`scripts/build-category-keywords.ts` reads these files locally - no
network access needed to build `category-keywords.generated.json`. To
refresh from upstream (new categories, new synonyms), re-download the 4
URLs above, replace these files, update "Retrieved" here, and re-run the
build script.
