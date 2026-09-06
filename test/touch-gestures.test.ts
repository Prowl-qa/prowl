import { describe, expect, it } from "vitest";
import {
  buildDirectionalSwipe,
  buildSwipeActions,
  DEFAULT_SWIPE_FRACTION,
  MAX_SWIPE_FRACTION,
  MAX_SCROLL_TO_SWIPES,
  probeScrollIntoView,
  SCROLL_TO_PROBE_DIRECTIONS,
  SCROLL_TO_SWEEP_DEPTH,
  SWIPE_HOLD_MS,
  SWIPE_MOVE_DURATION_MS,
  swipeDistanceFor,
  swipeEndpoints,
  toScreenSize,
  type ScreenSize
} from "../src/browser/touch-gestures.js";

const PHONE: ScreenSize = { width: 400, height: 800 };

describe("swipeDistanceFor (PROWL-080 amount→distance mapping)", () => {
  it("defaults to a fraction of the axis when no amount is given", () => {
    expect(swipeDistanceFor("down", PHONE)).toBe(Math.round(800 * DEFAULT_SWIPE_FRACTION));
    expect(swipeDistanceFor("up", PHONE)).toBe(Math.round(800 * DEFAULT_SWIPE_FRACTION));
    // Horizontal directions default off the width axis.
    expect(swipeDistanceFor("left", PHONE)).toBe(Math.round(400 * DEFAULT_SWIPE_FRACTION));
    expect(swipeDistanceFor("right", PHONE)).toBe(Math.round(400 * DEFAULT_SWIPE_FRACTION));
  });

  it("maps an explicit amount 1:1 to swipe distance", () => {
    expect(swipeDistanceFor("down", PHONE, 250)).toBe(250);
  });

  it("uses the absolute value for negative explicit amounts", () => {
    expect(swipeDistanceFor("down", PHONE, -250)).toBe(250);
  });

  it("clamps an oversized amount to the max fraction of the axis", () => {
    expect(swipeDistanceFor("down", PHONE, 100000)).toBe(Math.round(800 * MAX_SWIPE_FRACTION));
    expect(swipeDistanceFor("right", PHONE, 100000)).toBe(Math.round(400 * MAX_SWIPE_FRACTION));
  });

  it("never collapses to a zero-length swipe", () => {
    expect(swipeDistanceFor("down", PHONE, 0)).toBe(1);
  });
});

describe("swipeEndpoints (inverted finger math)", () => {
  // Scroll direction names where content moves; the finger travels the opposite
  // way. Centre of the 400x800 phone is (200, 400).
  it("scrolling down drags the finger up", () => {
    const { start, end } = swipeEndpoints("down", PHONE, 400);
    expect(start).toEqual({ x: 200, y: 600 });
    expect(end).toEqual({ x: 200, y: 200 });
    expect(end.y).toBeLessThan(start.y);
  });

  it("scrolling up drags the finger down", () => {
    const { start, end } = swipeEndpoints("up", PHONE, 400);
    expect(start).toEqual({ x: 200, y: 200 });
    expect(end).toEqual({ x: 200, y: 600 });
    expect(end.y).toBeGreaterThan(start.y);
  });

  it("scrolling right drags the finger left", () => {
    const { start, end } = swipeEndpoints("right", PHONE, 200);
    expect(start).toEqual({ x: 300, y: 400 });
    expect(end).toEqual({ x: 100, y: 400 });
    expect(end.x).toBeLessThan(start.x);
  });

  it("scrolling left drags the finger right", () => {
    const { start, end } = swipeEndpoints("left", PHONE, 200);
    expect(start).toEqual({ x: 100, y: 400 });
    expect(end).toEqual({ x: 300, y: 400 });
    expect(end.x).toBeGreaterThan(start.x);
  });
});

describe("buildSwipeActions (W3C pointer sequence shape)", () => {
  it("emits the exact touch pointer action sequence", () => {
    const actions = buildSwipeActions({ x: 200, y: 600 }, { x: 200, y: 200 });
    expect(actions).toEqual({
      type: "pointer",
      id: "finger1",
      parameters: { pointerType: "touch" },
      actions: [
        { type: "pointerMove", duration: 0, x: 200, y: 600, origin: "viewport" },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: SWIPE_HOLD_MS },
        { type: "pointerMove", duration: SWIPE_MOVE_DURATION_MS, x: 200, y: 200, origin: "viewport" },
        { type: "pointerUp", button: 0 }
      ]
    });
  });
});

describe("buildDirectionalSwipe (end-to-end geometry)", () => {
  it("composes distance, endpoints and actions for a down scroll", () => {
    const { actions, distance, start, end } = buildDirectionalSwipe("down", PHONE, 400);
    expect(distance).toBe(400);
    expect(start).toEqual({ x: 200, y: 600 });
    expect(end).toEqual({ x: 200, y: 200 });
    const moves = actions.actions.filter((a) => a.type === "pointerMove");
    expect(moves[0]).toMatchObject({ x: 200, y: 600 });
    expect(moves[1]).toMatchObject({ x: 200, y: 200 });
  });

  it("normalizes a negative amount by reversing the scroll direction", () => {
    expect(buildDirectionalSwipe("down", PHONE, -400)).toEqual(buildDirectionalSwipe("up", PHONE, 400));
    expect(buildDirectionalSwipe("left", PHONE, -200)).toEqual(buildDirectionalSwipe("right", PHONE, 200));
  });
});

describe("probeScrollIntoView", () => {
  it("keeps the old downward depth and then reverses past the starting viewport", async () => {
    expect(SCROLL_TO_PROBE_DIRECTIONS).toHaveLength(MAX_SCROLL_TO_SWIPES);
    expect(SCROLL_TO_PROBE_DIRECTIONS.slice(0, SCROLL_TO_SWEEP_DEPTH)).toEqual(
      Array.from({ length: SCROLL_TO_SWEEP_DEPTH }, () => "down")
    );
    expect(SCROLL_TO_PROBE_DIRECTIONS.slice(SCROLL_TO_SWEEP_DEPTH)).toEqual(
      Array.from({ length: SCROLL_TO_SWEEP_DEPTH * 2 }, () => "up")
    );
  });

  it("returns true without swiping when the target is already visible", async () => {
    const swipes: string[] = [];

    await expect(
      probeScrollIntoView({
        isVisible: async () => true,
        swipe: async (direction) => {
          swipes.push(direction);
        }
      })
    ).resolves.toBe(true);
    expect(swipes).toEqual([]);
  });

  it("uses the supplied bounded probe order until the target appears", async () => {
    const swipes: string[] = [];
    let probes = 0;

    await expect(
      probeScrollIntoView({
        directions: ["down", "up", "up"],
        isVisible: async () => {
          probes += 1;
          return probes === 4;
        },
        swipe: async (direction) => {
          swipes.push(direction);
        }
      })
    ).resolves.toBe(true);
    expect(swipes).toEqual(["down", "up", "up"]);
  });
});

describe("toScreenSize", () => {
  it("accepts a WDA window/size payload", () => {
    expect(toScreenSize({ width: 390, height: 844 }, "src")).toEqual({ width: 390, height: 844 });
  });

  it("accepts a uiautomator2 window/current/size payload", () => {
    expect(toScreenSize({ x: 0, y: 0, width: 1080, height: 2400 }, "src")).toEqual({
      width: 1080,
      height: 2400
    });
  });

  it("throws on a missing or non-positive size", () => {
    expect(() => toScreenSize({}, "WDA /window/size")).toThrow("WDA /window/size");
    expect(() => toScreenSize({ width: 0, height: 800 }, "src")).toThrow("usable screen size");
    expect(() => toScreenSize(undefined, "src")).toThrow("usable screen size");
  });
});
