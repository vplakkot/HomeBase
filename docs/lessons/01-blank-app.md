# Lesson 01: The blank app skeleton

This is the smallest possible Next.js app: one page that says "HomeBase,"
nothing else. This doc explains what every file and folder is for, and what
actually happens between typing `npm run dev` and seeing the page.

## The folders and files

**`app/`**
This is where the app's pages live. Next.js looks at the folder structure
inside `app/` and turns it directly into URLs — this is called the "App
Router." Right now there's only one page, so there's only one URL (`/`).

- `app/layout.tsx` — the shared wrapper around every page. Next.js requires
  at least one of these at the top level. It renders the outer `<html>` and
  `<body>` tags once; every page gets inserted inside it as `children`. If
  we add a second page later, both pages would share this same wrapper —
  useful for things like a shared header, but right now it's just the bare
  minimum HTML shell.
- `app/page.tsx` — the actual homepage. In the App Router, a file literally
  named `page.tsx` inside a folder is what makes that folder's URL
  renderable. Since it's directly inside `app/`, it becomes the homepage
  (`/`). It's a React "Server Component" by default, meaning it runs on the
  server and sends finished HTML to the browser — there's no client-side
  JavaScript needed just to show "HomeBase."
- `app/page.test.tsx` — a test for that page. It lives next to the file it
  tests, which is a common convention: easy to find, easy to keep in sync.

**`docs/lessons/`**
Not read by any tool — this is just where we write down what we learned
after finishing a piece of work, in plain language, for future reference.

**Config files at the root:**

- `package.json` — the app's identity card. Lists its name, the dependencies
  it needs (Next.js, React), the dev-only tools (TypeScript, Vitest), and
  the shortcut commands (`npm run dev`, `npm run build`, `npm test`).
- `package-lock.json` — records the *exact* version of every package
  actually installed (including packages our dependencies depend on). This
  is what makes `npm install` reproducible on another machine.
- `tsconfig.json` — settings for TypeScript, the typed version of
  JavaScript this project is written in. It tells the TypeScript checker
  which files to look at and how strictly to check them. Next.js edits a
  couple of fields in here automatically the first time you build.
- `next.config.ts` — settings for Next.js itself. It's empty right now
  (just the required boilerplate) because this app doesn't need anything
  special yet.
- `next-env.d.ts` — a small file Next.js generates and manages on its own
  so TypeScript knows about Next-specific types. Nobody edits this by hand,
  which is why it's listed in `.gitignore`.
- `vitest.config.ts` — settings for Vitest, the test runner. It tells
  Vitest two things: use a fake browser environment called `jsdom` (so
  tests can render HTML without an actual browser), and use the React
  plugin (so it understands the `.tsx` JSX syntax in our components).
- `.gitignore` — tells git which files/folders to never track, mainly
  generated output (`node_modules`, `.next`, build artifacts) that gets
  recreated automatically and would just bloat the repo.

## What happens when the homepage loads

1. `npm run dev` starts a local Next.js server on your machine
   (`http://localhost:3000`).
2. A browser requests `/`. Next.js looks in `app/` for a matching route,
   finds `app/page.tsx`, and runs it — on the server, not in the browser.
3. That function returns a small piece of markup (`<h1>HomeBase</h1>`).
   Next.js wraps it inside `app/layout.tsx`'s `<html>`/`<body>` shell.
4. The server sends the browser plain, already-rendered HTML — the page
   shows "HomeBase" immediately, before any JavaScript has even run.
5. Because there's no interactivity (no buttons, no state) this app never
   needs to send JavaScript to the browser for the page itself. That's the
   advantage of a Server Component: less code shipped, faster first paint.

## What the test checks

`app/page.test.tsx` renders `HomePage` in Vitest's fake browser (`jsdom`)
and asserts the text "HomeBase" appears — the same thing a person would
visually confirm by opening the site.
