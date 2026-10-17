import { pg } from "../db/postgres";

const PUBLIC_COLUMNS = "id, username, email, display_name, avatar_url, public_key, settings, created_at";

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  public_key: string | null;
  settings: Record<string, unknown>;
  created_at: string;
}

export async function createUser(input: {
  username: string;
  email: string;
  passwordHash: string;
  publicKey?: string | null;
}): Promise<PublicUser> {
  const { rows } = await pg.query<PublicUser>(
    `INSERT INTO users (username, email, password_hash, public_key, display_name)
     VALUES ($1, $2, $3, $4, $1)
     RETURNING ${PUBLIC_COLUMNS}`,
    [input.username, input.email, input.passwordHash, input.publicKey ?? null]
  );
  return rows[0];
}

export async function findForLogin(
  identifier: string
): Promise<(PublicUser & { password_hash: string | null }) | null> {
  const { rows } = await pg.query<PublicUser & { password_hash: string | null }>(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users
     WHERE lower(username) = lower($1) OR lower(email) = lower($1)
     LIMIT 1`,
    [identifier]
  );
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<PublicUser | null> {
  const { rows } = await pg.query<PublicUser>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export interface UserHit {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** Kullanıcı adı / görünen ad önek araması (yeni sohbet önerileri). E-posta gibi özel alanlar döndürülmez. */
export async function searchUsers(query: string, excludeId: string, limit = 8): Promise<UserHit[]> {
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { rows } = await pg.query<UserHit>(
    `SELECT id, username, display_name, avatar_url FROM users
      WHERE id <> $2 AND (lower(username) LIKE lower($1) || '%' OR lower(display_name) LIKE lower($1) || '%')
      ORDER BY (lower(username) = lower($1)) DESC, length(username), username
      LIMIT $3`,
    [escaped, excludeId, limit]
  );
  return rows;
}

export async function updateProfile(
  id: string,
  patch: { displayName?: string; avatarUrl?: string | null; settings?: Record<string, unknown> }
): Promise<PublicUser | null> {
  const hasAvatar = patch.avatarUrl !== undefined;
  const { rows } = await pg.query<PublicUser>(
    `UPDATE users
        SET display_name = COALESCE($2, display_name),
            avatar_url   = CASE WHEN $4::boolean THEN $5 ELSE avatar_url END,
            settings     = settings || $3::jsonb,
            updated_at   = now()
      WHERE id = $1
      RETURNING ${PUBLIC_COLUMNS}`,
    [id, patch.displayName ?? null, JSON.stringify(patch.settings ?? {}), hasAvatar, patch.avatarUrl ?? null]
  );
  return rows[0] ?? null;
}
