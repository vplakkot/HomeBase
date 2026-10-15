import {
  active,
  currentDiet,
  dateText,
  dietHistory,
  foodName,
  frequencyText,
  gramsText,
  medicationsFor,
  petTitle,
  vaccineHistories,
  type Diet,
  type Pet,
  type PetMedication,
} from "../../lib/pets/pets";
import {
  archivePet,
  markDelivery,
  markGiven,
  removeDiet,
  removeMedication,
  removePet,
  removeVaccine,
  restorePet,
  undoDose,
} from "./actions";
import { ActionForm, DietForm, MedicationForm, PetForm, VaccineForm } from "./forms";
import { PetPhoto, PetsScreen, type PetsViewer } from "./frame";
import { SheetButton } from "./sheet-button";
import styles from "./pets.module.css";

// One pet's profile (REQ-186 to REQ-189): its vaccines, diet and
// medications on one screen. An archived pet's is read-only, with Restore.
export function PetProfile({ viewer, pet }: { viewer: PetsViewer; pet: Pet }) {
  const archived = pet.archived_at !== null;
  const editable = viewer.canEdit && !archived;
  return (
    <PetsScreen
      viewer={viewer}
      section={archived ? "Archived" : "Overview"}
      crumb={{ parent: archived ? { name: "Archived", href: "/pets/archived" } : undefined, name: pet.name }}
    >
      <div className={styles.fileHead}>
        <div className={styles.petHead}>
          <PetPhoto pet={pet} photos={viewer.photos} />
          <div className={styles.petText}>
            <h2 className={styles.title}>{petTitle(pet)}</h2>
            <span className={styles.sub}>{archived ? `${pet.species} · archived` : pet.species}</span>
          </div>
        </div>
        {viewer.canEdit ? (
          <div className={styles.fileButtons}>
            {archived ? (
              <>
                <ActionForm action={restorePet} fields={{ id: pet.id }} label="Restore" working="Restoring…" />
                <SheetButton label="Remove for good" title={`Remove ${pet.name}`}>
                  <ActionForm
                    action={removePet}
                    fields={{ id: pet.id }}
                    label="Yes, remove it"
                    working="Removing…"
                    ask={`Remove ${pet.name} and every record? This can't be undone.`}
                  />
                </SheetButton>
              </>
            ) : (
              <>
                <SheetButton label="Edit" title={`Edit ${pet.name}`}>
                  <PetForm pet={pet} />
                </SheetButton>
                <SheetButton label="Archive" title={`Archive ${pet.name}`}>
                  <ActionForm
                    action={archivePet}
                    fields={{ id: pet.id }}
                    label="Yes, archive"
                    working="Archiving…"
                    ask={`Archive ${pet.name}? It leaves the Pets home and every record is kept.`}
                  />
                </SheetButton>
              </>
            )}
          </div>
        ) : null}
      </div>
      <VaccinesSection viewer={viewer} petId={pet.id} editable={editable} />
      <DietSection viewer={viewer} petId={pet.id} editable={editable} />
      <MedicationsSection viewer={viewer} petId={pet.id} editable={editable} />
    </PetsScreen>
  );
}

function Section({ id, title, count, action, children }: { id: string; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
          {count === undefined ? null : <span className={styles.count}>· {count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Confirm({ title, ask, action, fields }: { title: string; ask: string; action: typeof removeVaccine; fields: Record<string, string> }) {
  return (
    <SheetButton label="Remove" title={title}>
      <ActionForm action={action} fields={fields} label="Yes, remove it" working="Removing…" ask={ask} />
    </SheetButton>
  );
}

// ---- Vaccines (REQ-187) ---------------------------------------------------

function VaccinesSection({ viewer, petId, editable }: { viewer: PetsViewer; petId: string; editable: boolean }) {
  const histories = vaccineHistories(viewer.vaccines, petId, viewer.today);
  return (
    <Section
      id="vaccines"
      title="Vaccines"
      action={
        editable ? (
          <SheetButton label="Log vaccine" title="Log a vaccine">
            <VaccineForm petId={petId} />
          </SheetButton>
        ) : undefined
      }
    >
      {histories.length === 0 ? (
        <p className={styles.empty}>No vaccines logged.</p>
      ) : (
        <ul className={`${styles.card} ${styles.rows}`}>
          {histories.map((history) => (
            <li key={history.name.trim().toLowerCase()} className={styles.item}>
              <div className={styles.itemHead}>
                <h3 className={styles.itemName}>{history.name}</h3>
                <span className={history.status === "current" ? styles.strong : `${styles.strong} ${styles.warn}`}>
                  {history.status === "current" ? "Current" : history.status === "due soon" ? "Due soon" : "Overdue"}
                </span>
              </div>
              <p className={styles.facts}>
                <span>
                  Given <strong>{dateText(history.latest.given_on)}</strong>
                </span>
                <span>
                  Next due <strong>{dateText(history.latest.next_due_on)}</strong>
                </span>
                {history.latest.clinic ? <span>{history.latest.clinic}</span> : null}
              </p>
              {history.latest.notes ? <p className={styles.sub}>{history.latest.notes}</p> : null}
              {editable ? (
                <div className={styles.itemButtons}>
                  <SheetButton label="Log new dose" title={`Log ${history.name}`}>
                    <VaccineForm petId={petId} name={history.name} />
                  </SheetButton>
                </div>
              ) : null}
              <details>
                <summary>History ({history.entries.length})</summary>
                <ul className={styles.history}>
                  {history.entries.map((entry) => (
                    <li key={entry.id}>
                      <span>
                        {dateText(entry.given_on)} · next due {dateText(entry.next_due_on)}
                        {entry.clinic ? ` · ${entry.clinic}` : ""}
                      </span>
                      {editable ? (
                        <span className={styles.itemButtons}>
                          <SheetButton label="Edit" title={`Edit ${entry.name}`}>
                            <VaccineForm vaccine={entry} />
                          </SheetButton>
                          <Confirm
                            title={`Remove ${entry.name}`}
                            ask={`Remove the ${dateText(entry.given_on)} entry?`}
                            action={removeVaccine}
                            fields={{ id: entry.id }}
                          />
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- Diet (REQ-188) -------------------------------------------------------

function DietDetails({ diet }: { diet: Diet }) {
  return (
    <p className={styles.facts}>
      <span>
        <strong>{gramsText(diet.grams_per_meal)}</strong> a meal
      </span>
      <span>
        <strong>{diet.meals_per_day}</strong> {diet.meals_per_day === 1 ? "meal" : "meals"} a day
      </span>
      {diet.purpose ? <span>For {diet.purpose}</span> : null}
      {diet.batch_prep_on ? <span>Batch prepped {dateText(diet.batch_prep_on)}</span> : null}
    </p>
  );
}

const kindName = (diet: Diet) => (diet.kind === "home_cooked" ? "Home-cooked" : diet.kind === "prescription" ? "Prescription" : "Commercial");

function DietSection({ viewer, petId, editable }: { viewer: PetsViewer; petId: string; editable: boolean }) {
  const current = currentDiet(viewer.diets, petId);
  const history = dietHistory(viewer.diets, petId).filter((diet) => diet.id !== current?.id);
  return (
    <Section
      id="diet"
      title="Diet"
      action={
        editable ? (
          <SheetButton label={current ? "Change diet" : "Set diet"} title={current ? "Change the diet" : "Set the diet"}>
            <DietForm petId={petId} diet={current} />
          </SheetButton>
        ) : undefined
      }
    >
      {current ? (
        <div className={`${styles.card} ${styles.item}`}>
          <div className={styles.itemHead}>
            <h3 className={styles.itemName}>{foodName(current)}</h3>
            <span className={styles.sub}>
              {kindName(current)} · since {dateText(current.started_on)}
            </span>
          </div>
          <DietDetails diet={current} />
          {current.notes ? <p className={styles.sub}>{current.notes}</p> : null}
          {editable ? (
            <div className={styles.itemButtons}>
              <Confirm title="Remove this entry" ask="Remove the current diet entry?" action={removeDiet} fields={{ id: current.id }} />
            </div>
          ) : null}
        </div>
      ) : (
        <p className={styles.empty}>No diet set.</p>
      )}
      {history.length > 0 ? (
        <details>
          <summary>Past diets ({history.length})</summary>
          <ul className={styles.history}>
            {history.map((diet) => (
              <li key={diet.id}>
                <span>
                  {foodName(diet)} · {gramsText(diet.grams_per_meal)} × {diet.meals_per_day} · {dateText(diet.started_on)} to{" "}
                  {diet.ended_on ? dateText(diet.ended_on) : "now"}
                </span>
                {editable ? (
                  <Confirm title="Remove this entry" ask={`Remove ${foodName(diet)} from the history?`} action={removeDiet} fields={{ id: diet.id }} />
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  );
}

// ---- Medications (REQ-189) ----------------------------------------------

function MedicationsSection({ viewer, petId, editable }: { viewer: PetsViewer; petId: string; editable: boolean }) {
  const mine = medicationsFor(petId, viewer.medications, viewer.links, viewer.pets, viewer.today);
  const pets = active(viewer.pets);
  return (
    <Section
      id="medications"
      title="Medications"
      action={
        editable ? (
          <SheetButton label="Add medication" title="Add a medication">
            <MedicationForm pets={pets} taking={[petId]} />
          </SheetButton>
        ) : undefined
      }
    >
      {mine.length === 0 ? (
        <p className={styles.empty}>No medications or preventives.</p>
      ) : (
        <ul className={`${styles.card} ${styles.rows}`}>
          {mine.map((row) => (
            <MedicationRow key={row.medication.id} viewer={viewer} petId={petId} row={row} editable={editable} pets={pets} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function MedicationRow({
  viewer,
  petId,
  row,
  editable,
  pets,
}: {
  viewer: PetsViewer;
  petId: string;
  row: PetMedication;
  editable: boolean;
  pets: ReturnType<typeof active>;
}) {
  const { medication, link, supply } = row;
  const names = row.petIds
    .filter((id) => id !== petId)
    .map((id) => viewer.pets.find((pet) => pet.id === id)?.name)
    .filter(Boolean);
  const doses = viewer.doses
    .filter((dose) => dose.medication_id === medication.id && dose.pet_id === petId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = doses[0];
  const who = (id: string | null) => viewer.people.find((person) => person.user_id === id)?.name;
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <h3 className={styles.itemName}>{medication.name}</h3>
        <span className={styles.sub}>
          {[medication.dose, frequencyText(medication)].filter(Boolean).join(" · ")}
        </span>
      </div>
      <p className={styles.facts}>
        {link.next_dose_on ? (
          <span>
            Next dose <strong>{dateText(link.next_dose_on)}</strong>
          </span>
        ) : (
          <span>
            <strong>Course ended</strong>
          </span>
        )}
        {medication.doses_on_hand !== null ? (
          <span>
            Doses on hand <strong>{medication.doses_on_hand}</strong>
          </span>
        ) : null}
        {supply?.orderByOn ? (
          <span>
            Order by <strong>{dateText(supply.orderByOn)}</strong>
          </span>
        ) : null}
        {medication.purpose ? <span>{medication.purpose}</span> : null}
        {names.length > 0 ? <span>Also: {names.join(", ")}</span> : null}
      </p>
      {supply?.gap && supply.nextDeliveryOn ? (
        <p className={`${styles.strong} ${styles.warn}`} role="status">
          Supply gap: runs out {dateText(supply.runOutOn)}, before the next delivery on {dateText(supply.nextDeliveryOn)}.
          {supply.orderByOn ? ` Order by ${dateText(supply.orderByOn)}.` : ""}
        </p>
      ) : null}
      {latest ? (
        <p className={styles.sub}>
          Last given {dateText(latest.given_on)}
          {who(latest.given_by) ? ` by ${who(latest.given_by)}` : ""}
        </p>
      ) : null}
      {editable ? (
        <div className={styles.itemButtons}>
          {link.next_dose_on ? (
            <ActionForm action={markGiven} fields={{ medicationId: medication.id, petId }} label="Mark given" working="Marking…" />
          ) : null}
          {medication.doses_per_delivery !== null ? (
            <ActionForm action={markDelivery} fields={{ id: medication.id }} label="Mark delivery received" working="Marking…" />
          ) : null}
          {latest ? (
            <SheetButton label="Undo last dose" title="Undo the last dose">
              <ActionForm
                action={undoDose}
                fields={{ id: latest.id }}
                label="Yes, undo it"
                working="Undoing…"
                ask={`Undo the dose given ${dateText(latest.given_on)}?`}
              />
            </SheetButton>
          ) : null}
          <SheetButton label="Edit" title={`Edit ${medication.name}`}>
            <MedicationForm pets={pets} taking={row.petIds} medication={medication} />
          </SheetButton>
          <Confirm
            title={`Remove ${medication.name}`}
            ask={`Remove ${medication.name}${row.petIds.length > 1 ? " for every pet that takes it" : ""}, with its dose history?`}
            action={removeMedication}
            fields={{ id: medication.id }}
          />
        </div>
      ) : null}
    </li>
  );
}
