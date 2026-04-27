export interface SupervisorResearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights: string[];
}

export interface SupervisorResearchPort {
  search(query: string): Promise<SupervisorResearchResult[]>;
}
