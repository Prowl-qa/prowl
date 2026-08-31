import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .claude/ holds local agent state (worktrees with full repo copies);
    // without this exclude, vitest runs every copy's test suite.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
