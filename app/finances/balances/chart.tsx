import { monthLabel } from "../../../lib/finances/budget-year";
import type { TrendMonth } from "../../../lib/finances/balances";
import { formatMoney } from "../../../lib/finances/money";
import local from "./page.module.css";

const WIDTH = 320;
const HEIGHT = 140;
const PAD = { top: 12, right: 12, bottom: 12, left: 12 };

// REQ-68, desktop only (DESIGN.md §1: no charts on a phone): the combined
// total, month by month, as one line. Drawn as plain SVG, no chart
// library. The table below it holds the same figures, and every account.
export function BalanceChart({ trend }: { trend: TrendMonth[] }) {
  const points = [...trend].reverse();
  if (points.length < 2) return null;
  const totals = points.map((point) => point.total);
  const low = Math.min(...totals);
  const high = Math.max(...totals);
  const span = high - low || Math.max(high, 1);
  const x = (index: number) => PAD.left + (index * (WIDTH - PAD.left - PAD.right)) / (points.length - 1);
  const y = (total: number) =>
    PAD.top + (HEIGHT - PAD.top - PAD.bottom) * (1 - (total - low + span * 0.1) / (span * 1.2));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.total)}`).join(" ");
  const first = points[0];
  const last = points.at(-1)!;
  return (
    <figure className={local.chart}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Combined total from ${monthLabel(first.month)}, ${formatMoney(first.total)}, to ${monthLabel(last.month)}, ${formatMoney(last.total)}`}
      >
        <line className={local.axis} x1={PAD.left} x2={WIDTH - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} />
        <path className={local.line} d={line} />
        {points.map((point, index) => (
          <g key={point.month} className={local.point}>
            <title>{`${monthLabel(point.month)}: ${formatMoney(point.total)}`}</title>
            <circle cx={x(index)} cy={y(point.total)} r={10} className={local.hit} />
            <circle cx={x(index)} cy={y(point.total)} r={4} className={local.dot} />
          </g>
        ))}
      </svg>
      {/* Outside the drawing, so the text stays readable however narrow
          the column makes the chart. */}
      <div className={local.ends} aria-hidden="true">
        <span>{monthLabel(first.month)}</span>
        <span>{monthLabel(last.month)}</span>
      </div>
      <figcaption className={local.caption}>Combined total, {formatMoney(last.total)} now</figcaption>
    </figure>
  );
}
