import type { Metadata, Viewport } from "next";
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
  // Every icon link is listed here. Once a layout lists icons itself,
  // Next.js stops linking the icon files kept in app/ (a browser check
  // found app/icon.svg unlinked), so they all live in public/, made by
  // scripts/export-icons.sh.
  icons: {
    // The browser tab: the design's own file, and an .ico holding the
    // same icon at 16, 32 and 48 pixels for browsers that can't show SVG.
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

// "cover" lets pages reach the very edges of a phone screen. The app
// frame keeps its content clear of the rounded corners, the notch and the
// home bar using the screen's safe-area insets. Not yet checked on an
// iPhone.
export const viewport: Viewport = {
  viewportFit: "cover",
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
