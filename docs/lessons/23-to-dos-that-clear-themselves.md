# 23. To-dos that clear themselves

Batch 7 (#164) gives Home real action items and sends Finances
reminders. Two ideas came with it.

## 1. Work the list out; don't keep it

The obvious way to build a to-do list is a table of to-dos: add a row
when something needs doing, tick it when it's done. That breaks in a
quiet way. Every place that finishes the job (logging a payment,
entering a bill, closing a month) would also have to remember to tick
the right row, and the first one that forgets leaves a to-do that never
goes away.

So there is no to-do table. Think of a car's dashboard rather than a
sticky note on it. The fuel light isn't something you switch off. It
reads the tank, and it goes off when the tank is full. `financeItems()`
reads the Finances data the same way each time Home opens: is every
bill entered? Is a bill due within five days with money left on it?
Has this person paid anything in 14 days? When the answer changes, the
item is gone. Nobody ticked it, and nothing *could* forget to.

That is REQ-91's "completion clears it, not swiping past it", and it
comes for free.

Two items are news rather than tasks: "the numbers are ready" and "cash
gap". There's nothing in the data to finish, so reading them is the
finish. Those are the only ones that store anything: a row in
`action_item_acks` saying *this person has seen this*. The key names the
item and its month (`ready:2026-09-01`), so next month's is a new item.

## 2. Claim it, then send it

The reminders run every hour. The pitfall is sending the same push
twelve times a day. The job keeps a list of what it sent
(`finance_pushes`), so it needs to check the list before sending and
write to it after.

"Check, then send, then write" has a gap: two runs that overlap (a slow
one and the next) can both check, both see nothing, and both send. The
fix is to change the order: **write first, and only send if your write
went in.** The table's key is the person plus the topic, so the second
identical write is refused (`on conflict do nothing`), and that run
moves on.

It's the same as putting your name on the one sign-up sheet by the
door before you go and buy the cake. Whoever's name went on first is
the one who buys it.

The cost is the opposite mistake: if sending fails after the claim,
that push is lost rather than repeated. For a reminder that's the right
way round. A missed nudge costs little. A phone buzzing every hour
teaches people to switch notifications off.

What goes in the topic decides when a repeat is due. `enter:2026-10-01`
goes once a month. `nudge:2026-10-01:2026-10-03` names the day the
person last paid, so once they pay and then go quiet again, a new nudge
is a new topic.

## Where to look

- `lib/finances/action-items.ts`: every item, its rank, link and push.
- `lib/finances/reminders.ts`: waking hours, claim, send.
- `supabase/checks/action_items.sql`: the storage rules, proven live.
