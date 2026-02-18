export function timestamp(prefix?: string): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, "0");
  const pad3 = (value: number): string => value.toString().padStart(3, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad3(now.getMilliseconds())}`;
  return prefix ? `${prefix}-${ts}` : ts;
}
