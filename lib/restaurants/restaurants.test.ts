import { describe, expect, it } from "vitest";
import { bookingUrlFrom, GO_AGAIN_RANK, restaurantsTile, waitingOn } from "./restaurants";

// Invented rows; nothing here is real.
const rows = [
  { id: "a", tried_on: null },
  { id: "b", tried_on: "2026-09-20" },
  { id: "c", tried_on: "2026-09-25" },
];

describe("go again? (REQ-133)", () => {
  it("asks each person about every tried place they haven't answered for, most recent first", () => {
    const answers = [{ restaurant_id: "b", user_id: "user-2" }];
    expect(waitingOn(rows, answers, "user-1").map((row) => row.id)).toEqual(["c", "b"]);
    expect(waitingOn(rows, answers, "user-2").map((row) => row.id)).toEqual(["c"]);
  });

  it("puts the question on Home for the person it's waiting on, calm otherwise", () => {
    expect(restaurantsTile({ toTry: 3, unanswered: 0 })).toEqual({ status: "3 to try", headline: "3 to try", facts: [], actionItems: [] });
    const asking = restaurantsTile({ toTry: 1, unanswered: 2 });
    expect(asking.status).toBe("Go again? 2 places");
    expect(asking.actionItems).toEqual([
      { text: "Go again? 2 places", detail: "Say whether you'd go back", rank: GO_AGAIN_RANK, href: "/restaurants" },
    ]);
    expect(restaurantsTile({ toTry: 0, unanswered: 1 }).actionItems[0].text).toBe("Go again? 1 place");
  });
});

describe("booking links (REQ-132)", () => {
  it("takes any web address, and nothing else", () => {
    expect(bookingUrlFrom("https://www.exploretock.com/pretend")).toBe("https://www.exploretock.com/pretend");
    expect(bookingUrlFrom(" Book at https://resy.com/cities/ny/pretend ")).toBe("https://resy.com/cities/ny/pretend");
    expect(bookingUrlFrom("javascript:alert(1)")).toBeNull();
    expect(bookingUrlFrom("ftp://example.com")).toBeNull();
    expect(bookingUrlFrom("")).toBeNull();
  });
});
