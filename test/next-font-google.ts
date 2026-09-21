// A stand-in for next/font/google, used only by the tests
// (vitest.config.ts points that import here).
//
// next/font isn't an ordinary library. Next.js rewrites each font call
// while it builds the app, and the package itself is empty, so outside
// that build (in a test) every call fails with "is not a function". This
// hands back the same shape the real call does, with names a test can
// predict: the variable class is derived from the variable the call asked
// for, so a test can still see which one that was.

type FontOptions = { variable?: string };

function stubFont(family: string) {
  return (options: FontOptions = {}) => ({
    className: `stub-font-${family.replaceAll(" ", "-")}`,
    variable: options.variable ? `stub-variable${options.variable.slice(1)}` : "",
    style: { fontFamily: `'${family}'` },
  });
}

export const Bricolage_Grotesque = stubFont("Bricolage Grotesque");
export const Plus_Jakarta_Sans = stubFont("Plus Jakarta Sans");
