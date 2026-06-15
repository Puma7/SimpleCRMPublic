export function mergeSeenLocalOnMailSync(input: {
  currentSeenLocal: boolean;
  incomingSeenLocal: boolean;
  spamStatus: string | null | undefined;
  reconcileSeenFromServer: boolean;
}): boolean {
  if ((input.spamStatus ?? 'clean') === 'review') {
    return input.currentSeenLocal;
  }
  if (input.reconcileSeenFromServer) return input.incomingSeenLocal;
  return input.currentSeenLocal || input.incomingSeenLocal;
}
