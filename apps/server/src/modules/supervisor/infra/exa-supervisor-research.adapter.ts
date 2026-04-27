import { z } from "zod";
import type { LoggerPort } from "@/shared/ports/logger.port";
import type {
  SupervisorResearchPort,
  SupervisorResearchResult,
} from "../application/ports/supervisor-research.port";

const EXA_SEARCH_URL = "https://api.exa.ai/search";

const ExaSearchResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  publishedDate: z.string().optional(),
  author: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

const ExaSearchResponseSchema = z.object({
  results: z.array(ExaSearchResultSchema).optional(),
});

export class ExaSupervisorResearchAdapter implements SupervisorResearchPort {
  private readonly apiKey: string;
  private readonly logger: LoggerPort;

  constructor(apiKey: string, logger: LoggerPort) {
    this.apiKey = apiKey;
    this.logger = logger;
  }

  async search(query: string): Promise<SupervisorResearchResult[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return [];
    }

    const response = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        query: trimmedQuery,
        type: "auto",
        numResults: 5,
        contents: {
          highlights: {
            maxCharacters: 1000,
          },
        },
      }),
    });

    if (!response.ok) {
      this.logger.warn("Supervisor Exa search failed", {
        status: response.status,
        queryLength: trimmedQuery.length,
      });
      return [];
    }

    const parsed = ExaSearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      this.logger.warn("Supervisor Exa search returned invalid payload", {
        queryLength: trimmedQuery.length,
        issues: parsed.error.issues.slice(0, 3).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return [];
    }

    const results = (parsed.data.results ?? [])
      .filter((result) => result.url)
      .map((result) => ({
        title: result.title ?? result.url ?? "Untitled",
        url: result.url ?? "",
        publishedDate: result.publishedDate,
        author: result.author,
        highlights: result.highlights ?? [],
      }));
    this.logger.info("Supervisor Exa search completed", {
      queryLength: trimmedQuery.length,
      resultCount: results.length,
    });
    return results;
  }
}

export class NoopSupervisorResearchAdapter implements SupervisorResearchPort {
  search(): Promise<SupervisorResearchResult[]> {
    return Promise.resolve([]);
  }
}
