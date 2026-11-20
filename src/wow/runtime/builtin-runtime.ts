export function mountBuiltin<C, L>(module: { mount(context: C): L | void }, context: C): L | void {
  return module.mount(context);
}
