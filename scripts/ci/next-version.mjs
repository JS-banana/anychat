export function resolveNextVersion(tauriVersion, latestTag) {
  if (!latestTag) return tauriVersion;

  const tagVersion = latestTag.replace(/^v/, "");
  if (tagVersion !== tauriVersion) return tauriVersion;

  const [major, minor, patch] = tagVersion.split(".").map(Number);
  return [major, minor, patch + 1].join(".");
}

function readInputValue(argIndex, envKey) {
  const value = process.argv[argIndex];
  if (value) return value;
  const envValue = process.env[envKey];
  return envValue || "";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tauriVersion = readInputValue(2, "TAURI_VERSION");
  const latestTag = readInputValue(3, "LATEST_TAG") || null;

  if (!tauriVersion) {
    console.error("TAURI_VERSION is required");
    process.exit(1);
  }

  const nextVersion = resolveNextVersion(tauriVersion, latestTag);
  process.stdout.write(nextVersion);
}
