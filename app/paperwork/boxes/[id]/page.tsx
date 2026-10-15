import { notFound } from "next/navigation";
import { cardFileFolders, fileFoldersCount, places } from "../../../../lib/paperwork/paperwork";
import { FileFolderCards } from "../../file-folder-cards";
import { PaperworkScreen, Section, paperworkViewer } from "../../frame";

// REQ-100's second screen for a storage box: the File Folders archived
// in it (REQ-98), and its archive of single documents (REQ-153). The box's own contents live in Storage.
export default async function BoxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const viewer = await paperworkViewer();
  const { archived } = places(
    viewer.fileFolders,
    viewer.categories,
    viewer.papers,
    viewer.storage,
    viewer.locations,
    viewer.archives,
  );
  const place = archived.find((card) => card.href === `/paperwork/boxes/${id}`);
  if (!place) notFound();

  return (
    <PaperworkScreen viewer={viewer} here={place.href} query={q} crumbs={[{ name: place.name }]}>
      <Section id="fileFolders" title={place.name} aside={fileFoldersCount(cardFileFolders(place))}>
        <FileFolderCards rows={place.fileFolders} archive={place.archive} box={viewer.storage.find((entry) => entry.id === id)} />
      </Section>
    </PaperworkScreen>
  );
}
