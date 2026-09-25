export type CustomerDependents = { deals: number; tasks: number; appointments: number };

/**
 * Thrown by deleteCustomer while deals, tasks or appointments still belong to
 * the customer and the caller has not confirmed deleting them too.
 *
 * Lives outside sqlite-service: a class export there is in its temporal dead
 * zone while sqlite-service is still loading (it imports modules that import it
 * back), which breaks `{ ...jest.requireActual('sqlite-service') }` mocks.
 */
export class CustomerHasDependentsError extends Error {
    readonly code = 'customer_has_dependents';

    constructor(readonly dependents: CustomerDependents) {
        super('Kunde hat verknüpfte Deals, Aufgaben oder Termine');
        this.name = 'CustomerHasDependentsError';
    }
}
