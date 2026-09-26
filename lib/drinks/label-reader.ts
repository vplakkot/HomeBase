import type { DrinkFields } from "./drinks";

// Reading a label (REQ-27): one or two photos in, whatever details the
// labels show out. A field the labels don't show stays out, never
// guessed; a field read with little confidence is named in `unsure` so
// the review screen can ask for a check.

export type ReadableField = Exclude<keyof DrinkFields, "how" | "price" | "place" | "gift_from">;

export type LabelReading = {
  // False when nothing at all could be read: the review screen then says
  // so, and the fields are filled by hand (REQ-26, REQ-28).
  found: boolean;
  fields: Partial<Pick<DrinkFields, ReadableField>>;
  unsure: ReadableField[];
};

export type LabelReader = (photos: readonly Blob[]) => Promise<LabelReading>;

export const NOTHING_READ: LabelReading = { found: false, fields: {}, unsure: [] };

// Until the label reader is connected (batch 4, Google Cloud Vision),
// every reading finds nothing and the review screen asks for the details
// by hand.
export const noReader: LabelReader = async () => NOTHING_READ;
