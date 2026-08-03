import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import migration0000 from "../../../drizzle/0000_sqlite_core.sql" with {
  type: "file",
};
import migration0001 from "../../../drizzle/0001_session_messages_unique.sql" with {
  type: "file",
};
import migration0002 from "../../../drizzle/0002_sqlite_runtime_maintenance.sql" with {
  type: "file",
};
import migration0003 from "../../../drizzle/0003_sqlite_storage_hardening.sql" with {
  type: "file",
};
import migration0004 from "../../../drizzle/0004_tenant_ownership.sql" with {
  type: "file",
};
import migration0005 from "../../../drizzle/0005_session_event_outbox.sql" with {
  type: "file",
};
import migration0006 from "../../../drizzle/0006_kind_hannibal_king.sql" with {
  type: "file",
};
import migration0007 from "../../../drizzle/0007_agents_resume_command_template.sql" with {
  type: "file",
};
import migration0008 from "../../../drizzle/0008_sessions_supervisor_state.sql" with {
  type: "file",
};
import migration0009 from "../../../drizzle/0009_projects_supervisor_memory_config.sql" with {
  type: "file",
};
import migration0010 from "../../../drizzle/0010_sessions_config_state.sql" with {
  type: "file",
};
import migration0011 from "../../../drizzle/0011_usage_stats_primary_persistence.sql" with {
  type: "file",
};
import migration0012 from "../../../drizzle/0012_supervisor_runs.sql" with {
  type: "file",
};
import migration0013 from "../../../drizzle/0013_goal_mode_states.sql" with {
  type: "file",
};
import journalAsset from "../../../drizzle/meta/_journal.json" with {
  type: "file",
};
import snapshot0006Asset from "../../../drizzle/meta/0006_snapshot.json" with {
  type: "file",
};

const snapshot0006 = snapshot0006Asset as unknown as string;
const journal = journalAsset as unknown as string;

const EMBEDDED_MIGRATION_FILES = [
  { relativePath: "0000_sqlite_core.sql", sourcePath: migration0000 },
  {
    relativePath: "0001_session_messages_unique.sql",
    sourcePath: migration0001,
  },
  {
    relativePath: "0002_sqlite_runtime_maintenance.sql",
    sourcePath: migration0002,
  },
  {
    relativePath: "0003_sqlite_storage_hardening.sql",
    sourcePath: migration0003,
  },
  { relativePath: "0004_tenant_ownership.sql", sourcePath: migration0004 },
  { relativePath: "0005_session_event_outbox.sql", sourcePath: migration0005 },
  { relativePath: "0006_kind_hannibal_king.sql", sourcePath: migration0006 },
  {
    relativePath: "0007_agents_resume_command_template.sql",
    sourcePath: migration0007,
  },
  {
    relativePath: "0008_sessions_supervisor_state.sql",
    sourcePath: migration0008,
  },
  {
    relativePath: "0009_projects_supervisor_memory_config.sql",
    sourcePath: migration0009,
  },
  {
    relativePath: "0010_sessions_config_state.sql",
    sourcePath: migration0010,
  },
  {
    relativePath: "0011_usage_stats_primary_persistence.sql",
    sourcePath: migration0011,
  },
  {
    relativePath: "0012_supervisor_runs.sql",
    sourcePath: migration0012,
  },
  {
    relativePath: "0013_goal_mode_states.sql",
    sourcePath: migration0013,
  },
  {
    relativePath: path.join("meta", "0006_snapshot.json"),
    sourcePath: snapshot0006,
  },
  { relativePath: path.join("meta", "_journal.json"), sourcePath: journal },
] as const;

export async function materializeEmbeddedSqliteMigrations(
  storageDir: string
): Promise<string> {
  const targetDir = path.join(storageDir, "embedded-migrations");
  await mkdir(path.join(targetDir, "meta"), { recursive: true });

  await Promise.all(
    EMBEDDED_MIGRATION_FILES.map(async (file) => {
      const content = await readFile(file.sourcePath);
      const targetPath = path.join(targetDir, file.relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
    })
  );

  return targetDir;
}
