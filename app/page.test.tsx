import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("shows HomeBase", () => {
    render(<HomePage />);
    expect(screen.getByText("HomeBase")).toBeDefined();
  });
});
