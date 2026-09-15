"use client";

export default function SentryTestPage() {
  return (
    <div style={{ padding: "2rem" }}>
      <h1>Sentry test</h1>
      <p>
        These buttons deliberately throw errors, one in the browser and one
        on the server, to confirm Sentry is catching both. See{" "}
        <code>docs/lessons/05-sentry-error-tracking.md</code> for what
        should show up in Sentry, and a note on removing this page once
        you&rsquo;ve confirmed it works.
      </p>
      <button
        onClick={() => {
          throw new Error("Sentry test: deliberate client-side error");
        }}
      >
        Throw client error
      </button>{" "}
      <button
        onClick={() => {
          fetch("/api/sentry-test");
        }}
      >
        Throw server error
      </button>
    </div>
  );
}
