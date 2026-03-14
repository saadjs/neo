export function isMissingProgressMessageError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /message to edit not found|message_id_invalid/i.test(err.message);
}

export function isMessageNotModifiedError(err: unknown): boolean {
  return err instanceof Error && /message is not modified/i.test(err.message);
}
