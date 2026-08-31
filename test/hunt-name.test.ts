import { describe, expect, it } from "vitest";
import {
  assertValidHuntName,
  isValidHuntName,
  normalizeHuntName
} from "../src/config/hunt-name.js";

describe("normalizeHuntName", () => {
  it("leaves a bare hunt name unchanged", () => {
    expect(normalizeHuntName("homepage")).toBe("homepage");
  });

  it("leaves a nested hunt name unchanged", () => {
    expect(normalizeHuntName("admin/users")).toBe("admin/users");
  });

  it("strips a full .prowl/hunts/…yml path down to the hunt name", () => {
    expect(normalizeHuntName(".prowl/hunts/homepage.yml")).toBe("homepage");
  });

  it("strips a full .prowl/hunts/…yml path for a nested hunt", () => {
    expect(normalizeHuntName(".prowl/hunts/admin/users.yml")).toBe("admin/users");
  });

  it("strips a bare hunts/ prefix", () => {
    expect(normalizeHuntName("hunts/homepage.yml")).toBe("homepage");
  });

  it("strips a .yaml extension as well as .yml", () => {
    expect(normalizeHuntName(".prowl/hunts/homepage.yaml")).toBe("homepage");
    expect(normalizeHuntName("homepage.yaml")).toBe("homepage");
  });

  it("strips a leading ./ before the hunts prefix", () => {
    expect(normalizeHuntName("./.prowl/hunts/homepage.yml")).toBe("homepage");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeHuntName("  homepage  ")).toBe("homepage");
  });

  it("is idempotent on an already-bare name", () => {
    expect(normalizeHuntName(normalizeHuntName(".prowl/hunts/homepage.yml"))).toBe(
      "homepage"
    );
  });

  it("normalizes the accepted forms to the same identity", () => {
    const forms = [
      "homepage",
      "hunts/homepage.yml",
      ".prowl/hunts/homepage.yml"
    ];
    const normalized = forms.map(normalizeHuntName);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("homepage");
  });
});

describe("normalizeHuntName + validation", () => {
  it("produces a valid name for every accepted path form", () => {
    expect(isValidHuntName(normalizeHuntName(".prowl/hunts/homepage.yml"))).toBe(true);
    expect(isValidHuntName(normalizeHuntName("hunts/homepage.yml"))).toBe(true);
    expect(isValidHuntName(normalizeHuntName(".prowl/hunts/admin/users.yaml"))).toBe(
      true
    );
    expect(isValidHuntName(normalizeHuntName("homepage"))).toBe(true);
  });

  it("still rejects input that is invalid after normalization", () => {
    // A stray dot that is not a recognized extension survives normalization and
    // remains invalid.
    const normalized = normalizeHuntName("home.page");
    expect(normalized).toBe("home.page");
    expect(isValidHuntName(normalized)).toBe(false);
    expect(() => assertValidHuntName(normalized)).toThrowError(/Invalid hunt name/);
  });

  it("error message states the accepted forms", () => {
    expect(() => assertValidHuntName("bad name")).toThrowError(/Accepted forms/);
  });
});
