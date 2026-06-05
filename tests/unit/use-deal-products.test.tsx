import { renderHook, waitFor } from '@testing-library/react';
import { useDealProducts } from '@/hooks/useDealProducts';
import { IPCChannels } from '@shared/ipc/channels';

const toastMock = jest.fn();
const handleApiErrorMock = jest.fn();
const mockInvokeRenderer = jest.fn();

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

jest.mock('@/lib/api-error-handler', () => ({
  handleApiError: (...args: unknown[]) => handleApiErrorMock(...args),
}));

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
}));

describe('useDealProducts', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
    toastMock.mockReset();
    handleApiErrorMock.mockReset();
  });

  test('loads deal products on mount', async () => {
    mockInvokeRenderer.mockResolvedValueOnce([{ deal_product_id: 1, quantity: 2, price_at_time_of_adding: 10 }]);
    const onProductsChange = jest.fn();

    const { result } = renderHook(() => useDealProducts(5, onProductsChange));

    await waitFor(() => {
      expect(result.current.dealProducts).toHaveLength(1);
    });

    expect(mockInvokeRenderer).toHaveBeenCalledWith(IPCChannels.Deals.GetProducts, 5);
    expect(onProductsChange).toHaveBeenCalledWith([{ deal_product_id: 1, quantity: 2, price_at_time_of_adding: 10 }]);
  });

  test('adds product and refreshes list on success', async () => {
    mockInvokeRenderer
      .mockResolvedValueOnce([]) // initial fetch
      .mockResolvedValueOnce({ success: true }) // add
      .mockResolvedValueOnce([{ deal_product_id: 2, quantity: 1, price_at_time_of_adding: 20 }]); // refresh

    const { result } = renderHook(() => useDealProducts(7));
    await waitFor(() => expect(result.current.isProductsLoading).toBe(false));

    const success = await result.current.handleAddProductToDeal(3, 1, 20);
    expect(success).toBe(true);
    expect(mockInvokeRenderer).toHaveBeenCalledWith(IPCChannels.Deals.AddProduct, {
      dealId: 7,
      productId: 3,
      quantity: 1,
      price: 20,
    });
  });

  test('validates invalid update values locally', async () => {
    mockInvokeRenderer.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useDealProducts(9));
    await waitFor(() => expect(result.current.isProductsLoading).toBe(false));

    await result.current.handleUpdateDealProduct(1, 0, -1);
    expect(toastMock).toHaveBeenCalled();
  });
});
