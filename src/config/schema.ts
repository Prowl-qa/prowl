import { z } from "zod";
import { isValidHuntName } from "./hunt-name.js";

export const configSchema = z
  .object({
    target: z.object({
      url: z.string().min(1)
    }),
    browser: z
      .object({
        headless: z.boolean().optional(),
        slowMo: z.number().optional(),
        timeout: z.number().optional(),
        engine: z.enum(["chromium", "firefox", "webkit"]).optional(),
        channel: z.enum([
          "chromium",
          "chrome", "chrome-beta", "chrome-canary", "chrome-dev",
          "msedge", "msedge-beta", "msedge-canary", "msedge-dev"
        ]).optional(),
        viewport: z
          .union([
            z.enum(["mobile", "tablet", "desktop"]),
            z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict()
          ])
          .optional()
      })
      .optional(),
    artifacts: z
      .object({
        screenshots: z.enum(["on-failure", "all"]).optional(),
        networkHar: z.boolean().optional(),
        console: z.boolean().optional(),
        junit: z.boolean().optional()
      })
      .optional(),
    assertions: z
      .object({
        noConsoleErrors: z.boolean().optional(),
        noNetworkErrors: z.boolean().optional(),
        maxTotalTimeMs: z.number().optional(),
        networkIgnorePatterns: z.array(z.string()).optional()
      })
      .optional(),
    guardrails: z
      .object({
        maxSteps: z.number().optional(),
        allowedDomains: z.array(z.string()).optional(),
        forbiddenSelectors: z.array(z.string()).optional()
      })
      .optional(),
    auth: z
      .object({
        storageStatePath: z.string().optional()
      })
      .optional()
  })
  .strict();

export const navigateStepSchema = z.object({ navigate: z.string().min(1) }).strict();
export const clickStepSchema = z
  .object({
    click: z.union([z.object({ selector: z.string().min(1) }).strict(), z.string().min(1)])
  })
  .strict();

const singleKeyValueSchema = z
  .record(z.string().min(1), z.string())
  .refine((record) => Object.keys(record).length === 1, {
    message: "Expected exactly one key-value pair"
  });

export const fillStepSchema = z
  .object({
    fill: z.union([
      z.object({ selector: z.string().min(1), value: z.string() }).strict(),
      singleKeyValueSchema
    ])
  })
  .strict();
export const typeStepSchema = z.object({ type: z.string() }).strict();
export const pressStepSchema = z
  .object({
    press: z.object({ selector: z.string().min(1), key: z.string().min(1) }).strict()
  })
  .strict();
export const waitForSelectorStepSchema = z
  .object({
    waitForSelector: z
      .object({ selector: z.string().min(1), timeout: z.number().optional() })
      .strict()
  })
  .strict();
export const waitStepSchema = z
  .object({
    wait: z.union([
      z.string().min(1),
      z.object({ for: z.string().min(1), timeout: z.number().optional() }).strict()
    ])
  })
  .strict();
export const waitForUrlStepSchema = z
  .object({
    waitForUrl: z.object({ value: z.string().min(1), timeout: z.number().optional() }).strict()
  })
  .strict();
export const waitForNetworkIdleStepSchema = z
  .object({
    waitForNetworkIdle: z.object({ timeout: z.number().optional() }).strict()
  })
  .strict();
export const selectOptionStepSchema = z
  .object({
    selectOption: z.object({ selector: z.string().min(1), value: z.string() }).strict()
  })
  .strict();
export const selectStepSchema = z
  .object({
    select: singleKeyValueSchema
  })
  .strict();
export const onDialogStepSchema = z
  .object({
    onDialog: z.object({ action: z.enum(["accept", "dismiss"]) }).strict()
  })
  .strict();
export const setInputFilesStepSchema = z
  .object({
    setInputFiles: z
      .object({
        selector: z.string().min(1),
        files: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      })
      .strict()
  })
  .strict();
export const inlineAssertStepSchema = z
  .object({
    assert: z
      .object({
        visible: z.string().min(1).optional(),
        notVisible: z.string().min(1).optional(),
        urlIncludes: z.string().min(1).optional(),
        urlEquals: z.string().min(1).optional()
      })
      .strict()
      .refine(
        (value) =>
          [value.visible, value.notVisible, value.urlIncludes, value.urlEquals].filter(
            (entry) => entry !== undefined
          ).length === 1,
        {
          message: "assert requires exactly one of visible, notVisible, urlIncludes, urlEquals"
        }
      )
  })
  .strict();
export const runHuntStepSchema = z
  .object({
    runHunt: z.union([
      z
        .string()
        .min(1)
        .refine(isValidHuntName, {
          message:
            "Invalid hunt name. Use only letters, numbers, hyphens, underscores, and forward slashes."
        }),
      z
        .object({
          name: z
            .string()
            .min(1)
            .refine(isValidHuntName, {
              message:
                "Invalid hunt name. Use only letters, numbers, hyphens, underscores, and forward slashes."
            }),
          vars: z.record(z.string(), z.string()).optional()
        })
        .strict()
    ])
  })
  .strict();
export const hoverStepSchema = z
  .object({
    hover: z.object({ selector: z.string().min(1) }).strict()
  })
  .strict();
export const scrollStepSchema = z
  .object({
    scroll: z
      .object({
        direction: z.enum(["up", "down", "left", "right"]),
        amount: z.number().optional()
      })
      .strict()
  })
  .strict();
export const scrollToStepSchema = z
  .object({
    scrollTo: z.object({ selector: z.string().min(1) }).strict()
  })
  .strict();
export const screenshotStepSchema = z
  .object({
    screenshot: z.object({ name: z.string().optional() }).strict()
  })
  .strict();

// Recursive step schemas use z.lazy() to reference stepSchema before it's defined
export const ifStepSchema = z
  .object({
    if: z
      .object({
        visible: z.string().min(1).optional(),
        notVisible: z.string().min(1).optional(),
        then: z.lazy(() => z.array(stepSchema).min(1))
      })
      .strict()
      .refine(
        (value) =>
          [value.visible, value.notVisible].filter((v) => v !== undefined).length === 1,
        { message: "if requires exactly one of visible or notVisible" }
      )
  })
  .strict();

export const repeatStepSchema = z
  .object({
    repeat: z
      .object({
        times: z.number().int().positive().optional(),
        while: z
          .object({
            visible: z.string().min(1).optional(),
            notVisible: z.string().min(1).optional()
          })
          .strict()
          .refine(
            (value) =>
              [value.visible, value.notVisible].filter((v) => v !== undefined).length === 1,
            { message: "while requires exactly one of visible or notVisible" }
          )
          .optional(),
        maxIterations: z.number().int().positive().optional(),
        steps: z.lazy(() => z.array(stepSchema).min(1))
      })
      .strict()
      .refine((value) => !(value.times !== undefined && value.while !== undefined), {
        message: "repeat requires either times or while, not both"
      })
      .refine((value) => value.times !== undefined || value.while !== undefined, {
        message: "repeat requires either times or while"
      })
      .refine((value) => !(value.while !== undefined && value.maxIterations === undefined), {
        message: "while requires maxIterations"
      })
  })
  .strict();

export const mockRouteStepSchema = z
  .object({
    mockRoute: z
      .object({
        url: z.string().min(1),
        response: z
          .object({
            status: z.number().int(),
            contentType: z.string().min(1).optional(),
            body: z.string().optional(),
            file: z.string().min(1).optional()
          })
          .strict()
          .refine(
            (value) =>
              [value.body, value.file].filter((v) => v !== undefined).length === 1,
            { message: "response requires exactly one of body or file" }
          )
      })
      .strict()
  })
  .strict();

export const unmockRouteStepSchema = z
  .object({
    unmockRoute: z.object({ url: z.string().min(1) }).strict()
  })
  .strict();

export const stepSchema: z.ZodType<unknown> = z.union([
  navigateStepSchema,
  clickStepSchema,
  fillStepSchema,
  typeStepSchema,
  pressStepSchema,
  waitStepSchema,
  selectOptionStepSchema,
  selectStepSchema,
  onDialogStepSchema,
  setInputFilesStepSchema,
  inlineAssertStepSchema,
  runHuntStepSchema,
  waitForSelectorStepSchema,
  waitForUrlStepSchema,
  waitForNetworkIdleStepSchema,
  hoverStepSchema,
  scrollStepSchema,
  scrollToStepSchema,
  screenshotStepSchema,
  ifStepSchema,
  repeatStepSchema,
  mockRouteStepSchema,
  unmockRouteStepSchema
]);

export const assertionSchema = z.union([
  z.object({ selectorExists: z.string().min(1) }).strict(),
  z.object({ selectorNotExists: z.string().min(1) }).strict(),
  z.object({ urlIncludes: z.string().min(1) }).strict(),
  z.object({ urlEquals: z.string().min(1) }).strict(),
  z.object({ noConsoleErrors: z.boolean() }).strict(),
  z.object({ noNetworkErrors: z.boolean() }).strict()
]);

export const huntSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
    vars: z.record(z.string(), z.string()).optional(),
    steps: z.array(stepSchema),
    assertions: z.array(assertionSchema).optional(),
    retry: z
      .object({
        maxRetries: z.number().int().min(0),
        delay: z.number().int().min(0).optional()
      })
      .strict()
      .optional()
  })
  .strict();
