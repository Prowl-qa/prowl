export function timestamp(prefix?: string): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return prefix ? `${prefix}-${ts}` : ts;
}
