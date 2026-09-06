/**
 * PROWL-080 / ARCH-014 — synthesized touch gestures for the mobile targets.
 *
 * Both on-device agents (WebDriverAgent on iOS, appium-uiautomator2-server on
 * Android) speak the plain W3C WebDriver **actions** endpoint
 * (`POST /session/:id/actions`), so a single builder here produces the pointer
 * action sequence for a swipe and both drivers post it verbatim over their
 * existing raw-`fetch` transports. We deliberately avoid nonstandard `mobile:`
 * execute shortcuts — portability across the two agents beats convenience.
 *
 * Direction semantics match the web `scroll` step: a scroll *direction* names
 * where the content moves, so the finger swipes the opposite way. Scrolling
 * "down" (reveal content further down the page) drags the finger *up* the
 * screen; "right" drags the finger *left*; and so on. Swipes are centred on the
 * screen and span a distance derived from the step's `amount` (see
 * {@link swipeDistanceFor}).
 */

/** A scroll/swipe direction, matching the web `scroll` step's vocabulary. */
export type SwipeDirection = "up" | "down" | "left" | "right";

/** Screen dimensions in device points, as reported by the agent. */
export interface ScreenSize {
  width: number;
  height: number;
}

/** An (x, y) point in device points. */
export interface Point {
  x: number;
  y: number;
}

/** One item in a W3C `pointer` action sequence. */
export type PointerActionItem =
  | { type: "pointerMove"; duration: number; x: number; y: number; origin?: "viewport" }
  | { type: "pointerDown"; button: number }
  | { type: "pointerUp"; button: number }
  | { type: "pause"; duration: number };

/** A single `touch` pointer input source and its ordered actions. */
export interface PointerActionSequence {
  type: "pointer";
  id: string;
  parameters: { pointerType: "touch" };
  actions: PointerActionItem[];
}

/**
 * Default swipe span as a fraction of the relevant screen axis when the step
 * gives no explicit `amount`. Three-quarters of the axis is a long, reliable
 * drag that still leaves margin at both ends so the endpoints never land on the
 * screen edge (where the OS may steal the gesture for system UI).
 */
export const DEFAULT_SWIPE_FRACTION = 0.75;

/**
 * Hard cap on swipe span as a fraction of the axis. A centred swipe reaches
 * `distance / 2` either side of centre, so 0.9 keeps endpoints within the inner
 * 5%–95% band even at the maximum.
 */
export const MAX_SWIPE_FRACTION = 0.9;

/** Milliseconds the finger holds still after touching down, before dragging. */
export const SWIPE_HOLD_MS = 100;

/** Milliseconds the drag itself takes (a natural, inertia-free swipe). */
export const SWIPE_MOVE_DURATION_MS = 300;

/** Maximum directional swipes `scrollTo` attempts before giving up. */
export const MAX_SCROLL_TO_SWIPES = 10;

/**
 * Coerce an agent's window-size/rect payload into a {@link ScreenSize}. Accepts
 * `{ width, height }` (WDA `/window/size`) or `{ x, y, width, height }`
 * (uiautomator2 `/window/rect`); throws if either dimension is missing or not a
 * positive number, so gesture math never runs on a bad screen size.
 */
export function toScreenSize(value: unknown, source: string): ScreenSize {
  const record = (value ?? {}) as Record<string, unknown>;
  const width = Number(record.width);
  const height = Number(record.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${source} did not return a usable screen size`);
  }
  return { width, height };
}

/** Whether a direction scrolls along the vertical (height) axis. */
function isVertical(direction: SwipeDirection): boolean {
  return direction === "up" || direction === "down";
}

/**
 * Resolve the swipe distance in device points for `direction` on a screen of
 * `size`. `amount` (the web step's pixel amount) maps 1:1 to swipe distance;
 * when omitted it defaults to {@link DEFAULT_SWIPE_FRACTION} of the axis. The
 * result is always clamped to [1, {@link MAX_SWIPE_FRACTION} · axis] so a swipe
 * can never run off-screen or collapse to nothing.
 */
export function swipeDistanceFor(direction: SwipeDirection, size: ScreenSize, amount?: number): number {
  const axis = isVertical(direction) ? size.height : size.width;
  const requested = amount ?? axis * DEFAULT_SWIPE_FRACTION;
  const max = axis * MAX_SWIPE_FRACTION;
  return Math.max(1, Math.round(Math.min(requested, max)));
}

/**
 * Compute the start/end points of a screen-centred swipe. The finger travels
 * *opposite* to the scroll direction (see the module note), split evenly either
 * side of centre so the gesture stays centred regardless of distance.
 */
export function swipeEndpoints(
  direction: SwipeDirection,
  size: ScreenSize,
  distance: number
): { start: Point; end: Point } {
  const cx = Math.round(size.width / 2);
  const cy = Math.round(size.height / 2);
  const half = Math.round(distance / 2);
  switch (direction) {
    case "down":
      // Reveal lower content ⇒ finger moves up.
      return { start: { x: cx, y: cy + half }, end: { x: cx, y: cy - half } };
    case "up":
      // Reveal upper content ⇒ finger moves down.
      return { start: { x: cx, y: cy - half }, end: { x: cx, y: cy + half } };
    case "right":
      // Reveal content to the right ⇒ finger moves left.
      return { start: { x: cx + half, y: cy }, end: { x: cx - half, y: cy } };
    case "left":
      // Reveal content to the left ⇒ finger moves right.
      return { start: { x: cx - half, y: cy }, end: { x: cx + half, y: cy } };
  }
}

/**
 * Build the W3C `touch` pointer action sequence for a swipe from `start` to
 * `end`: move to the origin, press, hold briefly, drag over
 * {@link SWIPE_MOVE_DURATION_MS}, then release. The shape is identical on both
 * agents; it is posted as `{ actions: [<this>] }` to the actions endpoint.
 */
export function buildSwipeActions(start: Point, end: Point): PointerActionSequence {
  return {
    type: "pointer",
    id: "finger1",
    parameters: { pointerType: "touch" },
    actions: [
      { type: "pointerMove", duration: 0, x: start.x, y: start.y, origin: "viewport" },
      { type: "pointerDown", button: 0 },
      { type: "pause", duration: SWIPE_HOLD_MS },
      { type: "pointerMove", duration: SWIPE_MOVE_DURATION_MS, x: end.x, y: end.y, origin: "viewport" },
      { type: "pointerUp", button: 0 }
    ]
  };
}

/**
 * One-shot helper: resolve the distance and endpoints for a centred directional
 * swipe and build its action sequence. Returns the derived geometry too so
 * callers (and tests) can assert the exact gesture.
 */
export function buildDirectionalSwipe(
  direction: SwipeDirection,
  size: ScreenSize,
  amount?: number
): { actions: PointerActionSequence; distance: number; start: Point; end: Point } {
  const distance = swipeDistanceFor(direction, size, amount);
  const { start, end } = swipeEndpoints(direction, size, distance);
  return { actions: buildSwipeActions(start, end), distance, start, end };
}
