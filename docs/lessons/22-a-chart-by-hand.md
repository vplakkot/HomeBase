# 22. A chart by hand

Batch 6 (#160) adds a balance chart on desktop. It's drawn in our own
code, with no chart library. Here's how, and why that was enough.

## 1. SVG is graph paper

An SVG is a small drawing language the browser already understands. You
describe shapes on a sheet of graph paper, and the browser draws them:

- `viewBox="0 0 320 140"` sets the paper: 320 squares wide, 140 tall.
  The picture then stretches to whatever space the page gives it, like
  a photocopy enlarged or reduced.
- A line through the points is a `<path>` whose `d` says "move here,
  then line to here, and here": `M12,80 L85,60 L158,70`.
- Each month is a `<circle>` on that line.

So drawing a chart means turning money into squares. That's two small
sums in `chart.tsx`. Across: month *n* sits *n* steps from the left
edge. Up: the lowest total sits near the bottom, the highest near the
top, and everything else in proportion.

## 2. What a library would have given us, and why we skipped it

A chart library adds axes, animation, zooming and dozens of chart types.
We need one line that nobody zooms. A library would be a new dependency
to keep updated, and more code sent to every phone, which never even
shows the chart (DESIGN.md §1: no charts on a phone). About 60 lines
of our own do the job.

If a later requirement needs stacked bars and hover tooltips across
several charts (the two chart spaces DESIGN.md §7 saves on Finances
home), that's the time to weigh a library again.

## 3. Things that shrink with the paper

Everything inside the drawing is scaled along with it. On a narrow
desktop column, 12-square text became tiny. Two fixes:

- **Text lives outside the drawing.** The month names under the chart
  are ordinary HTML, so they stay at the page's normal text size.
- **Lines keep their width.** `vector-effect: non-scaling-stroke` tells
  the browser to draw a 2px line as 2px, however the paper is scaled.

## 4. A picture isn't the only way in

A screen reader can't see a line. The SVG says `role="img"` and carries
a sentence (`aria-label`): "Combined total from August 2026, $12,300,
to September 2026, $12,500". The table under the chart has every
figure, so the chart only makes the same numbers easier to take in at
a glance. Hovering a point shows its month and total from the `<title>`
inside it, the browser's own tooltip.
