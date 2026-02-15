import { describe, expect, it, vi } from "vitest";
import { createDebouncer, getWatchTargets } from "../src/cli/watch-utils.js";

describe("getWatchTargets", () => {
  it("returns hunt, config, and env paths", () => {
    const targets = getWatchTargets("/tmp/project/.prowlqa", "login");
    expect(targets).toEqual([
      "/tmp/project/.prowlqa/hunts/login.yml",
      "/tmp/project/.prowlqa/config.yml",
      "/tmp/project/.prowlqa/.env"
    ]);
  });
});

describe("createDebouncer", () => {
  it("debounces rapid triggers into one call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debouncer = createDebouncer(300, fn);

    debouncer.trigger();
    debouncer.trigger();
    debouncer.trigger();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("cancels pending execution", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debouncer = createDebouncer(300, fn);

    debouncer.trigger();
    debouncer.cancel();
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
