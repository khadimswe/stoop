// What a live run was started with, kept beside its events: the confirmed inputs, the two readings
// for the Reality Check, the seed receipts and the pack settings. A resume rebuilds the run from it.
// Also the intake record that /start confirms seeds against.
import { z } from "zod";
import { evidenceSchema } from "../evidence";
import { packSettingsSchema, productSpecSchema } from "../prompts/brief";
import { inputsSchema, seedSchema } from "../report/schema";
import type { StatedAudience } from "../stages/gap";
import { keys, TTL } from "../store/keys";
import type { Store } from "../store/types";

// Readings are written by this code only; their own module defines the shape.
const statedSchema = z.custom<StatedAudience>((value) => value !== null && typeof value === "object" && "by" in value);

export const runRecordSchema = z.strictObject({
  inputs: inputsSchema,
  stated: statedSchema.nullable(),
  site: statedSchema.nullable(),
  seedEvidence: z.array(evidenceSchema),
  settings: packSettingsSchema,
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export async function saveRunRecord(store: Store, runId: string, record: RunRecord): Promise<void> {
  await store.set(keys.run.input(runId), runRecordSchema.parse(record), { ttlSeconds: TTL.runEvents });
}

export async function loadRunRecord(store: Store, runId: string): Promise<RunRecord | null> {
  const record = await store.get<unknown>(keys.run.input(runId));
  return record === null ? null : runRecordSchema.parse(record);
}

/** An intake waiting for /start: the product, the readings and every seed it may confirm, with receipts. */
export const intakeRecordSchema = z.strictObject({
  intakeId: z.string().regex(/^in_[0-9a-f]{24}$/),
  createdAt: z.iso.datetime(),
  product: productSpecSchema,
  region: z.string().min(1),
  statedCustomer: z.string().nullable(),
  /** Claude's reading of the page ("Read from your site"), and of the founder's stated customer. */
  site: statedSchema.nullable(),
  stated: statedSchema.nullable(),
  seeds: z.array(seedSchema),
  evidence: z.array(evidenceSchema),
});
export type IntakeRecord = z.infer<typeof intakeRecordSchema>;

export async function saveIntake(store: Store, record: IntakeRecord): Promise<void> {
  await store.set(keys.intake(record.intakeId), intakeRecordSchema.parse(record), { ttlSeconds: TTL.intake });
}

export async function loadIntake(store: Store, intakeId: string): Promise<IntakeRecord | null> {
  const record = await store.get<unknown>(keys.intake(intakeId));
  return record === null ? null : intakeRecordSchema.parse(record);
}
