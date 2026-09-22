"use client";

import { useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import { stopReceivingHere } from "../../lib/notifications/this-device";
import { signOut } from "./actions";

// Signing out ends notifications on this device: the push service is told
// to forget it here, and the server removes its row. Without JavaScript the
// form still signs out, and the row still goes; only the push service's own
// copy would linger, which nothing is left to send to.
export function SignOutForm({
  className,
  icon,
}: {
  className?: string;
  icon?: ReactNode;
} = {}) {
  const toldThePushService = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (toldThePushService.current) {
      return;
    }
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await stopReceivingHere();
    } catch {
      // Signing out never waits on the push service.
    }
    toldThePushService.current = true;
    form.requestSubmit();
  }

  return (
    <form action={signOut} onSubmit={handleSubmit}>
      <button type="submit" className={className}>
        {icon}
        Sign out
      </button>
    </form>
  );
}
