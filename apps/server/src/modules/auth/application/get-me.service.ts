import type { AuthUserReadPort } from "./ports/auth-user-read.port";

export class GetMeService {
  private readonly authUserRead: AuthUserReadPort;

  constructor(authUserRead: AuthUserReadPort) {
    this.authUserRead = authUserRead;
  }

  async execute(userId: string): Promise<{
    id: string;
    email: string | null;
    username: string | null;
    name: string;
    image: string | null;
  } | null> {
    const user = await this.authUserRead.findById(userId);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name ?? user.username ?? user.email ?? "User",
      image: user.image,
    };
  }
}
