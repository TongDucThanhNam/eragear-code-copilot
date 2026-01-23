export interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

export interface ProjectInput {
  name: string;
  path: string;
  description?: string | null;
  tags?: string[];
  favorite?: boolean;
}

export interface ProjectUpdateInput extends Partial<ProjectInput> {
  id: string;
}
