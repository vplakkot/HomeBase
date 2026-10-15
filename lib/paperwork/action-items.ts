import { dayLabel } from "../finances/month";
import type { ModuleStatus } from "../module-status";
import { documentsCount, fileFoldersCount, isNotPlaced, NOT_PLACED_HREF, type Paper, type PaperFileFolder } from "./paperwork";

// REQ-97: Paperwork's one action item is "N documents unfiled". Filing is
// the "done", so it clears itself when the last paper is filed; there's
// nothing to tick off. It pushes nothing: REQ-97 asks only for Home.
//
// Less urgent than anything Finances raises (its ranks run 1 to 12),
// because a paper on the desk can wait a day and a bill can't.
export const UNFILED_RANK = 13;

export const UNFILED_HREF = "/paperwork/unfiled";

export function paperworkTile(unfiled: number): ModuleStatus {
  if (unfiled === 0) {
    return { status: "All filed", headline: "All filed", facts: [], actionItems: [] };
  }
  const text = `${documentsCount(unfiled)} unfiled`;
  return {
    status: text,
    headline: text,
    facts: [],
    actionItems: [{ text, detail: "File it to clear this", rank: UNFILED_RANK, href: UNFILED_HREF }],
  };
}

// REQ-100: the same item on Paperwork's own page, where it says where
// they are and how long the oldest has waited. None when all are filed.
export function unfiledItem(
  papers: readonly Pick<Paper, "file_folder_id" | "archive_id" | "logged_on">[],
): { text: string; detail: string } | null {
  const waiting = papers.filter((paper) => paper.file_folder_id === null && paper.archive_id === null);
  if (waiting.length === 0) return null;
  const oldest = waiting.map((paper) => paper.logged_on).sort()[0];
  return {
    text: `${documentsCount(waiting.length)} unfiled on your desk`,
    detail: `Oldest logged ${dayLabel(oldest)}`,
  };
}

// REQ-206: the second Paperwork action item, while any physical File Folder
// has no location yet. It clears itself when the last one is placed.
export function notPlacedItem(
  fileFolders: readonly Pick<PaperFileFolder, "status" | "location_id" | "is_drive">[],
): { text: string; detail: string; href: string; action: string } | null {
  const waiting = fileFolders.filter(isNotPlaced).length;
  if (waiting === 0) return null;
  return {
    text: `${fileFoldersCount(waiting)} not placed`,
    detail: "Give each a location from Manage File Folder",
    href: NOT_PLACED_HREF,
    action: waiting === 1 ? "Place it" : "Place them",
  };
}
