import { getCustomerById } from '../sqlite-service';

export type EmailAiCustomerTemplateContext = {
  name?: string;
  firstName?: string;
  email?: string;
};

export function getEmailAiCustomerTemplateContext(
  customerId: number,
): EmailAiCustomerTemplateContext | null {
  const row = getCustomerById(customerId);
  if (!row) return null;
  return {
    name: row.name,
    firstName: row.firstName,
    email: row.email,
  };
}
