# Lesson 35: Emailed links

Until REQ-158 the app never sent an email. Accounts were made by an admin
with a temporary password, handed over in person. Changing an email
address and "I forgot my password" are different: the proof that you are
you is that you can open a message sent to the address.

## A link is a key left under the mat

A recovery email carries a one-time token. Whoever opens the link first
gets in, once. So the three rules are the same as for any key under a mat:

- **It works once and soon expires.** A used or old link goes to the
  sign-in page with a note, never an error page.
- **It opens one door.** `/auth/confirm` only knows two kinds of link
  (`recovery`, `email_change`) and goes to one of three fixed pages. It
  ignores anything else in the address, such as a `next=` pointing
  somewhere else, which is how links get turned into open redirects.
- **Asking for it reveals nothing.** "Forgot password" says the same thing
  for an address with no account, so the page can't be used to find out who
  is in the household.

## Why a token, not Supabase's own redirect

Supabase can redirect straight back with a code, but that code only works
in the browser that asked, and a phone's mail app opens links in Safari,
not the installed app. The token in our own link (`token_hash`) works in
whichever browser opens it. The cost is that each email template is edited
in the Supabase dashboard to point at `{{ .RedirectTo }}` plus the token.
That is a setting, not code, so it is written down in the pull request and
can be lost if the project is ever rebuilt.

## Acting as someone, briefly

An admin changing a member's email can't just overwrite it: the
requirement says the new address must confirm. Only the member's own
session can ask Supabase for that. So the server asks for a one-time link
for them (which sends nothing), uses it on a client that keeps no cookies,
asks for the change, and signs that session out. It is the same power the
admin already has through "reset password", used for one request. A member
who has never signed in is simpler: change the address, replace the old
temporary password, and send the choose-a-password link.

## Who sends the mail

The app sends none. Supabase sends it through whatever SMTP account its
dashboard names. Gmail works for a household (Google calls it "personal",
and a warning says so). Moving to a sending service such as Resend later
changes that dashboard setting and nothing in the code.
