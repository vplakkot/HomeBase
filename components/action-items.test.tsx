// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPO_ROOT, styleOf } from "../test/css";
import { moduleBySlug } from "../lib/modules";
import { ActionItems, type HomeActionItem } from "./action-items";
import styles from "./action-items.module.css";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const css = readFileSync(join(REPO_ROOT, "components/action-items.module.css"), "utf-8");

function item(slug: string, text: string, detail: string, rank: number): HomeActionItem {
  return { module: moduleBySlug(slug), item: { text, detail, rank } };
}

const ITEMS = [
  item("finances", "Card bill due Friday", "$285 left to pay", 1),
  item("pets", "Heartworm pill due", "Both dogs, today", 2),
  item("health", "Prescription ready", "Pick up by Tuesday", 3),
];

function show(count: number) {
  const { container } = render(
    <ActionItems labelId="action-items" items={ITEMS.slice(0, count)} />,
  );
  const all = (className: string) => [...container.querySelectorAll(`.${className}`)];
  return {
    container,
    list: container.querySelector("ul"),
    cards: all(styles.card) as HTMLElement[],
    counter: container.querySelector(`.${styles.counter}`)?.textContent ?? null,
    dots: all(styles.dot).map((dot) => (dot.classList.contains(styles.dotOn) ? "on" : "off")),
    edges: all(styles.edgeNear).length + all(styles.edgeFar).length,
  };
}

// jsdom lays nothing out, so a swipe is played as the browser reports it:
// the list, one card wide, has scrolled sideways by some number of cards.
function swipeTo(list: HTMLElement, card: number) {
  Object.defineProperty(list, "clientWidth", { value: 300, configurable: true });
  list.scrollLeft = 300 * card;
  fireEvent.scroll(list);
}

const shown = (className: string, desktop: boolean) =>
  styleOf(css, className, desktop).get("display") !== "none";

describe("on a phone, with two or three items", () => {
  it("shows one card at a time, the first to begin with", () => {
    const { cards } = show(3);
    expect(cards.map((card) => card.textContent)).toEqual([
      "Card bill due Friday$285 left to pay",
      "Heartworm pill dueBoth dogs, today",
      "Prescription readyPick up by Tuesday",
    ]);
    // Each card is the list's full width, and the list snaps to whole
    // cards, starting at the first.
    expect(styleOf(css, "item", false).get("flex")).toBe("0 0 100%");
    expect(styleOf(css, "item", false).get("scroll-snap-align")).toBe("start");
    expect(styleOf(css, "cards", false).get("overflow-x")).toBe("auto");
    expect(styleOf(css, "cards", false).get("scroll-snap-type")).toBe("x mandatory");
  });

  it("puts a 1 / N counter beside the ACTION ITEMS label, dots below and edges behind", () => {
    const three = show(3);
    const labelRow = screen.getByRole("heading", { name: "Action items" }).parentElement!;
    expect(within(labelRow).getByText("1 / 3")).toBeDefined();
    expect(three.dots).toEqual(["on", "off", "off"]);
    expect(three.edges).toBe(2);
    cleanup();

    const two = show(2);
    expect(two.counter).toBe("1 / 2");
    expect(two.dots).toEqual(["on", "off"]);
    expect(two.edges).toBe(1);
  });

  it("moves between items with a sideways swipe, and the counter, dots and edges follow", () => {
    const { container, list } = show(3);
    const now = () => ({
      counter: container.querySelector(`.${styles.counter}`)?.textContent,
      dots: [...container.querySelectorAll(`.${styles.dot}`)].map((dot) =>
        dot.classList.contains(styles.dotOn) ? "on" : "off",
      ),
      edges: container.querySelectorAll(`.${styles.edgeNear}, .${styles.edgeFar}`).length,
    });
    swipeTo(list!, 1);
    expect(now()).toEqual({ counter: "2 / 3", dots: ["off", "on", "off"], edges: 1 });
    swipeTo(list!, 2);
    expect(now()).toEqual({ counter: "3 / 3", dots: ["off", "off", "on"], edges: 0 });
    swipeTo(list!, 0);
    expect(now()).toEqual({ counter: "1 / 3", dots: ["on", "off", "off"], edges: 2 });
  });

  it("can be moved through from the keyboard too", () => {
    const { list } = show(3);
    expect(list?.tabIndex).toBe(0);
  });

  it("never rotates on its own", () => {
    vi.useFakeTimers();
    const { container } = show(3);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(container.querySelector(`.${styles.counter}`)?.textContent).toBe("1 / 3");
  });
});

describe("on a phone, with one item", () => {
  it("shows the card with no counter, dots or stacked edges", () => {
    const one = show(1);
    expect(one.cards).toHaveLength(1);
    expect(one.counter).toBeNull();
    expect(one.dots).toEqual([]);
    expect(one.edges).toBe(0);
  });
});

describe("with no items", () => {
  it("shows the green All clear row instead of a card", () => {
    const none = show(0);
    expect(none.list).toBeNull();
    expect(none.container.textContent).toBe("Action itemsAll clearNo action items today");
  });
});

describe("on a desktop", () => {
  it("shows the items side by side, with no counter, dots or edges", () => {
    expect(styleOf(css, "item", true).get("flex")).toBe("1 1 0");
    expect(styleOf(css, "cards", true).get("overflow-x")).toBe("visible");
    for (const className of ["counter", "dots", "edgeNear", "edgeFar"]) {
      expect(shown(className, false), `${className} on a phone`).toBe(true);
      expect(shown(className, true), `${className} on a desktop`).toBe(false);
    }
  });

  it("labels them ACTION ITEMS · 3, as the mockup does", () => {
    const { container } = show(3);
    expect(container.querySelector(`.${styles.total}`)?.textContent).toBe("· 3");
    expect([shown("total", false), shown("total", true)]).toEqual([false, true]);
  });
});

describe("an item", () => {
  it("shows the module's icon on its loud colour, a line of text, a line of detail and a chevron", () => {
    const { cards } = show(2);
    const pets = cards[1];
    const [chip, text, chevron] = [...pets.children] as HTMLElement[];
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(pets.style.getPropertyValue("--module-loud")).toBe("var(--pets-loud)");
    expect(styleOf(css, "chip", false).get("background")).toBe("var(--module-loud)");
    expect(styleOf(css, "chip", false).get("color")).toBe("var(--module-on-loud)");
    expect([...text.children].map((line) => line.textContent)).toEqual([
      "Heartworm pill due",
      "Both dogs, today",
    ]);
    expect(styleOf(css, "title", false).get("white-space")).toBe("nowrap");
    expect(chevron.querySelector("svg")).not.toBeNull();
  });

  it("doesn't name its module", () => {
    const { cards } = show(3);
    for (const card of cards) {
      expect(card.textContent).not.toMatch(/Finances|Pets|Health/);
    }
  });
});
