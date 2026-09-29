import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import type { Account } from "../lib/account";
import { MODULES, isOn } from "../lib/modules";
import { RecipeToast } from "./recipe-toast";
import { Sidebar, type Place } from "./sidebar";
import styles from "./app-frame.module.css";

// The frame every signed-in page sits in (docs/design/DESIGN.md §4, §6).
// Below 1024 px it's a phone screen: the page scrolls, and `phoneBar`, if
// the page has one, stays fixed at the bottom. From 1024 px it's a desktop
// screen: the sidebar on the left, the page beside it. Both layouts are in
// the page at once and the screen width picks one, so resizing a window
// switches between them on the spot.
//
// Every module page sits in it, so this is where a module the household
// has turned off stops opening (REQ-141): a link to it, old or typed,
// lands on Home with a note instead. Hidden from your own view (REQ-143)
// still opens, so an action item can take you there.
export function AppFrame({
  current,
  canAdminister,
  account,
  phoneBar,
  style,
  children,
}: {
  current: Place;
  canAdminister: boolean;
  account: Account;
  phoneBar?: ReactNode;
  // A module's colour tokens, so everything on its page can use them.
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (MODULES.some((module) => module.slug === current) && !isOn(account.modules, current)) {
    redirect(`/?off=${current}`);
  }
  return (
    <div className={styles.frame}>
      <Sidebar current={current} canAdminister={canAdminister} account={account} />
      <div className={styles.column}>
        <main className={styles.main} style={style}>
          {children}
        </main>
        {phoneBar ? <div className={styles.phoneBar}>{phoneBar}</div> : null}
      </div>
      <RecipeToast />
    </div>
  );
}
