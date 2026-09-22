import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { AppFrame } from "../../components/app-frame";
import { ChevronLeftIcon } from "../../components/icons";
import { Switch } from "../../components/switch";
import { MODULES, moduleColours } from "../../lib/modules";
import { readAccount } from "../../lib/account";
import { listMembers, listRoles } from "../../lib/auth/members";
import { listRecentLog, SHOW_DAYS } from "../../lib/notifications/log";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";
import { AddPerson } from "./add-person";
import { NotificationLog } from "./notification-log";
import { NotificationsForm } from "./notifications-form";
import { ResetPasswordForm } from "./reset-password-form";
import { SendTestForm } from "./send-test-form";
import { RoleForm } from "./role-form";
import styles from "./page.module.css";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect("/sign-in");
  }
  if (!(await hasPermission(supabase, "manage_members"))) {
    redirect("/");
  }

  const [members, roles, account] = await Promise.all([
    listMembers(supabase),
    listRoles(supabase),
    readAccount(data.claims),
  ]);
  // Read separately, and forgiven if it fails. The log is the least
  // important thing on this page; losing it must not take member
  // management down with it.
  let log = null;
  try {
    log = await listRecentLog(supabase);
  } catch (reason) {
    console.error(
      "Could not read the notification log",
      reason instanceof Error ? reason.message : reason,
    );
  }
  const names = new Map(
    members.map((member) => [member.user_id, member.name ?? member.email]),
  );

  // Only admins get this far, so the sidebar offers the console too. On a
  // phone there's no bar at the bottom here; the way back is at the top.
  //
  // The three cards of DESIGN.md §8: Notifications, Modules, People on a
  // phone; People and Notifications beside Modules on a desktop. v0.1's
  // working controls keep working inside them. The designed controls that
  // have nothing behind them yet (module switches, a test per person) are
  // shown but can't be pressed. The notification log isn't in the design;
  // it stays below the cards while v0.1's notifications are being proven.
  const initial = (text: string) => text.trim().charAt(0).toUpperCase();
  const person = (member: (typeof members)[number]) => (
    <>
      <span className={styles.avatar} aria-hidden="true">
        {initial(member.name ?? member.email)}
      </span>
      <span className={styles.who}>
        <span className={styles.rowName}>{member.name ?? member.email}</span>
        <span className={styles.rowNote}>
          {member.email}
          {member.user_id === data.claims.sub ? " · you" : ""}
        </span>
      </span>
    </>
  );

  return (
    <AppFrame current="admin" canAdminister account={account}>
      <Link href="/" className={styles.back}>
        <ChevronLeftIcon />
        Home
      </Link>
      <div className={styles.intro}>
        <h1 className={styles.title}>Admin console</h1>
        <p className={styles.lede}>Household settings. Only admins can see this page.</p>
      </div>

      <div className={styles.cards}>
        <section className={`${styles.card} ${styles.people}`} aria-labelledby="people-heading">
          <div className={styles.cardHead}>
            <div>
              <h2 id="people-heading" className={styles.cardTitle}>
                People
              </h2>
              <p className={styles.cardNote}>Who is in this household</p>
            </div>
            <AddPerson />
          </div>
          <ul className={styles.rows}>
            {members.map((member) => {
              const who = member.name ?? member.email;
              return (
                <li key={member.user_id} className={styles.row}>
                  <div className={styles.rowMain}>
                    {person(member)}
                    <span className={styles.chip}>{member.role_name}</span>
                  </div>
                  <details className={styles.manage}>
                    <summary>Change role or reset password</summary>
                    <RoleForm
                      userId={member.user_id}
                      roleId={member.role_id}
                      roles={roles}
                      label={`Role for ${who}`}
                    />
                    <ResetPasswordForm
                      userId={member.user_id}
                      label={`Temporary password for ${who}`}
                    />
                  </details>
                </li>
              );
            })}
          </ul>
          <p className={styles.cardFoot}>Adding people is a setup step. Most households do it once.</p>
        </section>

        <section
          className={`${styles.card} ${styles.notifications}`}
          aria-labelledby="notifications-heading"
        >
          <div className={styles.cardHead}>
            <div>
              <h2 id="notifications-heading" className={styles.cardTitle}>
                Notifications
              </h2>
              <p className={styles.cardNote}>Push alerts to each person&apos;s phone</p>
            </div>
          </div>
          <ul className={styles.rows}>
            {members.map((member) => (
              <li key={member.user_id} className={styles.row}>
                <div className={styles.rowMain}>
                  {person(member)}
                  <button type="button" className={styles.button} disabled title="Coming soon">
                    Send test
                  </button>
                  <NotificationsForm
                    userId={member.user_id}
                    enabled={member.notifications_enabled}
                    label={`Notifications for ${member.name ?? member.email}`}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.cardFoot}>
            <p>
              A test for one person is coming soon. For now, a test goes to every
              device of every member whose switch is on, the same as the hourly one.
            </p>
            <SendTestForm />
            <p>Notifications never show dollar amounts on the lock screen.</p>
          </div>
        </section>

        <section className={`${styles.card} ${styles.modules}`} aria-labelledby="modules-heading">
          <div className={styles.cardHead}>
            <div>
              <h2 id="modules-heading" className={styles.cardTitle}>
                Modules
              </h2>
              <p className={styles.cardNote}>Turn modules on or off for the household</p>
            </div>
          </div>
          <ul className={styles.rows}>
            {MODULES.map((module) => (
              <li
                key={module.slug}
                className={styles.row}
                style={moduleColours(module) as CSSProperties}
              >
                <div className={styles.rowMain}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.who}>
                    <span className={styles.rowName}>{module.name}</span>
                    <span className={styles.rowNote}>Visible to everyone</span>
                  </span>
                  <Switch on label={`${module.name} module`} disabled />
                </div>
              </li>
            ))}
          </ul>
          <p className={styles.cardFoot}>
            Turning a module off will hide it from Home and the sidebar, and
            delete nothing. The switches are coming soon.
          </p>
        </section>
      </div>

      <section className={styles.card} aria-labelledby="notification-log-heading">
        <div className={styles.cardHead}>
          <div>
            <h2 id="notification-log-heading" className={styles.cardTitle}>
              Notification log
            </h2>
            <p className={styles.cardNote}>
              The last {SHOW_DAYS} days. A send counts as missing once five
              minutes have passed with no word from the device. Entries older
              than 30 days are deleted on their own.
            </p>
          </div>
        </div>
        <div className={styles.log}>
          <NotificationLog rows={log} names={names} now={Date.now()} />
        </div>
      </section>
    </AppFrame>
  );
}
