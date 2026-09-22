"use client";

import { useState } from "react";
import { BottomSheet } from "../../components/bottom-sheet";
import { PlusIcon } from "../../components/icons";
import { CreateMemberForm } from "./create-member-form";
import styles from "./page.module.css";

// "Add person" in the People card's corner (docs/design/DESIGN.md §8). It
// opens the create-member form in a sheet, so the card stays a list.
export function AddPerson() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.button} onClick={() => setOpen(true)}>
        <PlusIcon />
        Add person
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Add person">
        <CreateMemberForm />
      </BottomSheet>
    </>
  );
}
