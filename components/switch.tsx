import styles from "./switch.module.css";

// An on/off switch (docs/design/DESIGN.md §9): a green track with the knob
// to the right when on, a grey one with it to the left when off. It's a
// button a screen reader announces as a switch and whether it's on. The
// button is taller than the track it draws, so it's easy to hit.
export function Switch({
  on,
  label,
  type = "button",
  disabled = false,
  busy = false,
}: {
  on: boolean;
  label: string;
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={styles.switch}
    >
      <span className={on ? `${styles.track} ${styles.on}` : styles.track}>
        <span className={styles.knob} />
      </span>
    </button>
  );
}
