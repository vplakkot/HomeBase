import type { ModuleStatus } from "../module-status";

// REQ-97: Paperwork's one action item is "N unfiled paperwork". Filing is
// the "done", so it clears itself when the last paper is filed; there's
// nothing to tick off. It pushes nothing: REQ-97 asks only for Home.
//
// Less urgent than anything Finances raises (its ranks run 1 to 9),
// because a paper on the desk can wait a day and a bill can't.
export const UNFILED_RANK = 10;

export const UNFILED_HREF = "/paperwork/unfiled";

export function paperworkTile(unfiled: number): ModuleStatus {
  if (unfiled === 0) {
    return { status: "All filed", headline: "All filed", facts: [], actionItems: [] };
  }
  const text = `${unfiled} unfiled paperwork`;
  return {
    status: text,
    headline: text,
    facts: [],
    actionItems: [{ text, detail: "File it to clear this", rank: UNFILED_RANK, href: UNFILED_HREF }],
  };
}
