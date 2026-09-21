import type { Metadata } from "next";
import type { ReactNode } from "react";
// The design's colours, fonts, corner sizes and spacing, read straight
// from the design folder so the app and the design can't disagree. Then
// the base styles every page starts from, which are built out of them.
import "../docs/design/tokens.css";
import "./globals.css";
import { bodyFont, displayFont } from "./fonts";

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
    // The fonts' variables go on <html>, the element tokens.css calls
    // :root, because that's where --font-display and --font-body read
    // them. A CSS variable only reaches the element it's set on and what's
    // inside it. On <body>, both tokens would drop to the bare font names
    // in tokens.css and lose the resized stand-in that stops text jumping
    // while the fonts load.
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
