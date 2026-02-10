const HUNT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidHuntName(name: string): boolean {
  return HUNT_NAME_PATTERN.test(name);
}

export function assertValidHuntName(name: string): void {
  if (!isValidHuntName(name)) {
    throw new Error(
      `Invalid hunt name: "${name}". Use only letters, numbers, hyphens, and underscores.`
    );
  }
}
