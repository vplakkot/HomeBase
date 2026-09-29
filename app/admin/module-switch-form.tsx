"use client";

import { useActionState, useState } from "react";
import { BottomSheet } from "../../components/bottom-sheet";
import cards from "../../components/cards.module.css";
import { Switch } from "../../components/switch";
import { setModuleOn, type ModuleSwitchState } from "./actions";

const initialState: ModuleSwitchState = {};

// One of the Modules card's switches (REQ-141). Turning a module on
// happens at once; turning it off asks first, since it disappears for
// everyone. Either way nothing is deleted.
export function ModuleSwitchForm({ moduleKey, name, on: onNow }: { moduleKey: string; name: string; on: boolean }) {
  const [state, formAction, pending] = useActionState(setModuleOn, initialState);
  const [asking, setAsking] = useState(false);
  // Once this form has written something, its own answer wins, as with
  // the notifications switch.
  const on = state.on ?? onNow;
  const label = `${name} module`;

  return (
    <>
      {on ? (
        <Switch on label={label} busy={pending} onClick={() => setAsking(true)} />
      ) : (
        <form action={formAction}>
          <input type="hidden" name="module" value={moduleKey} />
          <input type="hidden" name="on" value="true" />
          <Switch type="submit" on={false} label={label} busy={pending} />
        </form>
      )}
      <BottomSheet open={asking} onClose={() => setAsking(false)} title={`Turn off ${name}`}>
        {asking ? (
          <form action={formAction} onSubmit={() => setAsking(false)} className={cards.form}>
            <input type="hidden" name="module" value={moduleKey} />
            <input type="hidden" name="on" value="false" />
            <p className={cards.check}>
              Hide {name} for everyone? Nothing is deleted, and turning it back on brings it all back.
            </p>
            <div className={cards.actions}>
              <button type="submit" className={cards.primary}>
                Yes, turn it off
              </button>
              <button type="button" className={cards.quiet} onClick={() => setAsking(false)}>
                Keep it on
              </button>
            </div>
          </form>
        ) : null}
      </BottomSheet>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </>
  );
}
