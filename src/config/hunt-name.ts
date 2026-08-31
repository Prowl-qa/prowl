const HUNT_NAME_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export function isValidHuntName(name: string): boolean {
  return HUNT_NAME_PATTERN.test(name);
}

/**
 * Normalize a hunt argument supplied on the command line to its bare hunt
 * identity. A hunt's identity is its file name under `.prowl/hunts/`, so this
 * accepts the literal path forms an agent (or a shell tab-completion) is likely
 * to produce and reduces them to the name the loader resolves:
 *
 *   .prowl/hunts/homepage.yml      -> homepage
 *   hunts/homepage.yml             -> homepage
 *   .prowl/hunts/admin/users.yaml  -> admin/users
 *   homepage                       -> homepage   (already bare; unchanged)
 *
 * Only the hunts-directory prefix and a trailing `.yml`/`.yaml` extension are
 * stripped; anything else is left untouched so that genuinely invalid input
 * still fails validation with a clear message.
 */
export function normalizeHuntName(input: string): string {
  let name = input.trim();

  if (name.startsWith("./")) {
    name = name.slice(2);
  }

  if (name.startsWith(".prowl/hunts/")) {
    name = name.slice(".prowl/hunts/".length);
  } else if (name.startsWith("hunts/")) {
    name = name.slice("hunts/".length);
  }

  name = name.replace(/\.ya?ml$/i, "");

  return name;
}

export function assertValidHuntName(name: string): void {
  if (!isValidHuntName(name)) {
    throw new Error(
      `Invalid hunt name: "${name}". A hunt name is its file name under ` +
        `.prowl/hunts/ (letters, numbers, hyphens, underscores, and forward ` +
        `slashes for nested hunts). Accepted forms: a bare name (homepage), a ` +
        `nested name (admin/users), or a path (.prowl/hunts/homepage.yml or ` +
        `hunts/homepage.yml).`
    );
  }
}
