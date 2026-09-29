"use client";

import { useActionState } from "react";
import type { ModuleSwitch } from "../../../lib/modules";
import { chooseModules, type ChooseState } from "./actions";
import styles from "./setup.module.css";

const initialState: ChooseState = {};

// Every switch as a box, all ticked to start (REQ-142). Paperwork &
// Storage is one box, like the admin console's one switch.
export function ChooseForm({ switches }: { switches: readonly Pick<ModuleSwitch, "key" | "name">[] }) {
  const [state, formAction, pending] = useActionState(chooseModules, initialState);
  return (
    <form action={formAction}>
      <ul className={styles.list}>
        {switches.map((each) => (
          <li key={each.key}>
            <label className={styles.choice}>
              <input type="checkbox" name="module" value={each.key} defaultChecked />
              {each.name}
            </label>
          </li>
        ))}
      </ul>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Start using HomeBase"}
      </button>
    </form>
  );
}
