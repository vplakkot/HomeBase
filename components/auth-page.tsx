import type { ReactNode } from "react";
import styles from "./auth-page.module.css";

// The page around sign-in, sign-up and set-password (REQ-86, from the
// sketch Vin approved on 2026-09-22; there's no mockup): the app icon, the
// name in the display font, then the page's own heading and form, in one
// centred column on a phone and a desktop alike. The fields are 52 px
// tall with 16 px text: iPhones are known to zoom in on a field whose
// text is smaller than 16 px. Not yet checked on an iPhone.
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <div className={styles.brand}>
          {/* The name below says what this is. */}
          <img src="/icon.svg" alt="" width={72} height={72} />
          <p className={styles.name}>HomeBase</p>
        </div>
        {children}
      </div>
    </main>
  );
}
