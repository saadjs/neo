export function getCommandArgs(text: string | undefined, command: string): string {
  if (!text) return "";
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const commandPattern = new RegExp(`^/${escapedCommand}(?:@[\\w_]+)?\\s*`, "i");
  return text.replace(commandPattern, "").trim();
}
