import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "HomeBase",
  // What an iPhone uses when the app is added to the home screen: the name
  // under the icon, the icon itself, and permission to open full screen.
  appleWebApp: {
    capable: true,
    title: "HomeBase",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
