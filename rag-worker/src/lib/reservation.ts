import { ClientError } from "./security";
import type { Env, ReservationRequestBody } from "../types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\-\s\d]{6,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function validateReservation(body: unknown): ReservationRequestBody {
  if (typeof body !== "object" || body === null) {
    throw new ClientError("Invalid reservation payload.");
  }
  const b = body as Record<string, unknown>;

  const name = str(b.name, "name", 100);
  const email = str(b.email, "email", 120);
  if (!EMAIL_RE.test(email)) throw new ClientError("Please provide a valid email address.");

  const phone = str(b.phone, "phone", 30);
  if (!PHONE_RE.test(phone)) throw new ClientError("Please provide a valid phone number.");

  const guests = str(b.guests, "guests", 10);
  if (!/^[1-6]\+?$/.test(guests)) {
    throw new ClientError("Please select a valid party size (1–6+).");
  }

  const date = str(b.date, "date", 10);
  if (!DATE_RE.test(date)) throw new ClientError("Please provide a valid date (YYYY-MM-DD).");

  const time = str(b.time, "time", 5);
  if (!TIME_RE.test(time)) throw new ClientError("Please provide a valid time (HH:MM).");

  let specialRequest: string | undefined;
  if (b.specialRequest !== undefined) {
    if (typeof b.specialRequest !== "string") throw new ClientError("Invalid special request.");
    specialRequest = b.specialRequest.slice(0, 500);
  }

  return { name, email, phone, guests, date, time, specialRequest };
}

function str(v: unknown, field: string, maxLen: number): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new ClientError(`'${field}' is required.`);
  }
  const trimmed = v.trim();
  if (trimmed.length > maxLen) throw new ClientError(`'${field}' is too long.`);
  return trimmed;
}

export async function ensureReservationsTable(env: Env): Promise<void> {
  await env.RESERVATIONS_DB.prepare(
    `CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      guests TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      special_request TEXT,
      created_at TEXT NOT NULL
    )`
  ).run();
}

export async function saveReservation(env: Env, r: ReservationRequestBody): Promise<string> {
  const id = crypto.randomUUID();
  await env.RESERVATIONS_DB.prepare(
    `INSERT INTO reservations (id, name, email, phone, guests, date, time, special_request, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, r.name, r.email, r.phone, r.guests, r.date, r.time, r.specialRequest ?? null, new Date().toISOString())
    .run();
  return id;
}
