import path from "node:path";

export function getWatchTargets(configDir: string, huntName: string): string[] {
  return [
    path.join(configDir, "hunts", `${huntName}.yml`),
    path.join(configDir, "config.yml"),
    path.join(configDir, ".env")
  ];
}

export function createDebouncer(delayMs: number, fn: () => void): {
  trigger: () => void;
  cancel: () => void;
} {
  let timer: NodeJS.Timeout | undefined;

  return {
    trigger: () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, delayMs);
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    }
  };
}
