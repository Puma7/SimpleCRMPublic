"use client"

import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  ChevronDown,
  Plus,
  Search,
  SlidersHorizontal,
  Copy,
  Loader2,
  ArrowUpDown,
  MoreHorizontal,
  Trash2
} from "lucide-react"
import { toast } from "sonner"
import ExportButton from "@/components/export-button"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { getCustomersPage, localDataService } from "@/services/data/localDataService"
import {
  getRendererTransport,
  isCustomerListRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import type { Customer } from "@/services/data/types"
import { AddCustomerDialog } from "@/components/add-customer-dialog"
import { getPrimaryPhone, getPrimaryContact } from "@/lib/contact-utils"
import { SyncStatusDisplay } from "@/components/sync-status-display"
import { DataTablePagination } from "@/components/data-table-pagination"
import { GroupSelector, GroupOption } from "@/components/grouping/group-selector"
import { GroupedList } from "@/components/grouping/grouped-list"
import { customerGroupingFields, groupItemsByField, getCustomFieldGroupingOptions } from "@/lib/grouping"

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  SortingState,
  VisibilityState,
  RowSelectionState,
  PaginationState,
  useReactTable,
} from "@tanstack/react-table"

// Helper function for date formatting (if needed for sync status)
const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return "N/A"
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("de-DE") + ' ' + date.toLocaleTimeString("de-DE");
  } catch (e) {
    return dateString
  }
}

// Define columns outside the component or memoize them
const columns: ColumnDef<Customer>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
        className="translate-y-[2px]"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
        className="translate-y-[2px]"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    // Combined Name Column
    accessorFn: (row) => `${row.firstName || ''} ${row.name}`,
    id: 'fullName', // Explicit ID needed when using accessorFn
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Name
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <Link to="/customers/$customerId" params={{ customerId: row.original.id.toString() }} className="hover:underline font-medium">
        {`${row.original.firstName || ''} ${row.original.name}`}
      </Link>
    ),
  },
  {
    accessorKey: "customerNumber",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Kundennr.
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => row.original.customerNumber || '-',
  },
  {
    accessorKey: "company",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Firma
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => row.original.company || '-',
  },
  {
    accessorKey: "email",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        E-Mail
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
     cell: ({ row }) => row.original.email || '-',
  },
  {
    // Combined Phone Column with proper prioritization
    accessorFn: (row) => getPrimaryPhone(row),
    id: 'contactPhone',
    header: "Telefon",
    cell: ({ row }) => getPrimaryPhone(row.original) || '-',
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Status
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const statusLabels: Record<string, string> = { Active: "Aktiv", Lead: "Lead", Inactive: "Inaktiv" };
      return (
        <Badge variant={row.original.status === "Active" ? "default" : row.original.status === "Lead" ? "secondary" : "outline"}>
          {statusLabels[row.original.status] ?? row.original.status}
        </Badge>
      );
    },
    // Enable filtering on this column
    filterFn: 'equals', // Use built-in 'equals' or a custom function if needed
  },
  {
    accessorKey: "jtl_kKunde",
    id: "jtlCustomerNumber",
    header: "JTL Kundennr.",
    cell: ({ row }) => row.original.jtl_kKunde?.toString() || '-',
  },
  // {
  //   id: "actions",
  //   cell: ({ row }) => {
  //     const customer = row.original;
  //     const copyAffiliateLink = (link?: string) => {
  //       if (link) {
  //         navigator.clipboard.writeText(link);
  //         toast.success("Affiliate-Link kopiert");
  //       } else {
  //         toast.info("Kein Affiliate-Link vorhanden.");
  //       }
  //     };
  //     return customer.affiliateLink ? (
  //       <Button variant="ghost" size="icon" onClick={() => copyAffiliateLink(customer.affiliateLink)} title="Affiliate-Link kopieren" aria-label="Affiliate-Link kopieren">
  //         <Copy className="h-4 w-4" />
  //       </Button>
  //     ) : (
  //       <span className="text-muted-foreground">-</span>
  //     );
  //   },
  //   enableSorting: false,
  //   enableHiding: false,
  // }
];

// German column name mapping for visibility dropdown
const columnDisplayNames: Record<string, string> = {
  'fullName': 'Name',
  'customerNumber': 'Kundennr.',
  'jtlCustomerNumber': 'JTL Kundennr.',
  'company': 'Firma',
  'email': 'E-Mail',
  'contactPhone': 'Telefon',
  'status': 'Status',
  'actions': 'Aktionen'
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [serverEventRefresh, setServerEventRefresh] = useState(0)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const navigate = useNavigate()
  const serverClientMode = getRendererTransport().kind === "http"

  // Grouping state
  const [isGrouped, setIsGrouped] = useState(false)
  const [selectedGrouping, setSelectedGrouping] = useState<string | null>(null)
  const [groupingOptions, setGroupingOptions] = useState<GroupOption[]>([])
  const [availableGroupingFields, setAvailableGroupingFields] = useState<typeof customerGroupingFields>([])

  // React Table State
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [globalFilter, setGlobalFilter] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Initialize grouping options from customerGroupingFields and custom fields
  useEffect(() => {
    const initializeGroupingOptions = async () => {
      try {
        // Get standard grouping options
        const standardOptions = customerGroupingFields.map(field => ({
          value: field.value,
          label: field.label
        }));

        // Get custom field grouping options
        const customFieldGroupings = await getCustomFieldGroupingOptions();
        const customOptions = customFieldGroupings.map(field => ({
          value: field.value,
          label: field.label
        }));

        // Combine standard and custom options
        setGroupingOptions([...standardOptions, ...customOptions]);

        // Add custom field groupings to the available grouping fields
        setAvailableGroupingFields([...customerGroupingFields, ...customFieldGroupings]);
      } catch (error) {
        console.error("Failed to initialize grouping options:", error);
        // Fallback to standard options
        const standardOptions = customerGroupingFields.map(field => ({
          value: field.value,
          label: field.label
        }));
        setGroupingOptions(standardOptions);
        setAvailableGroupingFields(customerGroupingFields);
      }
    };

    initializeGroupingOptions();
  }, []);

  useEffect(() => {
    if (!serverClientMode) return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isCustomerListRefreshEvent(event)) {
          setServerEventRefresh((value) => value + 1)
        }
      },
    })
    return () => subscription.unsubscribe()
  }, [serverClientMode])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextSearch = globalFilter.trim()
      setDebouncedSearch((current) => current === nextSearch ? current : nextSearch)
      setPagination((current) => current.pageIndex === 0 ? current : { ...current, pageIndex: 0 })
    }, 350)

    return () => window.clearTimeout(timeoutId)
  }, [globalFilter])

  const loadCustomers = useCallback(async () => {
    setIsLoading(true)
    const activeSort = sorting[0]
    try {
      const { customers: fetchedCustomers, total } = await getCustomersPage({
        limit: pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
        query: debouncedSearch,
        status: statusFilter ?? null,
        includeCustomFields: false,
        sortBy: activeSort?.id,
        sortDirection: activeSort?.desc ? 'desc' : 'asc',
      })

      setCustomers(fetchedCustomers)
      setTotalCustomers(total)
    } catch (error) {
      console.error("Failed to fetch customers:", error)
      toast.error("Kunden konnten nicht geladen werden.")
      setCustomers([])
      setTotalCustomers(0)
    } finally {
      setIsLoading(false)
    }
  }, [debouncedSearch, pagination.pageIndex, pagination.pageSize, sorting, statusFilter])

  useEffect(() => {
    void loadCustomers()
  }, [loadCustomers, serverEventRefresh])

  const table = useReactTable({
    data: customers,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination,
    },
    onSortingChange: (updaterOrValue) => {
      setSorting((current) => typeof updaterOrValue === 'function' ? updaterOrValue(current) : updaterOrValue)
      setPagination((current) => current.pageIndex === 0 ? current : { ...current, pageIndex: 0 })
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    manualPagination: true,
    manualSorting: true,
    rowCount: totalCustomers,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const copyAffiliateLink = (link?: string) => {
    if (link) {
      navigator.clipboard.writeText(link)
      toast.success("Affiliate-Link in die Zwischenablage kopiert")
    } else {
      toast.info("Kein Affiliate-Link für diesen Kunden vorhanden.")
    }
  }

  const handleCustomerAdded = (newCustomer: Customer) => {
    setCustomers(prev => [newCustomer, ...prev]);
    setTotalCustomers(prev => prev + 1);
    // Optionally reset filters/sorting or navigate
  };

  // Handle bulk delete action
  const handleDeleteSelected = async () => {
    const selectedRows = table.getFilteredSelectedRowModel().rows;
    const selectedIds = selectedRows.map(row => row.original.id);
    if (selectedIds.length === 0) {
      toast.info("Keine Kunden zum Löschen ausgewählt.");
      return;
    }

    try {
      setIsLoading(true); // Indicate processing
      for (const id of selectedIds) {
        await localDataService.deleteCustomer(String(id));
      }

      // Update state after successful deletion
      setCustomers(prev => prev.filter(c => !selectedIds.includes(c.id)));
      setTotalCustomers(prev => Math.max(0, prev - selectedIds.length));
      table.resetRowSelection(); // Clear selection
      toast.success(`${selectedIds.length} Kunde(n) gelöscht.`);
    } catch (error) {
      console.error("Failed to delete selected customers:", error);
      toast.error("Fehler beim Löschen der ausgewählten Kunden.");
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <main className="flex-1">
      <div className="px-6 py-4">
        <h1 className="text-2xl font-bold mb-4">Kunden</h1>
          {/* Toolbar: Search, Filters, Actions */}
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <SyncStatusDisplay />
            {/* Global Search */}
            <div className="relative flex-1 min-w-[250px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Kunden suchen..."
                className="pl-8 w-full"
                value={globalFilter ?? ''}
                onChange={(e) => {
                  setGlobalFilter(e.target.value)
                  table.resetRowSelection()
                }}
              />
            </div>

            {/* Grouping Selector */}
            <GroupSelector
              options={groupingOptions}
              selectedGrouping={selectedGrouping}
              isGrouped={isGrouped}
              onGroupingChange={setSelectedGrouping}
              onToggleGrouping={setIsGrouped}
            />

            {/* Status Filter */}
            {(() => {
              const statusLabels: Record<string, string> = { Active: 'Aktiv', Lead: 'Lead', Inactive: 'Inaktiv' }
              const currentFilter = statusFilter
              const applyStatusFilter = (value: string | undefined) => {
                setStatusFilter(value)
                setPagination((current) => ({ ...current, pageIndex: 0 }))
                table.resetRowSelection()
              }
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <SlidersHorizontal className="mr-2 h-4 w-4" />
                      Statusfilter ({currentFilter ? (statusLabels[currentFilter] ?? currentFilter) : 'Alle'})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => applyStatusFilter(undefined)}>Alle</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyStatusFilter('Active')}>Aktiv</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyStatusFilter('Lead')}>Lead</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyStatusFilter('Inactive')}>Inaktiv</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            })()}

             {/* Column Visibility Toggle */}
             <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="ml-auto hidden sm:flex">
                    Spaltenauswahl <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {table
                    .getAllColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => {
                        return (
                        <DropdownMenuCheckboxItem
                            key={column.id}
                            className="capitalize"
                            checked={column.getIsVisible()}
                            onCheckedChange={(value) => column.toggleVisibility(!!value)}
                        >
                            {columnDisplayNames[column.id] || column.id}
                        </DropdownMenuCheckboxItem>
                        )
                    })}
                </DropdownMenuContent>
            </DropdownMenu>

            <ExportButton data={customers} fileName="customers_export.json">
              Exportieren
            </ExportButton>
            <AddCustomerDialog onCustomerAdded={handleCustomerAdded} />
          </div>

           {/* Bulk Actions Bar (appears when rows are selected) */}
           {table.getFilteredSelectedRowModel().rows.length > 0 && (
             <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted p-2">
                <span className="text-sm font-medium">
                    {table.getFilteredSelectedRowModel().rows.length} von{" "}
                    {table.getFilteredRowModel().rows.length} Zeile(n) ausgewählt.
                </span>
                <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setIsDeleteConfirmOpen(true)}
                    disabled={isLoading}
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Ausgewählte löschen
                </Button>
             </div>
           )}
           <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
             <AlertDialogContent>
               <AlertDialogHeader>
                 <AlertDialogTitle>Kunden löschen?</AlertDialogTitle>
                 <AlertDialogDescription>
                   Sie sind dabei, {table.getFilteredSelectedRowModel().rows.length} Kunden zu löschen. Diese Aktion kann nicht rückgängig gemacht werden.
                 </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                 <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                 <AlertDialogAction
                   onClick={handleDeleteSelected}
                   className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                 >
                   Löschen
                 </AlertDialogAction>
               </AlertDialogFooter>
             </AlertDialogContent>
           </AlertDialog>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Kundenliste</CardTitle>
            <CardDescription>
              {isLoading
                ? "Lade Kunden..."
                : ` ${customers.length} von ${totalCustomers.toLocaleString("de-DE")} Kunden angezeigt${isGrouped && selectedGrouping ? ` (aktuelle Seite gruppiert nach: ${availableGroupingFields.find(f => f.value === selectedGrouping)?.label || selectedGrouping})` : ''}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && table.getRowModel().rows.length === 0 ? ( // Show loader only if no data is displayed yet
              <div className="flex justify-center items-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2">Lade Daten...</span>
              </div>
            ) : isGrouped && selectedGrouping ? (
              // Grouped view
              <div className="mt-4">
                <GroupedList
                  groups={groupItemsByField(table.getFilteredRowModel().rows.map(row => row.original), selectedGrouping, availableGroupingFields)}
                  renderItem={(customer) => (
                    <div className="border-b py-2 px-4 hover:bg-muted/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <Link to="/customers/$customerId" params={{ customerId: customer.id.toString() }} className="font-medium hover:underline">
                            {`${customer.firstName || ''} ${customer.name}`}
                          </Link>
                          <div className="text-sm text-muted-foreground">
                            {customer.company ? `${customer.company} • ` : ''}
                            {getPrimaryContact(customer)}
                          </div>
                        </div>
                        <Badge variant={customer.status === "Active" ? "default" : customer.status === "Lead" ? "secondary" : "outline"}>
                          {customer.status}
                        </Badge>
                      </div>
                    </div>
                  )}
                  keyExtractor={(customer) => customer.id}
                  groupHeaderClassName="mb-2"
                  groupContentClassName="mb-4 space-y-1 pl-8"
                />
              </div>
            ) : (
              // Regular table view
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id} colSpan={header.colSpan}>
                              {header.isPlaceholder
                                ? null
                                : flexRender(
                                    header.column.columnDef.header,
                                    header.getContext()
                                  )}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                          <TableRow
                            key={row.id}
                            data-state={row.getIsSelected() && "selected"}
                            className="cursor-pointer"
                            onClick={() => navigate({ to: '/customers/$customerId', params: { customerId: row.original.id.toString() } })}
                          >
                            {row.getVisibleCells().map((cell) => (
                              <TableCell
                                key={cell.id}
                                onClick={cell.column.id === 'select' || cell.column.id === 'actions' ? (e) => e.stopPropagation() : undefined}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={columns.length} className="h-24 text-center">
                            {isLoading ? "Lade..." : "Keine Kunden gefunden."}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                {/* Pagination */}
                <div className="py-4">
                  <DataTablePagination table={table} />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
