import { configurePackagedRuntimeEnvironment } from "./packaged-runtime-environment";

const role = process.argv[2];

if (!(role === "desktop-service" || role === "daemon-service")) {
  process.stderr.write(
    "Usage: eragear-runtime <desktop-service|daemon-service>\n"
  );
  process.exit(64);
}

await configurePackagedRuntimeEnvironment();

if (role === "desktop-service") {
  await import("./desktop-service");
} else {
  await import("./daemon-service");
}
