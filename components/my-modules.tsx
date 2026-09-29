"use client";

import { useActionState } from "react";
import { setModuleHidden, type HiddenState } from "../app/profile/actions";
import { modulesOn, type ModuleView } from "../lib/modules";
import { Switch } from "./switch";
import styles from "./account-menu.module.css";

const initialState: HiddenState = {};

// REQ-143: in your own Settings, a switch for each module that's on for
// the household. Off hides it from your navigation and Home cards only;
// its action items and pushes still reach you.
export function MyModules({ view }: { view: ModuleView }) {
  return (
    <section aria-labelledby="my-modules">
      <h3 id="my-modules" className={styles.heading}>
        Modules I see
      </h3>
      <ul className={styles.switches}>
        {modulesOn(view).map((module) => (
          <li key={module.slug} className={styles.switchRow}>
            {module.name}
            <HideForm slug={module.slug} name={module.name} shown={!view.hidden.includes(module.slug)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HideForm({ slug, name, shown: shownNow }: { slug: string; name: string; shown: boolean }) {
  const [state, formAction, pending] = useActionState(setModuleHidden, initialState);
  const shown = state.hidden === undefined ? shownNow : !state.hidden;
  return (
    <form action={formAction}>
      <input type="hidden" name="module" value={slug} />
      <input type="hidden" name="hidden" value={shown ? "true" : "false"} />
      <Switch type="submit" on={shown} label={`Show ${name}`} busy={pending} />
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
