"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import cards from "../../components/cards.module.css";
import { shrinkPhoto } from "../../lib/drinks/shrink-photo";
import {
  DIET_KINDS,
  FREQUENCIES,
  type Diet,
  type DietKind,
  type Frequency,
  type Medication,
  type Pet,
  type Vaccine,
} from "../../lib/pets/pets";
import {
  addMedication,
  addPet,
  addVaccine,
  saveDiet,
  updateMedication,
  updatePet,
  updateVaccine,
  type FormState,
} from "./actions";
import { useCloseSheet } from "./sheet-button";
import styles from "./pets.module.css";

const initialState: FormState = {};

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

function Outcome({ state }: { state: FormState }) {
  return state.error ? (
    <p role="alert" className={cards.error}>
      {state.error}
    </p>
  ) : null;
}

// The sheet the form is in closes once the action reports it saved.
function useCloseWhenSaved(state: FormState) {
  const close = useCloseSheet();
  useEffect(() => {
    if (state.saved) close();
  }, [state, close]);
}

// A one-tap action, or one that asks first: Mark given, Archive, Remove.
// `fields` are the hidden values the action reads. With `ask`, the button
// is only the question's answer: a sheet-less "Yes, remove it" next to
// "Keep it" (which closes the sheet it's in).
export function ActionForm({
  action,
  fields,
  label,
  working,
  ask,
  quiet = false,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  working: string;
  ask?: string;
  quiet?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const close = useCloseSheet();
  useCloseWhenSaved(state);
  return (
    <form action={formAction} className={ask ? cards.form : undefined}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {ask ? <p className={cards.check}>{ask}</p> : null}
      <div className={ask ? cards.actions : undefined}>
        <button type="submit" className={quiet ? undefined : cards.primary} disabled={pending}>
          {pending ? working : label}
        </button>
        {ask ? (
          <button type="button" className={cards.quiet} onClick={close}>
            Keep it
          </button>
        ) : null}
      </div>
      <Outcome state={state} />
    </form>
  );
}

// ---- Profile -------------------------------------------------------------

// A pet's photo, shrunk in the browser before it's sent (the same as a
// drink's label): the full photo and a small copy for the home card.
function PhotoField({ onPicked, hasPhoto }: { onPicked: (shots: { full: Blob; thumb: Blob } | null) => void; hasPhoto: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cards.field}>
      <span>Photo (optional)</span>
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label="Photo"
        onChange={async () => {
          const file = input.current?.files?.[0];
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const shots = await shrinkPhoto(file);
            onPicked(shots);
            setPreview((old) => {
              if (old) URL.revokeObjectURL(old);
              return URL.createObjectURL(shots.full);
            });
          } catch {
            onPicked(null);
            setError("That photo couldn't be opened. Try another.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy ? <span className={styles.sub}>Getting the photo ready…</span> : null}
      {error ? (
        <span role="alert" className={cards.error}>
          {error}
        </span>
      ) : null}
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local photo not yet saved
        <img src={preview} alt="The new photo" className={styles.preview} />
      ) : hasPhoto ? (
        <label className={cards.check}>
          <input type="checkbox" name="removePhoto" value="yes" />
          Remove the current photo
        </label>
      ) : null}
    </div>
  );
}

// REQ-186: add a pet, or (with `pet`) change its details.
export function PetForm({ pet }: { pet?: Pet }) {
  const [state, formAction, pending] = useActionState(pet ? updatePet : addPet, initialState);
  const [shots, setShots] = useState<{ full: Blob; thumb: Blob } | null>(null);
  useCloseWhenSaved(state);
  return (
    <form
      className={cards.form}
      action={(formData) => {
        if (shots) {
          formData.set("photo", shots.full, "photo.jpg");
          formData.set("photo_thumb", shots.thumb, "photo-thumb.jpg");
        }
        formAction(formData);
      }}
    >
      {pet ? <input type="hidden" name="id" value={pet.id} /> : null}
      <label className={cards.field}>
        <span>Name</span>
        <input name="name" required defaultValue={pet?.name ?? ""} />
      </label>
      <label className={cards.field}>
        <span>Nickname (optional)</span>
        <input name="nickname" defaultValue={pet?.nickname ?? ""} />
      </label>
      <label className={cards.field}>
        <span>Species</span>
        <input name="species" required list="pet-species" defaultValue={pet?.species ?? ""} placeholder="Dog" />
        <datalist id="pet-species">
          <option value="Dog" />
          <option value="Cat" />
        </datalist>
      </label>
      <PhotoField onPicked={setShots} hasPhoto={Boolean(pet?.photo_path)} />
      <button type="submit" className={cards.primary} disabled={pending}>
        {pending ? "Saving…" : pet ? "Save changes" : "Add pet"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

// ---- Vaccines --------------------------------------------------------------

// REQ-187: log a dose, or (with `vaccine`) correct an entry. The next due
// date is typed, never worked out.
export function VaccineForm({ petId, vaccine, name }: { petId?: string; vaccine?: Vaccine; name?: string }) {
  const [state, formAction, pending] = useActionState(vaccine ? updateVaccine : addVaccine, initialState);
  useCloseWhenSaved(state);
  return (
    <form action={formAction} className={cards.form}>
      {vaccine ? <input type="hidden" name="id" value={vaccine.id} /> : <input type="hidden" name="petId" value={petId} />}
      <label className={cards.field}>
        <span>Vaccine</span>
        <input name="name" required defaultValue={vaccine?.name ?? name ?? ""} placeholder="Rabies" />
      </label>
      <label className={cards.field}>
        <span>Date given</span>
        <input type="date" name="givenOn" required defaultValue={vaccine?.given_on ?? ""} />
      </label>
      <label className={cards.field}>
        <span>Next due</span>
        <input type="date" name="nextDueOn" required defaultValue={vaccine?.next_due_on ?? ""} />
      </label>
      <label className={cards.field}>
        <span>Vet or clinic (optional)</span>
        <input name="clinic" defaultValue={vaccine?.clinic ?? ""} />
      </label>
      <label className={cards.field}>
        <span>Notes (optional)</span>
        <textarea name="notes" rows={2} defaultValue={vaccine?.notes ?? ""} />
      </label>
      <button type="submit" className={cards.primary} disabled={pending}>
        {pending ? "Saving…" : vaccine ? "Save changes" : "Log vaccine"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

// ---- Diet ---------------------------------------------------------------------

// REQ-188: set the diet, or change it. The fields follow the type: a
// commercial or prescription food has a brand and product, a home-cooked
// one a protein and a batch prep date.
export function DietForm({ petId, diet }: { petId: string; diet: Diet | null }) {
  const [state, formAction, pending] = useActionState(saveDiet, initialState);
  const [kind, setKind] = useState<DietKind>(diet?.kind ?? "commercial");
  useCloseWhenSaved(state);
  const home = kind === "home_cooked";
  return (
    <form action={formAction} className={cards.form}>
      <input type="hidden" name="petId" value={petId} />
      <label className={cards.field}>
        <span>Type</span>
        <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as DietKind)}>
          {DIET_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {home ? (
        <>
          <label className={cards.field}>
            <span>Protein</span>
            <input name="protein" required defaultValue={diet?.protein ?? ""} placeholder="Chicken" />
          </label>
          <label className={cards.field}>
            <span>Batch prep date (optional)</span>
            <input type="date" name="batchPrepOn" defaultValue={diet?.batch_prep_on ?? ""} />
          </label>
        </>
      ) : (
        <>
          <label className={cards.field}>
            <span>Brand</span>
            <input name="brand" required defaultValue={diet?.brand ?? ""} />
          </label>
          <label className={cards.field}>
            <span>Product</span>
            <input name="product" required defaultValue={diet?.product ?? ""} />
          </label>
          <label className={cards.field}>
            <span>Purpose (optional, for example GI)</span>
            <input name="purpose" defaultValue={diet?.purpose ?? ""} />
          </label>
        </>
      )}
      <label className={cards.field}>
        <span>Grams per meal</span>
        <input name="grams" type="number" inputMode="decimal" min="1" step="0.1" required defaultValue={diet?.grams_per_meal ?? ""} />
      </label>
      <label className={cards.field}>
        <span>Meals per day</span>
        <input name="meals" type="number" inputMode="numeric" min="1" step="1" required defaultValue={diet?.meals_per_day ?? ""} />
      </label>
      <label className={cards.field}>
        <span>{home ? "Recipe notes (optional)" : "Notes (optional)"}</span>
        <textarea name="notes" rows={3} defaultValue={diet?.notes ?? ""} />
      </label>
      <button type="submit" className={cards.primary} disabled={pending}>
        {pending ? "Saving…" : diet ? "Save diet" : "Set diet"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

// ---- Medications ---------------------------------------------------------------

// REQ-189: add a medication or preventive, or (with `medication`) change
// it, including its supply. `pets` are the active pets that could take it;
// `taking` are the ones that do.
export function MedicationForm({
  pets,
  taking,
  medication,
}: {
  pets: readonly Pick<Pet, "id" | "name">[];
  taking: readonly string[];
  medication?: Medication;
}) {
  const [state, formAction, pending] = useActionState(medication ? updateMedication : addMedication, initialState);
  const [frequency, setFrequency] = useState<Frequency>(medication?.frequency ?? "monthly");
  const [ongoing, setOngoing] = useState(medication ? medication.ends_on === null : true);
  useCloseWhenSaved(state);
  const field = (label: string, node: ReactNode) => (
    <label className={cards.field}>
      <span>{label}</span>
      {node}
    </label>
  );
  return (
    <form action={formAction} className={cards.form}>
      {medication ? <input type="hidden" name="id" value={medication.id} /> : null}
      {field("Name", <input name="name" required defaultValue={medication?.name ?? ""} />)}
      {field(
        "Purpose (for example, flea, tick and heartworm)",
        <input name="purpose" defaultValue={medication?.purpose ?? ""} />,
      )}
      {field("Dose", <input name="dose" defaultValue={medication?.dose ?? ""} placeholder="1 tablet" />)}
      {field(
        "How often",
        <select name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>
          {FREQUENCIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>,
      )}
      {frequency === "every_n_days"
        ? field(
            "Days between doses",
            <input name="everyNDays" type="number" inputMode="numeric" min="1" step="1" required defaultValue={medication?.every_n_days ?? ""} />,
          )
        : null}
      {field("Starts", <input type="date" name="startsOn" required defaultValue={medication?.starts_on ?? ""} />)}
      <label className={cards.check}>
        <input type="checkbox" name="ongoing" value="yes" checked={ongoing} onChange={(event) => setOngoing(event.target.checked)} />
        Ongoing
      </label>
      {ongoing ? null : field("Ends", <input type="date" name="endsOn" required defaultValue={medication?.ends_on ?? ""} />)}
      {field("Prescribing vet (optional)", <input name="prescribingVet" defaultValue={medication?.prescribing_vet ?? ""} />)}
      <fieldset className={styles.pick}>
        <legend>Taken by</legend>
        {pets.map((pet) => (
          <label key={pet.id} className={cards.check}>
            <input type="checkbox" name="petIds" value={pet.id} defaultChecked={taking.includes(pet.id)} />
            {pet.name}
          </label>
        ))}
      </fieldset>
      <fieldset className={styles.pick}>
        <legend>Supply (optional)</legend>
        {field(
          "Doses on hand",
          <input name="dosesOnHand" type="number" inputMode="numeric" min="0" step="1" defaultValue={medication?.doses_on_hand ?? ""} />,
        )}
        {field(
          "Doses per delivery",
          <input name="dosesPerDelivery" type="number" inputMode="numeric" min="1" step="1" defaultValue={medication?.doses_per_delivery ?? ""} />,
        )}
        {field(
          "Delivery every (months)",
          <input name="deliveryIntervalMonths" type="number" inputMode="numeric" min="1" step="1" defaultValue={medication?.delivery_interval_months ?? ""} />,
        )}
        {field("Last delivery", <input type="date" name="lastDeliveryOn" defaultValue={medication?.last_delivery_on ?? ""} />)}
        {field(
          "Order lead time (days)",
          <input name="leadTimeDays" type="number" inputMode="numeric" min="0" step="1" defaultValue={medication?.lead_time_days ?? ""} />,
        )}
      </fieldset>
      <button type="submit" className={cards.primary} disabled={pending}>
        {pending ? "Saving…" : medication ? "Save changes" : "Add medication"}
      </button>
      <Outcome state={state} />
    </form>
  );
}
