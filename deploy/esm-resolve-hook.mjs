// Resolves extensionless ESM imports (e.g. vscode-jsonrpc/node → vscode-jsonrpc/node.js)
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" && !specifier.endsWith(".js")) {
      return nextResolve(specifier + ".js", context);
    }
    throw err;
  }
}
