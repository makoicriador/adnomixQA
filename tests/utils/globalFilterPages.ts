import { FilterPageConfig } from '../../pages/GlobalFilterDrawer';

/**
 * Every page reachable from https://adxmanager.dev/v2/home confirmed live
 * (2026-09-18) to expose a `[data-kt-drawer-toggle$="-index-drawer"]` Filter
 * button — the same drawer + Alpine.js mechanics as
 * `data-kt-drawer-toggle="#form-dashboard-index-drawer"` on the Dashboard.
 * Crawled site-wide rather than assumed to be limited to Service Providers;
 * 24 pages matched out of ~36 candidates reachable from the sidebar (tool
 * pages like SKU Converter/Carton Resizer, and a handful of report/admin
 * pages like Adjustments/Payables/Templates, have no list view and
 * correctly have no Filter button at all).
 *
 * Each entry's `paramName`/`optionValue` is the exact live `name`/`value` of
 * a real control on that page (read from the DOM, not guessed);
 * `optionLabel` is the exact visible text a user would click. Picked as the
 * *first* real filter control on each page — this suite tests the shared
 * Filter mechanism itself, not each page's business-specific filtering
 * semantics (several Service Providers pages already have deeper,
 * page-specific filter coverage in their own suites).
 */
export const FILTER_PAGES: FilterPageConfig[] = [
  { name: 'Dashboard', path: '/v2/home', drawerId: '#form-dashboard-index-drawer', controlType: 'checkbox', paramName: 'filters[product_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'All Inventory', path: '/v2/inventory/all', drawerId: '#form-all-inventory-index-drawer', controlType: 'checkbox', paramName: 'filters[product_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Orders', path: '/v2/orders', drawerId: '#form-orders-index-drawer', controlType: 'checkbox', paramName: 'filters[order_status][]', optionLabel: 'Pending Approval', optionValue: 'pa' },
  { name: 'Shipments', path: '/v2/shipments', drawerId: '#form-shipments-index-drawer', controlType: 'checkbox', paramName: 'filters[status][]', optionLabel: 'Active', optionValue: 'active' },
  { name: 'Ready To Ship', path: '/v2/ready-to-ship', drawerId: '#form-ready-to-ship-index-drawer', controlType: 'checkbox', paramName: 'filters[rts_type][]', optionLabel: 'Ready to Ship', optionValue: 'rts' },
  { name: 'Warehouses Inventory', path: '/v2/inventory-warehouses', drawerId: '#form-inventory-warehouses-index-drawer', controlType: 'select', paramName: 'filters[brand_id][]', optionLabel: 'QA Test Brand', optionValue: '11' },
  { name: 'All Products', path: '/v2/products', drawerId: '#form-products-index-drawer', controlType: 'checkbox', paramName: 'filters[product_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Brands', path: '/v2/brands', drawerId: '#form-brands-index-drawer', controlType: 'checkbox', paramName: 'filters[brand_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Categories', path: '/v2/categories', drawerId: '#form-categories-index-drawer', controlType: 'checkbox', paramName: 'filters[category_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Suppliers', path: '/v2/service-providers/suppliers', drawerId: '#form-suppliers-index-drawer', controlType: 'checkbox', paramName: 'filters[supplier_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Freight Forwarders', path: '/v2/service-providers/freight-forwarders', drawerId: '#form-freight-forwarders-index-drawer', controlType: 'checkbox', paramName: 'filters[aistatus][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Customs Brokers', path: '/v2/service-providers/customs-brokers', drawerId: '#form-customs-brokers-index-drawer', controlType: 'checkbox', paramName: 'filters[customs_broker_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Warehouses', path: '/v2/service-providers/warehouses', drawerId: '#form-warehouses-index-drawer', controlType: 'checkbox', paramName: 'filters[warehouse_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Sales', path: '/v2/reports/sales', drawerId: '#form-sales-overview-index-drawer', controlType: 'checkbox', paramName: 'filters[ad_type][]', optionLabel: 'Sponsored Product', optionValue: 'sp' },
  { name: 'Sales Transactions', path: '/v2/reports/sales-transactions', drawerId: '#form-sales-transactions-index-drawer', controlType: 'select', paramName: 'filters[account]', optionLabel: 'AquaBliss', optionValue: 'AZG0W4CL9R77E' },
  { name: 'Order Payments', path: '/v2/reports/order-payments', drawerId: '#form-order-payments-index-drawer', controlType: 'checkbox', paramName: 'filters[balance]', optionLabel: 'All', optionValue: 'all' },
  { name: 'Export Sales', path: '/v2/reports/export-sales', drawerId: '#form-export-sales-index-drawer', controlType: 'checkbox', paramName: 'filters[balance]', optionLabel: 'All', optionValue: 'all' },
  { name: 'Warehousing Costs', path: '/v2/reports/warehousing-costs', drawerId: '#form-warehousing-costs-index-drawer', controlType: 'checkbox', paramName: 'filters[warehouse_cost_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Stock Transfers', path: '/v2/reports/stock-transfers', drawerId: '#form-stock-transfers-index-drawer', controlType: 'checkbox', paramName: 'filters[transfer_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Inventory Value', path: '/v2/reports/inventory-values', drawerId: '#form-inventory-values-index-drawer', controlType: 'select', paramName: 'filters[brand_id][]', optionLabel: 'QA Test Brand', optionValue: '11' },
  { name: 'Corporations', path: '/v2/settings/corporations', drawerId: '#form-corporations-index-drawer', controlType: 'checkbox', paramName: 'filters[corporation_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Integrations', path: '/v2/settings/integrations', drawerId: '#form-integrations-index-drawer', controlType: 'checkbox', paramName: 'filters[integration_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Users', path: '/v2/settings/users', drawerId: '#form-users-index-drawer', controlType: 'checkbox', paramName: 'filters[user_status][]', optionLabel: 'Active', optionValue: 'Active' },
  { name: 'Error Logs', path: '/v2/settings/error-log', drawerId: '#form-error-log-index-drawer', controlType: 'select', paramName: 'filters[module_id][]', optionLabel: 'Adjustment Transfer', optionValue: '26' },
];

/**
 * Pages crawled (from the sidebar's full set of links) and confirmed to have
 * NO Filter button — recorded so a future re-crawl can diff against this
 * list rather than re-discovering it from scratch: Adjustments, 3PL
 * Inventory Health, Customer Returns, Order Replacement, SKU Converter,
 * Carton Resizer, Product Disposal, Product Identifiers, Accounts
 * Dashboard, Payables, Payment Queue, Payment History, Templates, FBA Fee &
 * Commission, Duty.
 */
