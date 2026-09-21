import styles from "./brand-lockup.module.css";

// The HomeBase mark and name together: top-left on phone Home and at the
// top of the desktop sidebar (docs/design/DESIGN.md §2). The mark is the
// same file the browser tab shows, app/icon.svg.
export function BrandLockup() {
  return (
    <span className={styles.lockup}>
      {/* The name beside it already says what this is, so a screen
          reader doesn't need the picture described as well. */}
      <img src="/icon.svg" alt="" width={30} height={30} />
      <span className={styles.name}>HomeBase</span>
    </span>
  );
}
