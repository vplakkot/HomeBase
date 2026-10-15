import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ModuleFrame } from "../../components/module-frame";
import { readAccount } from "../../lib/account";
import { hasPermission } from "../../lib/auth/permissions";
import { readPeople } from "../../lib/drinks/drinks";
import { signedPhotoLinks, thumbPath } from "../../lib/drinks/photos";
import { householdToday } from "../../lib/finances/budget-year";
import { PET_BUCKET, currentDiet, dietLine, petTitle, readPets, type Pet } from "../../lib/pets/pets";
import { createClient } from "../../lib/supabase/server";
import { PetForm } from "./forms";
import { SheetButton } from "./sheet-button";
import styles from "./pets.module.css";
import band from "../../components/band.module.css";

// Who is looking at a Pets page, every pet and its records, the
// household by name, and links to the pets' photos. Signed-out visitors
// go to sign-in.
export async function petsViewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/sign-in");
  const [canManageMembers, canEdit, account, records, people] = await Promise.all([
    hasPermission(supabase, "manage_members"),
    hasPermission(supabase, "use_modules"),
    readAccount(data.claims, supabase),
    readPets(supabase),
    readPeople(supabase),
  ]);
  const paths = records.pets.flatMap((pet) => (pet.photo_path ? [pet.photo_path, thumbPath(pet.photo_path)] : []));
  const photos = await signedPhotoLinks(supabase, paths, 60 * 60, PET_BUCKET);
  return { userId: data.claims.sub, canManageMembers, canEdit, account, ...records, people, photos, today: householdToday() };
}

export type PetsViewer = Awaited<ReturnType<typeof petsViewer>>;

// Every Pets screen (REQ-186): the module header with Add pet, and below
// the top level a breadcrumb back to the home.
export function PetsScreen({
  viewer,
  section,
  crumb,
  children,
}: {
  viewer: PetsViewer;
  section: string;
  crumb?: { parent?: { name: string; href: string }; name: string };
  children: ReactNode;
}) {
  return (
    <ModuleFrame
      slug="pets"
      section={section}
      canManageMembers={viewer.canManageMembers}
      account={viewer.account}
      actions={
        viewer.canEdit ? (
          <div className={styles.tools}>
            <SheetButton label="Add pet" title="Add a pet">
              <PetForm />
            </SheetButton>
          </div>
        ) : undefined
      }
    >
      <div className={styles.screen}>
        {crumb ? (
          <nav aria-label="Breadcrumb">
            <ol className={styles.crumbs}>
              <li>
                <Link href={crumb.parent?.href ?? "/pets"}>{crumb.parent?.name ?? "Pets"}</Link>
              </li>
              <li>
                <span aria-hidden="true">› </span>
                <span aria-current="page">{crumb.name}</span>
              </li>
            </ol>
          </nav>
        ) : null}
        {children}
      </div>
    </ModuleFrame>
  );
}

// A pet's round photo, or its first letter when it has none.
export function PetPhoto({ pet, photos, small = false }: { pet: Pet; photos: Map<string, string>; small?: boolean }) {
  const path = pet.photo_path ? (small ? thumbPath(pet.photo_path) : pet.photo_path) : null;
  const src = path ? photos.get(path) : undefined;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link
    return <img src={src} alt={`${pet.name}`} className={styles.photo} />;
  }
  return (
    <span className={`${styles.photo} ${styles.initial}`} aria-hidden="true">
      {pet.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// Pets as cards that are their own links (REQ-186). An active pet shows
// the food it's on and the grams per meal (REQ-188).
export function PetCards({ viewer, pets, none }: { viewer: PetsViewer; pets: Pet[]; none: string }) {
  if (pets.length === 0) return <p className={styles.empty}>{none}</p>;
  return (
    <ul className={styles.grid}>
      {pets.map((pet) => {
        const diet = pet.archived_at === null ? currentDiet(viewer.diets, pet.id) : null;
        return (
          <li key={pet.id}>
            <Link href={`/pets/${pet.id}`} className={styles.linkCard}>
              <span className={styles.petHead}>
                <PetPhoto pet={pet} photos={viewer.photos} small />
                <span className={styles.petText}>
                  <span className={`${styles.cardTitle} ${band.band}`}>{petTitle(pet)}</span>
                  <span className={styles.sub}>{pet.species}</span>
                </span>
              </span>
              {diet ? <span className={styles.cardDetail}>{dietLine(diet)}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
