"use client";

import { useActionState, useCallback, useState } from "react";
import { BottomSheet } from "../../components/bottom-sheet";
import { buttonClass } from "../../components/button";
import cards from "../../components/cards.module.css";
import { answerGoAgain, markTried, setBookingLink, undoTried, type FormState } from "./actions";
import styles from "./restaurants.module.css";

function Problem({ state }: { state: FormState }) {
  return state.error ? (
    <p role="alert" className={cards.error}>
      {state.error}
    </p>
  ) : null;
}

// REQ-133: one tap moves it to Been to with today's date.
export function MarkTried({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(markTried, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? "Marking…" : "Mark as tried"}
      </button>
      <Problem state={state} />
    </form>
  );
}

// REQ-133: marked tried by mistake. It clears both answers, so it asks.
export function UndoTried({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const keep = useCallback(() => setOpen(false), []);
  const [state, formAction, pending] = useActionState<FormState, FormData>(undoTried, {});
  return (
    <>
      <button type="button" className={cards.quiet} onClick={() => setOpen(true)}>
        Undo tried
      </button>
      <BottomSheet open={open} onClose={keep} title={`Undo tried`}>
        {open ? (
          <form action={formAction} className={cards.form}>
            <input type="hidden" name="id" value={id} />
            <p className={cards.check}>Put {name} back on Want to try? Both go-again answers are cleared.</p>
            <div className={cards.actions}>
              <button type="submit" className={cards.primary} disabled={pending}>
                {pending ? "Undoing…" : "Yes, undo it"}
              </button>
              <button type="button" className={cards.quiet} onClick={keep}>
                Keep it tried
              </button>
            </div>
            <Problem state={state} />
          </form>
        ) : null}
      </BottomSheet>
    </>
  );
}

// REQ-133: Yes or No, your own only; the one you gave is pressed, and
// either can be tapped again later to change it.
export function GoAgain({ id, answer, label }: { id: string; answer: boolean | null; label: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(answerGoAgain, {});
  return (
    <form action={formAction} className={styles.goAgain} aria-label={label}>
      <input type="hidden" name="id" value={id} />
      {(["yes", "no"] as const).map((value) => {
        const chosen = answer === (value === "yes");
        return (
          <button
            key={value}
            type="submit"
            name="goAgain"
            value={value}
            className={chosen ? cards.primary : cards.quiet}
            aria-pressed={answer === null ? undefined : chosen}
            disabled={pending}
          >
            {value === "yes" ? "Yes" : "No"}
          </button>
        );
      })}
      <Problem state={state} />
    </form>
  );
}

// REQ-132: add, change or clear the booking link by pasting a web address.
export function BookingLink({ id, current }: { id: string; current: string | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [state, formAction, pending] = useActionState<FormState, FormData>(setBookingLink, {});
  const title = current ? "Change booking link" : "Add booking link";
  return (
    <>
      <button type="button" className={cards.quiet} onClick={() => setOpen(true)}>
        {current ? "Change" : "Add booking link"}
      </button>
      <BottomSheet open={open} onClose={close} title={title}>
        {open ? (
          <form action={formAction} className={cards.form}>
            <input type="hidden" name="id" value={id} />
            <label className={cards.field}>
              <span>OpenTable, Resy, Tock or the place&apos;s own booking page</span>
              <input
                name="bookingUrl"
                type="url"
                inputMode="url"
                autoComplete="off"
                defaultValue={current ?? ""}
                placeholder="https://"
              />
            </label>
            {current ? <p className={cards.hint}>Leave it empty to remove the link.</p> : null}
            <div className={cards.actions}>
              <button type="submit" className={cards.primary} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" className={cards.quiet} onClick={close}>
                Cancel
              </button>
            </div>
            <Problem state={state} />
          </form>
        ) : null}
      </BottomSheet>
    </>
  );
}
