"use client";

import Link from "next/link";
import type { PlaceFilter } from "../../lib/restaurants/filter";
import styles from "./restaurants.module.css";

// REQ-135: neighbourhood and cuisine, listing only what the page's places
// have. A dropdown applies as soon as it changes, keeping the other one;
// Clear goes back to every place.
export function PlaceFilters({
  here,
  filter,
  areas,
  cuisines,
}: {
  here: string;
  filter: PlaceFilter;
  areas: readonly string[];
  cuisines: readonly string[];
}) {
  const submit = (event: React.ChangeEvent<HTMLSelectElement>) => event.currentTarget.form?.requestSubmit();
  const select = (label: string, name: keyof PlaceFilter, any: string, options: readonly string[]) => (
    <label className={styles.control}>
      <span>{label}</span>
      <select name={name} defaultValue={filter[name] ?? ""} onChange={submit}>
        <option value="">{any}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
  // Keyed on the filter, so Clear resets the dropdowns as well as the list.
  return (
    <form key={`${filter.area ?? ""}|${filter.cuisine ?? ""}`} method="get" action={here} role="search" aria-label="Filter places" className={styles.filters}>
      <div className={styles.controls}>
        {select("Neighborhood", "area", "Any neighborhood", areas)}
        {select("Cuisine", "cuisine", "Any cuisine", cuisines)}
      </div>
      {filter.area || filter.cuisine ? (
        <Link href={here} className={styles.clear}>
          Clear
        </Link>
      ) : null}
    </form>
  );
}
