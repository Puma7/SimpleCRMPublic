/**
 * Die WebSocket-Routen der API — eine Liste, zwei Proben.
 *
 * `tests/unit/api-auth-surface.test.ts` haelt sie mit den Registrierungen im
 * Fastify-Adapter zusammen (kommt eine hinzu, faellt der Test), und
 * `tests/integration/api-auth-surface-websocket.test.ts` schiesst jede davon
 * unauthentifiziert an.
 *
 * Getrennte Listen waeren die halbe Absicherung: wer eine neue Route hinzufuegt
 * und den Unit-Test durch Nachtragen gruen macht, haette sie damit noch lange
 * nicht geprobt. Deshalb dieselbe Konstante fuer beides.
 */
export const WEBSOCKET_ROUTES: readonly string[] = ['/api/v1/events'];
