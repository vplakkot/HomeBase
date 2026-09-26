"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BottomSheet } from "../../components/bottom-sheet";
import { buttonClass } from "../../components/button";
import { ChevronDownIcon } from "../../components/icons";
import type { Drink, Rating } from "../../lib/drinks/drinks";
import { RateForm, RemoveDrinkForm } from "./forms";
import styles from "./drinks.module.css";

// REQ-29: Rate opens a sheet with your own stars and comment filled in if
// you've rated it before. Available any time after the drink is saved.
export function RateButton({ drinkId, rating }: { drinkId: string; rating: Rating | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
        {rating ? "Change my rating" : "Rate"}
      </button>
      <BottomSheet open={open} onClose={close} title={rating ? "Change my rating" : "Rate it"}>
        {open ? <RateForm drinkId={drinkId} rating={rating} onSaved={close} /> : null}
      </BottomSheet>
    </>
  );
}

// Changing or removing a drink lives behind one menu, like Storage's.
export function ManageDrink({ drink }: { drink: Drink }) {
  const [menu, setMenu] = useState(false);
  const [removing, setRemoving] = useState(false);
  const keep = useCallback(() => setRemoving(false), []);
  return (
    <>
      <button
        type="button"
        className={buttonClass}
        aria-expanded={menu}
        aria-controls="manage-drink"
        onClick={() => setMenu((now) => !now)}
      >
        Manage
        <ChevronDownIcon />
      </button>
      {menu ? (
        <ul id="manage-drink" className={styles.menu} aria-label="Manage">
          <li>
            <Link href={`/drinks/${drink.id}/edit`} className={`${styles.menuItem} ${styles.menuLink}`}>
              Edit
            </Link>
          </li>
          <li className={styles.divider} aria-hidden="true" />
          <li>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setMenu(false);
                setRemoving(true);
              }}
            >
              Remove
            </button>
          </li>
        </ul>
      ) : null}
      <BottomSheet open={removing} onClose={keep} title={`Remove ${drink.name}`}>
        {removing ? <RemoveDrinkForm drink={drink} onKeep={keep} /> : null}
      </BottomSheet>
    </>
  );
}
