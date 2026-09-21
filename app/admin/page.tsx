import Link from "next/link";
import { redirect } from "next/navigation";
import { AppFrame } from "../../components/app-frame";
import { ChevronLeftIcon } from "../../components/icons";
import { listMembers, listRoles } from "../../lib/auth/members";
import { listRecentLog, SHOW_DAYS } from "../../lib/notifications/log";
import { hasPermission } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";
import { CreateMemberForm } from "./create-member-form";
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

  const [members, roles] = await Promise.all([
    listMembers(supabase),
    listRoles(supabase),
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
  // phone there's no bar at the bottom here; the way back is at the top
  // (docs/design/DESIGN.md §8).
  return (
    <AppFrame current="admin" canAdminister>
      <Link href="/" className={styles.back}>
        <ChevronLeftIcon />
        Home
      </Link>
      <h1>Admin console</h1>
      <section aria-labelledby="members-heading">
        <h2 id="members-heading">Members</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Notifications</th>
              <th scope="col">Password</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const who = member.name ?? member.email;
              return (
                <tr key={member.user_id}>
                  <td>{member.name ?? "—"}</td>
                  <td>{member.email}</td>
                  <td>
                    <RoleForm
                      userId={member.user_id}
                      roleId={member.role_id}
                      roles={roles}
                      label={`Role for ${who}`}
                    />
                  </td>
                  <td>
                    <NotificationsForm
                      userId={member.user_id}
                      enabled={member.notifications_enabled}
                      label={`Notifications for ${who}`}
                    />
                  </td>
                  <td>
                    <ResetPasswordForm
                      userId={member.user_id}
                      label={`Temporary password for ${who}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3>Create a member account</h3>
        <CreateMemberForm />
      </section>
      <section aria-labelledby="test-notification-heading">
        <h2 id="test-notification-heading">Test notification</h2>
        <p>
          Goes to every device of every member whose switch is on, the same
          as the hourly one.
        </p>
        <SendTestForm />
      </section>
      <section aria-labelledby="notification-log-heading">
        <h2 id="notification-log-heading">Notification log</h2>
        <p>
          The last {SHOW_DAYS} days. A send counts as missing once five
          minutes have passed with no word from the device. Entries older
          than 30 days are deleted on their own.
        </p>
        <NotificationLog rows={log} names={names} now={Date.now()} />
      </section>
    </AppFrame>
  );
}
