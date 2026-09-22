import type { ReactNode } from "react";
import type { Account } from "../lib/account";
import { Sidebar, type Place } from "./sidebar";
import styles from "./app-frame.module.css";

// The frame every signed-in page sits in (docs/design/DESIGN.md §4, §6).
// Below 1024 px it's a phone screen: the page scrolls, and `phoneBar`, if
// the page has one, stays fixed at the bottom. From 1024 px it's a desktop
// screen: the sidebar on the left, the page beside it. Both layouts are in
// the page at once and the screen width picks one, so resizing a window
// switches between them on the spot.
export function AppFrame({
  current,
  canAdminister,
  account,
  phoneBar,
  children,
}: {
  current: Place;
  canAdminister: boolean;
  account: Account;
  phoneBar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.frame}>
      <Sidebar current={current} canAdminister={canAdminister} account={account} />
      <div className={styles.column}>
        <main className={styles.main}>{children}</main>
        {phoneBar ? <div className={styles.phoneBar}>{phoneBar}</div> : null}
      </div>
    </div>
  );
}
