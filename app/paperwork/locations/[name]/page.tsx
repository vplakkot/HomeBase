import { notFound } from "next/navigation";
import { filesCount, places, sameLocation } from "../../../../lib/paperwork/paperwork";
import { FileCards } from "../../file-cards";
import { PaperworkScreen, Section, paperworkViewer } from "../../frame";
import { NewFile } from "../../sheets";

// REQ-100's second screen for an office location: every file kept there.
// The address carries the location's name, however it was typed.
export default async function LocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ name }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const location = decoded(name);
  const { office } = places(viewer.files, viewer.categories, viewer.papers, viewer.storage);
  const place = office.find((card) => sameLocation(card.name, location));
  if (!place) notFound();

  return (
    <PaperworkScreen viewer={viewer} here={place.href} query={q} crumbs={[{ name: place.name }]}>
      <Section
        id="files"
        title={place.name}
        aside={filesCount(place.files.length)}
        action={<NewFile location={place.name} choices={viewer.choices} />}
      >
        <FileCards rows={place.files} />
      </Section>
    </PaperworkScreen>
  );
}

// The name as typed, whether or not the address still has it escaped.
function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
