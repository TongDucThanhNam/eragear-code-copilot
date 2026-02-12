import type { AuthUserReadPort, AuthUserRecord } from "@/modules/auth";

interface AuthDbReader {
  prepare(query: string): {
    get(...args: unknown[]): unknown;
  };
}

export class AuthUserReadAdapter implements AuthUserReadPort {
  private readonly authDb: AuthDbReader;

  constructor(authDb: AuthDbReader) {
    this.authDb = authDb;
  }

  findById(userId: string): Promise<AuthUserRecord | null> {
    const row = this.authDb
      .prepare(
        'SELECT id, email, username, name, image FROM "user" WHERE id = ? LIMIT 1'
      )
      .get(userId) as AuthUserRecord | undefined;
    return Promise.resolve(row ?? null);
  }
}
