"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "../../components/button";
import { AddRecipe } from "./forms";
import styles from "./meal-plans.module.css";

// The two ways to fill in a Recipe missing card, side by side. Add details
// opens the form under them, full width.
export function MissingActions({ recipeId, name }: { recipeId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={styles.missingRow}>
        <Link href={`/meal-plans/${recipeId}/edit`} className={buttonClass}>
          Type it in
        </Link>
        <button type="button" className={buttonClass} aria-expanded={open} onClick={() => setOpen(!open)}>
          Add details
        </button>
      </div>
      {open ? (
        <div className={styles.missingForm}>
          <AddRecipe fill={{ id: recipeId, name }} />
        </div>
      ) : null}
    </>
  );
}
