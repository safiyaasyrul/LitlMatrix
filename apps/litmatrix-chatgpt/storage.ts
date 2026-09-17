import pg from "pg";
import type { AuthUser } from "./auth.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be configured for Phase 6 persistent storage.");
}

let connectionString = process.env.DATABASE_URL;
if (connectionString.includes("sslmode=require") || connectionString.includes("sslmode=prefer")) {
  if (!connectionString.includes("uselibpqcompat=true")) {
    connectionString += (connectionString.includes("?") ? "&" : "?") + "uselibpqcompat=true";
  }
}

export const pool = new Pool({ connectionString });

export async function initStorage() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS litmatrix_reviews (
      review_id TEXT PRIMARY KEY,
      owner_subject TEXT NOT NULL,
      owner_email TEXT,
      owner_name TEXT,
      title TEXT NOT NULL,
      state JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS litmatrix_reviews_owner_idx
      ON litmatrix_reviews(owner_subject);
    CREATE INDEX IF NOT EXISTS litmatrix_reviews_updated_idx
      ON litmatrix_reviews(updated_at);
  `);
}

export async function saveReview(reviewId: string, review: unknown, owner: AuthUser) {
  const state = JSON.stringify(review);
  await pool.query(
    `INSERT INTO litmatrix_reviews (review_id, owner_subject, owner_email, owner_name, title, state)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (review_id) DO UPDATE SET
       owner_subject = EXCLUDED.owner_subject,
       owner_email = EXCLUDED.owner_email,
       owner_name = EXCLUDED.owner_name,
       title = EXCLUDED.title,
       state = EXCLUDED.state,
       updated_at = NOW()` ,
    [reviewId, owner.subject, owner.email ?? null, owner.name ?? null, String((review as { title?: string }).title ?? "Untitled systematic review"), state],
  );
}

export async function loadReview(reviewId: string, owner: AuthUser) {
  const result = await pool.query(
    `SELECT state FROM litmatrix_reviews WHERE review_id = $1 AND owner_subject = $2 LIMIT 1`,
    [reviewId, owner.subject],
  );
  return result.rows[0]?.state ?? null;
}

export async function deleteExpiredReviews(days = 30) {
  await pool.query(`DELETE FROM litmatrix_reviews WHERE updated_at < NOW() - ($1 || ' days')::interval`, [days]);
}
