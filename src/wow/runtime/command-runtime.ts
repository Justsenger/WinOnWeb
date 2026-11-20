export function runCommand<C, A>(
  handler: ((context: C, args?: A) => void) | undefined,
  context: C,
  args?: A,
) {
  if (!handler) return false;
  handler(context, args);
  return true;
}
