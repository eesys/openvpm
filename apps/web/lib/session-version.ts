export const DEFAULT_SESSION_VERSION = 1;

export function sessionVersionIsCurrent(
  tokenVersion: unknown,
  currentVersion: number,
): boolean {
  const version =
    tokenVersion === undefined || tokenVersion === null
      ? DEFAULT_SESSION_VERSION
      : tokenVersion;
  return (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version === currentVersion
  );
}
