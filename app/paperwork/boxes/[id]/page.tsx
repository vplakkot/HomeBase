import { notFound } from "next/navigation";
import { filesCount, places } from "../../../../lib/paperwork/paperwork";
import { FileCards } from "../../file-cards";
import { PaperworkScreen, Section, paperworkViewer } from "../../frame";

// REQ-100's second screen for a storage box: the files archived
// in it (REQ-98). The box's own contents live in Storage.
export default async function BoxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { archived } = places(viewer.files, viewer.categories, viewer.papers, viewer.storage);
  const place = archived.find((card) => card.href === `/paperwork/boxes/${id}`);
  if (!place) notFound();

  return (
    <PaperworkScreen viewer={viewer} here={place.href} query={q} crumbs={[{ name: place.name }]}>
      <Section id="files" title={place.name} aside={filesCount(place.files.length)}>
        <FileCards rows={place.files} />
      </Section>
    </PaperworkScreen>
  );
}
