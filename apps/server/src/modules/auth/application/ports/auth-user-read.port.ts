export interface AuthUserRecord {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  image: string | null;
}

export interface AuthUserReadPort {
  findById(userId: string): Promise<AuthUserRecord | null>;
}
