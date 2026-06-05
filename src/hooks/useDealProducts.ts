// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { DealProductLink } from '@/types';
import { handleApiError } from '@/lib/api-error-handler';
import { IPCChannels } from '@shared/ipc/channels';
import { invokeRenderer } from '@/services/transport';

export function useDealProducts(dealId: number | undefined, onProductsChange?: (products: DealProductLink[]) => void) {
  const { toast } = useToast(); // Keep for success toasts
  const [dealProducts, setDealProducts] = useState<DealProductLink[]>([]);
  const [isProductsLoading, setIsProductsLoading] = useState<boolean>(false);
  const [productsError, setProductsError] = useState<string | null>(null);

  const fetchDealProducts = useCallback(async () => {
    if (!dealId) {
      setDealProducts([]);
      setIsProductsLoading(false);
      setProductsError(null);
      return;
    }

    setIsProductsLoading(true);
    setProductsError(null);
    try {
      const products = await invokeRenderer(
        IPCChannels.Deals.GetProducts,
        dealId
      );
      const productsArray = products || [];
      setDealProducts(productsArray);
      if (onProductsChange) {
        onProductsChange(productsArray);
      }
    } catch (err: any) {
      handleApiError(err, "Produkte laden");
      setProductsError(err.message || "Fehler beim Laden der Produkte.");
      setDealProducts([]);
    } finally {
      setIsProductsLoading(false);
    }
  }, [dealId, onProductsChange]);

  useEffect(() => {
    fetchDealProducts();
  }, [fetchDealProducts]);

  const handleAddProductToDeal = async (productId: number, quantity: number, price: number): Promise<boolean> => {
    if (!dealId) {
      toast({ variant: "destructive", title: "Fehler", description: "Deal ID nicht gefunden." });
      return false;
    }

    try {
      const result = await invokeRenderer(
        IPCChannels.Deals.AddProduct,
        { dealId, productId, quantity, price }
      );
      if (result.success) {
        toast({ title: "Erfolg", description: "Produkt erfolgreich zum Deal hinzugefuegt." });
        fetchDealProducts();
        return true;
      }

      handleApiError(result.error || "Unbekannter Fehler", "Produkt hinzufuegen", "Produkt konnte nicht hinzugefuegt werden.");
      return false;
    } catch (error: any) {
      handleApiError(error, "Produkt hinzufuegen", "Produkt konnte nicht hinzugefuegt werden.");
      return false;
    }
  };

  const handleUpdateDealProduct = async (dealProductId: number, newQuantity: number, newPrice: number): Promise<void> => {
    if (newQuantity <= 0 || newPrice < 0) {
      toast({ variant: "destructive", title: "Ungueltige Eingabe", description: "Menge muss groesser 0 und Preis darf nicht negativ sein." });
      fetchDealProducts();
      return;
    }

    try {
      const result = await invokeRenderer(
        IPCChannels.Deals.UpdateProduct,
        { dealProductId, quantity: newQuantity, price: newPrice }
      );
      if (result.success) {
        toast({ title: "Aktualisiert", description: "Produkt im Deal aktualisiert." });
        fetchDealProducts();
      } else {
        handleApiError(result.error, "Produkt aktualisieren", "Produkt konnte nicht aktualisiert werden.");
        fetchDealProducts();
      }
    } catch (error: any) {
      handleApiError(error, "Produkt aktualisieren", "Produkt konnte nicht aktualisiert werden.");
      fetchDealProducts();
    }
  };

  const handleRemoveDealProduct = async (dealProductId: number): Promise<void> => {
    try {
      const result = await invokeRenderer(
        IPCChannels.Deals.RemoveProduct,
        { dealProductId }
      );
      if (result.success) {
        toast({ title: "Entfernt", description: "Produkt aus Deal entfernt." });
        fetchDealProducts();
      } else {
        handleApiError(result.error, "Produkt entfernen", "Produkt konnte nicht entfernt werden.");
      }
    } catch (error: any) {
      handleApiError(error, "Produkt entfernen", "Produkt konnte nicht entfernt werden.");
    }
  };

  return {
    dealProducts,
    isProductsLoading,
    productsError,
    fetchDealProducts,
    handleAddProductToDeal,
    handleUpdateDealProduct,
    handleRemoveDealProduct,
  };
}
