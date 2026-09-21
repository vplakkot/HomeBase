// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDialogStandIn } from "../test/dialog";
import { BottomSheet } from "./bottom-sheet";

beforeAll(installDialogStandIn);
afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Add an expense">
        <p>Coming soon</p>
      </BottomSheet>
    </>
  );
}

function dialog() {
  return document.querySelector("dialog")!;
}

describe("a bottom sheet", () => {
  it("stays closed until asked", () => {
    render(<Harness />);
    expect(dialog().open).toBe(false);
  });

  it("opens as a dialog named by its title", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(dialog().open).toBe(true);
    const titleId = dialog().getAttribute("aria-labelledby");
    expect(document.getElementById(titleId!)?.textContent).toBe("Add an expense");
  });

  it("closes from its Close button", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog().open).toBe(false);
  });

  it("closes when the dimmed page around it is tapped", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(dialog().firstElementChild!);
    expect(dialog().open).toBe(false);
  });

  // Escape makes the browser close the dialog itself; the page has to
  // hear about it, or the sheet would reopen on the next change.
  it("keeps the page in step when the browser closes it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    act(() => dialog().close());
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(dialog().open).toBe(true);
  });
});
