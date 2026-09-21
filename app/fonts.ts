import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";

// The two typefaces from the design (docs/design/DESIGN.md §2).
//
// next/font downloads them from Google Fonts while the app is being built
// and serves them from HomeBase's own address, so opening the app never
// asks Google for anything. Each call publishes the font's name as a CSS
// variable, followed by a stand-in system font it has resized to match,
// so text doesn't jump when the real file arrives. docs/design/tokens.css
// reads those variables in --font-display and --font-body, and every
// stylesheet takes its fonts from those two tokens.
//
// next/font rewrites these calls while building, so the options have to
// be written out literally here rather than passed in from elsewhere.

// Display: titles, headlines, big numbers, always at weight 800. Loaded
// as the variable font with its optical-size axis, as the mockups were
// drawn: at large sizes the letters sit tighter and finer than the default
// cut. That costs 77 KB against 22 KB for one fixed weight, downloaded
// once and then kept by the browser.
export const displayFont = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-face-display",
});

// Body: everything else. One variable file covers weights 400 to 700.
export const bodyFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-face-body",
});
