/**
 * Jede Port-Eigenschaft existiert (kein `if (!ports.x) return 503`-Kurzschluss
 * verdeckt den Auth-Pfad), und jeder tatsaechliche Datenzugriff wirft erkennbar.
 * Nur so trennt der Test "Handler hat 401 geliefert" von "Handler war ohne
 * Principal schon an den Daten".
 */
export function throwingPorts(trail = ''): unknown {
  const target = function reached() { /* aufrufbar */ } as unknown as Record<string, unknown>;
  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      // `then` muss undefined bleiben, sonst haelt await den Proxy fuer ein Promise.
      if (prop === 'then') return undefined;
      return throwingPorts(trail ? `${trail}.${String(prop)}` : String(prop));
    },
    apply() {
      throw new Error(`PORT_REACHED:${trail}`);
    },
    has() { return true; },
  });
}

/** Hat ein Handler einen Port angefasst (statt vorher abzulehnen)? */
export function isPortReached(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('PORT_REACHED');
}
