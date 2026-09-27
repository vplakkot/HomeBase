"use client";

import { useActionState, useCallback, useState } from "react";
import { BottomSheet } from "../../components/bottom-sheet";
import { buttonClass } from "../../components/button";
import cards from "../../components/cards.module.css";
import { removePlace, type FormState } from "./actions";

// REQ-129: a place leaves Want to try only after a confirm.
export function RemovePlace({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const keep = useCallback(() => setOpen(false), []);
  const [state, formAction, pending] = useActionState<FormState, FormData>(removePlace, {});
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
        Remove
      </button>
      <BottomSheet open={open} onClose={keep} title={`Remove ${name}`}>
        {open ? (
          <form action={formAction} className={cards.form}>
            <input type="hidden" name="id" value={id} />
            <p className={cards.check}>Take {name} off Want to try?</p>
            <div className={cards.actions}>
              <button type="submit" className={cards.primary} disabled={pending}>
                {pending ? "Removing…" : "Yes, remove it"}
              </button>
              <button type="button" className={cards.quiet} onClick={keep}>
                Keep it
              </button>
            </div>
            {state.error ? (
              <p role="alert" className={cards.error}>
                {state.error}
              </p>
            ) : null}
          </form>
        ) : null}
      </BottomSheet>
    </>
  );
}
