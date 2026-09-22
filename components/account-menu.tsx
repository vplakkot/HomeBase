"use client";

import Link from "next/link";
import { useState } from "react";
import type { Account } from "../lib/account";
import { EnableNotifications } from "../app/notifications/enable-notifications";
import { SignOutForm } from "../app/sign-out/sign-out-form";
import { BottomSheet } from "./bottom-sheet";
import { AdminConsoleIcon, PersonIcon, SettingsIcon, SignOutIcon } from "./icons";
import styles from "./account-menu.module.css";

// Everything about your own account in one place (REQ-85): Profile,
// Settings and Sign out. On a phone it's the pill at the top right of
// Home, which opens a menu; admins also find the admin console there. On a
// desktop the three sit at the bottom of the sidebar. Profile and Settings
// open sheets. Settings holds this device's notifications, which used to
// sit at the bottom of Home.

type Sheet = "menu" | "profile" | "settings" | null;

// Moving from the menu to Profile closes the menu's dialog, and a closing
// dialog reports it a moment later. So each sheet only closes itself; the
// menu's late report mustn't shut the Profile sheet that just opened.
function useSheets() {
  const [sheet, setSheet] = useState<Sheet>(null);
  const closeSheet = (which: Sheet) => setSheet((now) => (now === which ? null : now));
  return { sheet, setSheet, closeSheet };
}

function initial(account: Account): string {
  return (account.name ?? account.email ?? "?").trim().charAt(0).toUpperCase();
}

export function AccountPill({
  account,
  canAdminister,
}: {
  account: Account;
  canAdminister: boolean;
}) {
  const { sheet, setSheet, closeSheet } = useSheets();
  return (
    <>
      <button
        type="button"
        className={styles.pill}
        aria-haspopup="dialog"
        onClick={() => setSheet("menu")}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initial(account)}
        </span>
        {account.name?.split(/\s+/)[0] ?? "Account"}
      </button>
      <BottomSheet open={sheet === "menu"} onClose={() => closeSheet("menu")} title="Account">
        <ul className={styles.menu}>
          <li>
            <button type="button" className={styles.item} onClick={() => setSheet("profile")}>
              <PersonIcon />
              Profile
            </button>
          </li>
          <li>
            <button type="button" className={styles.item} onClick={() => setSheet("settings")}>
              <SettingsIcon />
              Settings
            </button>
          </li>
          {canAdminister ? (
            <li>
              <Link href="/admin" className={styles.item} onClick={() => closeSheet("menu")}>
                <AdminConsoleIcon />
                Admin console
              </Link>
            </li>
          ) : null}
          <li>
            <SignOutForm className={styles.item} icon={<SignOutIcon />} />
          </li>
        </ul>
      </BottomSheet>
      <AccountSheets account={account} sheet={sheet} onClose={closeSheet} />
    </>
  );
}

export function AccountButtons({ account, className }: { account: Account; className: string }) {
  const { sheet, setSheet, closeSheet } = useSheets();
  return (
    <>
      <button type="button" className={className} onClick={() => setSheet("profile")}>
        <PersonIcon />
        Profile
      </button>
      <button type="button" className={className} onClick={() => setSheet("settings")}>
        <SettingsIcon />
        Settings
      </button>
      <SignOutForm className={className} icon={<SignOutIcon />} />
      <AccountSheets account={account} sheet={sheet} onClose={closeSheet} />
    </>
  );
}

function AccountSheets({
  account,
  sheet,
  onClose,
}: {
  account: Account;
  sheet: Sheet;
  onClose: (which: Sheet) => void;
}) {
  return (
    <>
      <BottomSheet open={sheet === "profile"} onClose={() => onClose("profile")} title="Profile">
        <div className={styles.profile}>
          <span className={`${styles.avatar} ${styles.large}`} aria-hidden="true">
            {initial(account)}
          </span>
          <span className={styles.who}>
            <span className={styles.name}>{account.name ?? "No name yet"}</span>
            <span className={styles.note}>
              {account.email ? `Signed in as ${account.email}` : "Signed in"}
            </span>
          </span>
        </div>
      </BottomSheet>
      <BottomSheet open={sheet === "settings"} onClose={() => onClose("settings")} title="Settings">
        {/* Only while open: the control checks this device as it appears,
            and Home has this menu twice, the pill and the sidebar. */}
        {sheet === "settings" ? (
          <div className={styles.settings}>
            <EnableNotifications publicKey={account.publicKey} knownDevice={account.knownDevice} />
            <p data-testid="build-info" className={styles.note}>
              {account.build}
            </p>
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
