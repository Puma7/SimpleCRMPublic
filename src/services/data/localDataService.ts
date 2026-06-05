import type { DataService, Customer, Product } from './types'; // Assuming Product type is added to types.ts
import { IPCChannels } from '@shared/ipc/channels';
import { invokeRenderer } from '@/services/transport';

// Type mapping might be needed if frontend types differ slightly from SQLite types
const mapDbCustomerToApp = (dbCustomer: any): Customer => ({
    id: dbCustomer.id.toString(), // Convert SQLite int ID to string if needed by frontend
    jtl_kKunde: dbCustomer.jtl_kKunde,
    customerNumber: dbCustomer.customerNumber, // Map JTL customer number
    name: dbCustomer.name ?? '',
    firstName: dbCustomer.firstName,
    company: dbCustomer.company,
    email: dbCustomer.email,
    phone: dbCustomer.phone,
    mobile: dbCustomer.mobile,
    street: dbCustomer.street,
    zip: dbCustomer.zip,
    city: dbCustomer.city,
    country: dbCustomer.country,
    status: dbCustomer.status ?? 'Active', // Use default if null
    notes: dbCustomer.notes,
    affiliateLink: dbCustomer.affiliateLink,
    dateAdded: dbCustomer.jtl_dateCreated ? new Date(dbCustomer.jtl_dateCreated).toLocaleDateString() : '', // Format date
    lastContact: '', // This might need separate tracking if required
});

const mapDbProductToApp = (dbProduct: any): Product => ({
    id: dbProduct.id.toString(),
    jtl_kArtikel: dbProduct.jtl_kArtikel,
    sku: dbProduct.sku,
    name: dbProduct.name,
    description: dbProduct.description,
    price: dbProduct.price,
    barcode: dbProduct.barcode,
    stockLevel: dbProduct.stockLevel,
    isActive: !!dbProduct.isActive,
    jtl_dateCreated: dbProduct.jtl_dateCreated ? new Date(dbProduct.jtl_dateCreated).toLocaleDateString() : '',
     // ... map other fields ...
});

export const localDataService: DataService = {
  async getCustomers(): Promise<Customer[]> {
    try {
      const dbCustomers = await invokeRenderer(IPCChannels.Db.GetCustomers, false) as any[]; // Skip custom fields for performance
      return dbCustomers.map(mapDbCustomerToApp);
    } catch (error) {
        console.error("Error invoking 'db:get-customers':", error);
        // You might want to return an empty array or re-throw depending on desired UI behavior
        return [];
    }
  },
  async getCustomer(id: string): Promise<Customer | null> {
    try {
      // Call the main process to get a specific customer by ID
      const dbCustomer = await invokeRenderer(IPCChannels.Db.GetCustomer, Number(id)) as any;
      
      // If no customer found, return null
      if (!dbCustomer) return null;
      
      // Map the customer data to the Customer type
      return mapDbCustomerToApp(dbCustomer);
    } catch (error) {
      console.error(`Error fetching customer with ID ${id}:`, error);
      return null;
    }
  },
  async createCustomer(data: Omit<Customer, 'id'>): Promise<Customer> {
    try {
      const response = await invokeRenderer(IPCChannels.Db.CreateCustomer, data) as any;
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to create customer');
      }
      
      return mapDbCustomerToApp(response.customer);
    } catch (error) {
      console.error('Error creating customer:', error);
      throw error;
    }
  },
  async updateCustomer(id: string, data: Partial<Customer>): Promise<Customer> {
    try {
      const response = await invokeRenderer(IPCChannels.Db.UpdateCustomer, { id: Number(id), customerData: data }) as any;
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to update customer');
      }
      
      return mapDbCustomerToApp(response.customer);
    } catch (error) {
      console.error(`Error updating customer with ID ${id}:`, error);
      throw error;
    }
  },
  async deleteCustomer(id: string): Promise<void> {
    try {
      const response = await invokeRenderer(IPCChannels.Db.DeleteCustomer, Number(id)) as any;
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to delete customer');
      }
    } catch (error) {
      console.error(`Error deleting customer with ID ${id}:`, error);
      throw error;
    }
  },

  // --- Products ---
  async getProducts(): Promise<Product[]> {
    try {
       const dbProducts = await invokeRenderer(IPCChannels.Products.GetAll) as any[];
       return dbProducts.map(mapDbProductToApp);
    } catch (error) {
        console.error("Error invoking 'db:get-products':", error);
        return [];
    }
  },
  // getProduct, createProduct, updateProduct, deleteProduct...
};

export const getLocalCustomers = async (): Promise<Customer[]> => {
    if (import.meta.env.DEV) {
        console.debug("localDataService: getLocalCustomers called");
    }
    try {
        const dbCustomers = await invokeRenderer(IPCChannels.Db.GetCustomers, false) as any[]; // Skip custom fields for performance
        if (import.meta.env.DEV) {
            console.debug("localDataService: Received customers from main", { count: Array.isArray(dbCustomers) ? dbCustomers.length : 'unknown' });
        }

        // Basic validation (can be expanded with Zod)
        if (!Array.isArray(dbCustomers)) {
            console.error("localDataService: Received invalid data format for customers.");
            throw new Error("Invalid data format received from local database for customers.");
        }

        // Map to Customer type, ensuring all required fields are present
        return dbCustomers.map((c: any): Customer => ({            id: c.KundeNr?.toString() ?? '', // Ensure ID is string and handle null/undefined
            jtl_kKunde: c.KundeNr, // Map jtl_kKunde from KundeNr (assumption)
            name: c.Name1 || '', // Map name from Name1 (assumption)
            status: c.Status || 'Active', // Map status from Status (assumption)
            firstName: c.Vorname || '', // Adjust field names based on actual source data
            company: c.Firma || '', // Adjust field names
            phone: c.Telefon || '',
            street: c.Strasse || '',
            zip: c.PLZ || '',
            city: c.Ort || '',
            country: c.Land || '',
            notes: c.Notiz || '',
            affiliateLink: c.affiliateLink || '',
            dateAdded: c.Erfassungsdatum ? new Date(c.Erfassungsdatum).toLocaleDateString() : '',
            lastContact: '', // Example default
        }));
    } catch (error) {
        console.error("Error fetching local customers:", error);
        // Consider how to handle errors - rethrow, return empty, etc.
        throw error; // Rethrow the error to be handled by the caller
    }
};

// --- Products ---
export const getLocalProducts = async (): Promise<Product[]> => {
    if (import.meta.env.DEV) {
        console.debug("localDataService: getLocalProducts called");
    }
    try {
        const dbProducts = await invokeRenderer(IPCChannels.Products.GetAll) as any[];
        if (import.meta.env.DEV) {
            console.debug("localDataService: Received products from main", { count: Array.isArray(dbProducts) ? dbProducts.length : 'unknown' });
        }

        // Basic validation
        if (!Array.isArray(dbProducts)) {
            console.error("localDataService: Received invalid data format for products.");
            throw new Error("Invalid data format received from local database for products.");
        }

        // Map to Product type, ensuring all required fields are present
        return dbProducts.map((p: any): Product => ({
            id: p.ArtikelNr?.toString() ?? '', // Ensure ID is string and handle null/undefined
            jtl_kArtikel: p.ArtikelNr, // Map jtl_kArtikel from ArtikelNr (assumption)
            name: p.Artikel || '', // Map name from Artikel (assumption)
            description: p.Beschreibung || '', // Map description from Beschreibung (assumption)
            sku: p.cArtNr || '', // Adjust field names based on actual source data
            price: p.Preis || 0,
            barcode: p.cBarcode || '',
            stockLevel: p.fLagerbestand || 0,
            isActive: p.cAktiv === 'Y', // Example mapping
            jtl_dateCreated: p.Erfassungsdatum ? new Date(p.Erfassungsdatum).toLocaleDateString() : '',
        }));
    } catch (error) {
        console.error("Error fetching local products:", error);
        throw error; // Rethrow the error
    }
};
