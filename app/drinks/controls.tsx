"use client";

import Link from "next/link";
import { SearchIcon } from "../../components/icons";
import type { Person } from "../../lib/drinks/drinks";
import { DRINK_TYPES, TYPE_NAMES } from "../../lib/drinks/lists";
import styles from "./drinks.module.css";

// The list's search, filter and sort are one form (REQ-30), so whichever
// is changed keeps the other two. The search sits in the header; the
// type and sort dropdowns sit under it and join the same form by its id.
const FORM = "drink-list";

export function SearchBox({ query }: { query: string }) {
  return (
    <form id={FORM} method="get" action="/drinks" role="search" className={styles.search}>
      <SearchIcon />
      <label htmlFor="drinks-search" className={styles.hidden}>
        Search drinks
      </label>
      <input
        id="drinks-search"
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Search producer, name, grape, region, comments"
      />
      {query ? (
        <Link href="/drinks" className={styles.clear}>
          Clear
        </Link>
      ) : null}
    </form>
  );
}

// Changing a dropdown applies it straight away: no Apply button to reach
// for with the thumb.
export function ListControls({ type, sort, people }: { type: string; sort: string; people: readonly Person[] }) {
  const submit = (event: React.ChangeEvent<HTMLSelectElement>) => event.currentTarget.form?.requestSubmit();
  return (
    <div className={styles.controls}>
      <label className={styles.control}>
        <span>Type</span>
        <select name="type" form={FORM} defaultValue={type} onChange={submit}>
          <option value="">All types</option>
          {DRINK_TYPES.map((value) => (
            <option key={value} value={value}>
              {TYPE_NAMES[value]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.control}>
        <span>Sort</span>
        <select name="sort" form={FORM} defaultValue={sort} onChange={submit}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          {people.map((person) => (
            <option key={person.user_id} value={`rating:${person.user_id}`}>
              {person.name}&apos;s rating
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
