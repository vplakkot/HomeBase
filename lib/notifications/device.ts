// Which device this browser is, as far as notifications are concerned: the
// address its push service gave it. Saved when notifications are turned on,
// so signing out can end notifications for this device and no other. It
// holds nothing secret — the address is useless without the app's private
// key — but it's httpOnly so page scripts can't read or forge it.
export const DEVICE_COOKIE = "homebase-device";

export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 400 * 24 * 60 * 60,
  secure: process.env.NODE_ENV === "production",
} as const;
