"use client";

import Link from "next/link";
import { SearchIcon } from "../../components/icons";
import { COOK_TIMES, SORTS, type LibraryQuery } from "../../lib/meal-plans/library";
import { COOKING_METHODS, MAIN_MEATS } from "../../lib/meal-plans/recipes";
import styles from "./meal-plans.module.css";

// REQ-114: the library's search, filters and sort are one form, so
// changing one keeps the others. A dropdown applies as soon as it changes.
const FORM = "recipe-library";
const HERE = "/meal-plans/recipes";

export function LibrarySearch({ query }: { query: LibraryQuery }) {
  return (
    <form id={FORM} method="get" action={HERE} role="search" className={styles.search}>
      <SearchIcon />
      <label htmlFor="recipe-search" className={styles.hidden}>
        Search recipes
      </label>
      <input id="recipe-search" type="search" name="q" defaultValue={query.q ?? ""} placeholder="Search by name" />
      {query.hidden === "yes" ? <input type="hidden" name="hidden" value="yes" /> : null}
      {query.q ? (
        <Link href={query.hidden === "yes" ? `${HERE}?hidden=yes` : HERE} className={styles.clear}>
          Clear
        </Link>
      ) : null}
    </form>
  );
}

export function LibraryFilters({ query, cuisines }: { query: LibraryQuery; cuisines: readonly string[] }) {
  const submit = (event: React.ChangeEvent<HTMLSelectElement>) => event.currentTarget.form?.requestSubmit();
  const select = (label: string, name: keyof LibraryQuery, all: string, options: readonly { value: string; label: string }[]) => (
    <label className={styles.control}>
      <span>{label}</span>
      <select name={name} form={FORM} defaultValue={query[name] ?? ""} onChange={submit}>
        {all ? <option value="">{all}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
  const plain = (values: readonly string[]) => values.map((value) => ({ value, label: value }));
  return (
    <div className={styles.controls}>
      {select("Cuisine", "cuisine", "Any cuisine", plain(cuisines))}
      {select("Main meat", "meat", "Any meat", plain(MAIN_MEATS))}
      {select("Method", "method", "Any method", plain(COOKING_METHODS))}
      {select("Cook time", "time", "Any time", COOK_TIMES)}
      {select("Sort", "sort", "", SORTS)}
    </div>
  );
}
