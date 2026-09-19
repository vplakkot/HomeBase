// Browser-side questions about the device in front of us. Only client
// components call these; there is no service worker on the server.

export async function subscriptionOnThisDevice(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// Tell the push service to forget this device, so nothing can be delivered
// here afterwards. Best effort on purpose: signing out must never fail
// because of it, and the row is removed on the server either way.
export async function stopReceivingHere(): Promise<void> {
  try {
    const subscription = await subscriptionOnThisDevice();
    await subscription?.unsubscribe();
  } catch {
    // Nothing to do: the server still forgets the device.
  }
}
