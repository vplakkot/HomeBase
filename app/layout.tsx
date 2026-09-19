import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "HomeBase",
  // What an iPhone reads from each page when the app is added to the home
  // screen: the name under the icon and the icon itself. Opening full
  // screen comes from the app card (app/manifest.ts, display: standalone);
  // `capable` only adds the generic mobile-web-app-capable hint tag.
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
