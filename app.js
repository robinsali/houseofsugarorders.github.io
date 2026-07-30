/**
 * app.js - House of Sugar Order & Expense Tracker
 * Core Business Logic, State Engine, and Charts
 */

// Application State Namespace
const app = {
  // Database Tables
  orders: [],
  expenses: [],
  customers: [],
  inventory: [],
  expenseCategories: [],
  inventoryCategories: [],
  settings: {},

  // UI Navigation & Filters
  activeTab: 'dashboard',
  currentDate: new Date(2025, 6, 31), // Seed base date: July 31, 2025
  calendarDate: new Date(2025, 7, 1), // Calendar start: August 2025

  // Dashboard Period Filter ('today', 'week', 'month', 'year')
  dashboardPeriod: 'today',

  // Dashboard Mini-Calendar Date selectors
  miniCalDate: new Date(2025, 6, 1), // July 2025
  miniCalSelectedDayStr: '2025-07-31', // Seed selected day

  // Charts references
  charts: {
    salesOverview: null,
    expenseSummary: null,
    reportsMain: null
  },

  // Pagination states
  pagination: {
    orders: { current: 1, limit: 5 },
    expenses: { current: 1, limit: 5 },
    customers: { current: 1, limit: 5 },
    inventory: { current: 1, limit: 6 },
    payments: { current: 1, limit: 5 }
  },

  // ----------------------------------------------------
  // INITIALIZATION & DATA SEEDING
  // ----------------------------------------------------
  init() {
    this.loadState();

    if (this.orders.length === 0) {
      this.seedDatabase();
    }

    this.setupEventListeners();
    this.switchTab('dashboard');
    this.updateGlobalHeader();
    this.initGoogleDrive();

    // Initialise Lucide icons
    lucide.createIcons();
  },

  // Load state from localStorage
  loadState() {
    try {
      this.orders = JSON.parse(localStorage.getItem('hos_orders')) || [];
      this.expenses = JSON.parse(localStorage.getItem('hos_expenses')) || [];
      this.customers = JSON.parse(localStorage.getItem('hos_customers')) || [];
      this.inventory = JSON.parse(localStorage.getItem('hos_inventory')) || [];
      this.expenseCategories = JSON.parse(localStorage.getItem('hos_expense_categories')) || [];
      this.inventoryCategories = JSON.parse(localStorage.getItem('hos_inventory_categories')) || [];
      this.settings = JSON.parse(localStorage.getItem('hos_settings')) || {};

      const theme = localStorage.getItem('hos_theme') || 'light';
      document.documentElement.setAttribute('data-theme', theme);
    } catch (e) {
      console.error("Error loading localStorage state:", e);
    }
  },

  // Save state to localStorage
  saveState() {
    try {
      localStorage.setItem('hos_orders', JSON.stringify(this.orders));
      localStorage.setItem('hos_expenses', JSON.stringify(this.expenses));
      localStorage.setItem('hos_customers', JSON.stringify(this.customers));
      localStorage.setItem('hos_inventory', JSON.stringify(this.inventory));
      localStorage.setItem('hos_expense_categories', JSON.stringify(this.expenseCategories));
      localStorage.setItem('hos_inventory_categories', JSON.stringify(this.inventoryCategories));
      localStorage.setItem('hos_settings', JSON.stringify(this.settings));
    } catch (e) {
      console.error("Error saving localStorage state:", e);
    }
  },

  // ----------------------------------------------------
  // GOOGLE DRIVE SYNC ENGINE (OAuth — no API key needed)
  // ----------------------------------------------------
  // Replace the placeholder below with your OAuth 2.0 Client ID from Google Cloud Console.
  // The Client ID is safe to commit publicly — it is NOT a secret.
  // Setup guide: see walkthrough.md in the project documentation.
  GOOGLE_CLIENT_ID: '186068315207-7ceuk54pdnfdp0pdhk3qlil890gs1n1d.apps.googleusercontent.com',
  DRIVE_FILE_NAME: 'house-of-sugar-data.json',

  driveFileId: null,
  isCloudSynced: false,
  accessToken: null,
  tokenClient: null,
  saveDriveTimer: null,

  initGoogleDrive() {
    // Restore cached OAuth token if still valid
    try {
      const cached = JSON.parse(localStorage.getItem('hos_drive_token') || 'null');
      if (cached && cached.expires_at > Date.now()) {
        this.accessToken = cached.token;
        this.updateSignInUI(true);
        this.loadFromDrive();
        return;
      }
    } catch (e) { }
    localStorage.removeItem('hos_drive_token');

    // Wait for Google Identity Services to load, then show sign-in prompt
    const waitForGIS = () => {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        this.updateCloudStatus(false, 'Drive: Sign In Required');
        this.updateSignInUI(false);
      } else {
        setTimeout(waitForGIS, 300);
      }
    };
    waitForGIS();
  },

  _getTokenClient() {
    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: (tokenResponse) => {
          if (tokenResponse.error) {
            console.warn('Google OAuth error:', tokenResponse.error);
            this.updateCloudStatus(false, 'Drive: Auth Failed');
            return;
          }
          this.accessToken = tokenResponse.access_token;
          const expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
          localStorage.setItem('hos_drive_token', JSON.stringify({
            token: this.accessToken,
            expires_at: expiresAt
          }));
          this.updateSignInUI(true);
          this.loadFromDrive();
        }
      });
    }
    return this.tokenClient;
  },

  handleSignIn() {
    if (typeof google === 'undefined' || !google.accounts) {
      alert('Google services are still loading. Please try again in a moment.');
      return;
    }
    this._getTokenClient().requestAccessToken({ prompt: '' });
  },

  handleSignOut() {
    if (this.accessToken) {
      google.accounts.oauth2.revoke(this.accessToken, () => { });
    }
    this.accessToken = null;
    this.driveFileId = null;
    this.tokenClient = null;
    localStorage.removeItem('hos_drive_token');
    this.updateSignInUI(false);
    this.updateCloudStatus(false, 'Drive: Signed Out');
  },

  updateSignInUI(isSignedIn) {
    // Header buttons
    const signInBtn = document.getElementById('btn-google-signin');
    const signOutBtn = document.getElementById('btn-google-signout');
    // Settings page buttons
    const settingsSignIn = document.getElementById('btn-google-signin-settings');
    const settingsSyncNow = document.getElementById('btn-drive-sync-now');
    const settingsReload = document.getElementById('btn-drive-reload');
    const settingsSignOut = document.getElementById('btn-google-signout-settings');

    if (signInBtn) signInBtn.style.display = isSignedIn ? 'none' : '';
    if (signOutBtn) signOutBtn.style.display = isSignedIn ? '' : 'none';
    if (settingsSignIn) settingsSignIn.style.display = isSignedIn ? 'none' : '';
    if (settingsSyncNow) settingsSyncNow.style.display = isSignedIn ? '' : 'none';
    if (settingsReload) settingsReload.style.display = isSignedIn ? '' : 'none';
    if (settingsSignOut) settingsSignOut.style.display = isSignedIn ? '' : 'none';
  },

  updateCloudStatus(isLive, text) {
    const dot = document.querySelector('#cloud-sync-status .status-dot');
    const label = document.getElementById('cloud-sync-text');
    if (dot) {
      dot.classList.toggle('online', isLive);
      dot.classList.toggle('offline', !isLive);
    }
    if (label) label.textContent = text;
    this.isCloudSynced = isLive;
  },

  async loadFromDrive() {
    if (!this.accessToken) return;
    try {
      this.updateCloudStatus(false, 'Drive: Loading...');

      // Search for existing data file in app's private folder
      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'${this.DRIVE_FILE_NAME}'&fields=files(id%2Cname)`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      if (listRes.status === 401) throw { status: 401 };
      if (!listRes.ok) throw { status: listRes.status };

      const listData = await listRes.json();

      if (listData.files && listData.files.length > 0) {
        this.driveFileId = listData.files[0].id;

        // Download file content
        const fileRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${this.driveFileId}?alt=media`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } }
        );
        if (fileRes.status === 401) throw { status: 401 };
        if (!fileRes.ok) throw { status: fileRes.status };

        const data = await fileRes.json();

        // Merge Drive data into app state
        if (data.orders) this.orders = data.orders;
        if (data.expenses) this.expenses = data.expenses;
        if (data.customers) this.customers = data.customers;
        if (data.inventory) this.inventory = data.inventory;
        if (data.expenseCategories) this.expenseCategories = data.expenseCategories;
        if (data.inventoryCategories) this.inventoryCategories = data.inventoryCategories;
        if (data.settings) this.settings = data.settings;

        // Update localStorage cache & refresh UI
        this.saveState();
        this.refreshActiveTabTable();
        if (this.activeTab === 'dashboard') this.renderDashboard();

        this.updateCloudStatus(true, 'Drive: Live ✓');
      } else {
        // No file yet — push current local data to Drive for the first time
        await this.saveToDriveNow();
      }
    } catch (err) {
      console.warn('Drive load error:', err);
      if (err.status === 401) {
        this.accessToken = null;
        localStorage.removeItem('hos_drive_token');
        this.updateSignInUI(false);
        this.updateCloudStatus(false, 'Drive: Session Expired — Sign In Again');
      } else {
        this.updateCloudStatus(false, 'Drive: Sync Error (using local cache)');
      }
    }
  },

  // Debounced save — auto-triggered 2s after any data change
  saveToDrive() {
    clearTimeout(this.saveDriveTimer);
    this.saveDriveTimer = setTimeout(() => this.saveToDriveNow(), 2000);
  },

  // Immediate save to Google Drive (full snapshot)
  async saveToDriveNow() {
    if (!this.accessToken) return;
    try {
      this.updateCloudStatus(false, 'Drive: Saving...');
      const content = JSON.stringify({
        orders: this.orders,
        expenses: this.expenses,
        customers: this.customers,
        inventory: this.inventory,
        expenseCategories: this.expenseCategories,
        inventoryCategories: this.inventoryCategories,
        settings: this.settings,
        lastSaved: new Date().toISOString()
      });

      let res;
      if (this.driveFileId) {
        // Update existing file (simple media upload)
        res = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${this.driveFileId}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json'
            },
            body: content
          }
        );
      } else {
        // Create new file with metadata in appDataFolder (multipart upload)
        const form = new FormData();
        form.append('metadata', new Blob(
          [JSON.stringify({ name: this.DRIVE_FILE_NAME, parents: ['appDataFolder'] })],
          { type: 'application/json' }
        ));
        form.append('file', new Blob([content], { type: 'application/json' }));
        res = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.accessToken}` },
            body: form
          }
        );
        if (res.ok) {
          const created = await res.json();
          this.driveFileId = created.id;
        }
      }

      if (res.status === 401) throw { status: 401 };
      if (!res.ok) throw { status: res.status };

      this.updateCloudStatus(true, 'Drive: Saved ✓');
      setTimeout(() => {
        if (this.isCloudSynced) this.updateCloudStatus(true, 'Drive: Live ✓');
      }, 2000);
    } catch (err) {
      console.warn('Drive save error:', err);
      if (err.status === 401) {
        this.accessToken = null;
        localStorage.removeItem('hos_drive_token');
        this.updateSignInUI(false);
        this.updateCloudStatus(false, 'Drive: Session Expired — Sign In Again');
      } else {
        this.updateCloudStatus(false, 'Drive: Save Failed (local cache ok)');
      }
    }
  },

  // Kept for backward compatibility (called by settings button)
  syncToDriveNow() {
    return this.saveToDriveNow();
  },

  // Seed default data matching user's screenshots
  seedDatabase() {
    // Categories
    this.expenseCategories = ['Ingredients', 'Packaging', 'Utilities', 'Marketing', 'Delivery', 'Rent'];
    this.inventoryCategories = ['Ingredients', 'Packaging', 'Equipment', 'Others'];

    // Settings
    this.settings = {
      businessName: 'House of Sugar',
      email: 'hello@houseofsugar.ca',
      phone: '(647) 123-4567',
      address: 'Toronto, Ontario, Canada',
      currency: 'CAD',
      timezone: 'EST'
    };

    // Customers
    this.customers = [
      { id: 'CUST-1', name: 'Sarah Johnson', phone: '(416) 555-1234', email: 'sarah@gmail.com', totalOrders: 5, totalSpent: 450.00, lastOrder: '2025-07-31' },
      { id: 'CUST-2', name: 'Emily Davis', phone: '(647) 555-5678', email: 'emily@gmail.com', totalOrders: 3, totalSpent: 280.00, lastOrder: '2025-07-31' },
      { id: 'CUST-3', name: 'Michael Lee', phone: '(647) 555-9012', email: 'michael@gmail.com', totalOrders: 4, totalSpent: 320.00, lastOrder: '2025-07-31' },
      { id: 'CUST-4', name: 'Priya Sharma', phone: '(416) 555-3456', email: 'priya@gmail.com', totalOrders: 6, totalSpent: 560.00, lastOrder: '2025-07-31' },
      { id: 'CUST-5', name: 'David Wilson', phone: '(647) 555-7890', email: 'david@gmail.com', totalOrders: 2, totalSpent: 90.00, lastOrder: '2025-07-31' }
    ];

    // Orders
    // Set some dates relative to current date (July 31, 2025)
    this.orders = [
      {
        id: 'HS-2025-071',
        customerName: 'Sarah Johnson',
        customerPhone: '(416) 555-1234',
        customerEmail: 'sarah@gmail.com',
        items: 'Floral Cupcakes (12) - Vanilla',
        pickupDate: '2025-07-31T12:00',
        amount: 65.00,
        paymentStatus: 'Paid',
        orderStatus: 'Ready',
        notes: 'Vanilla flavor, light pink icing.'
      },
      {
        id: 'HS-2025-072',
        customerName: 'Emily Davis',
        customerPhone: '(647) 555-5678',
        customerEmail: 'emily@gmail.com',
        items: 'Birthday Cake (2.5kg) - Chocolate',
        pickupDate: '2025-07-31T15:00',
        amount: 120.00,
        paymentStatus: 'Deposit Paid',
        orderStatus: 'In Progress',
        notes: 'Write "Happy 10th Birthday Chloe!" on top.'
      },
      {
        id: 'HS-2025-073',
        customerName: 'Michael Lee',
        customerPhone: '(647) 555-9012',
        customerEmail: 'michael@gmail.com',
        items: 'Cookies (24 pcs) - Chocolate Chip',
        pickupDate: '2025-07-31T16:00',
        amount: 40.00,
        paymentStatus: 'Paid',
        orderStatus: 'Confirmed',
        notes: 'Wrap in luxury ribbons.'
      },
      {
        id: 'HS-2025-074',
        customerName: 'Priya Sharma',
        customerPhone: '(416) 555-3456',
        customerEmail: 'priya@gmail.com',
        items: 'Floral Cupcake Bouquet - Pink Theme',
        pickupDate: '2025-08-01T11:00',
        amount: 75.00,
        paymentStatus: 'Deposit Paid',
        orderStatus: 'Confirmed',
        notes: 'Bouquet arrangement of cupcakes.'
      },
      {
        id: 'HS-2025-075',
        customerName: 'David Wilson',
        customerPhone: '(647) 555-7890',
        customerEmail: 'david@gmail.com',
        items: 'Brownies (16 pcs) - Fudgy',
        pickupDate: '2025-08-01T14:00',
        amount: 45.00,
        paymentStatus: 'Unpaid',
        orderStatus: 'Inquiry',
        notes: 'Inquiry only, draft order.'
      },
      // Added older completed orders to bootstrap reports stats
      { id: 'HB-2025-060', customerName: 'Sarah Johnson', customerPhone: '(416) 555-1234', customerEmail: 'sarah@gmail.com', items: 'Custom Cupcakes x6', pickupDate: '2025-07-28T10:00', amount: 50.00, paymentStatus: 'Paid', orderStatus: 'Completed', notes: '' },
      { id: 'HB-2025-061', customerName: 'Emily Davis', customerPhone: '(647) 555-5678', customerEmail: 'emily@gmail.com', items: 'Red Velvet Cake', pickupDate: '2025-07-25T11:00', amount: 90.00, paymentStatus: 'Paid', orderStatus: 'Completed', notes: '' },
      { id: 'HB-2025-062', customerName: 'Priya Sharma', customerPhone: '(416) 555-3456', customerEmail: 'priya@gmail.com', items: 'Rose Cupcakes x12', pickupDate: '2025-07-24T12:00', amount: 80.00, paymentStatus: 'Paid', orderStatus: 'Completed', notes: '' },
      { id: 'HB-2025-063', customerName: 'Michael Lee', customerPhone: '(647) 555-9012', customerEmail: 'michael@gmail.com', items: 'Chocolate Brownies x12', pickupDate: '2025-07-23T14:00', amount: 35.00, paymentStatus: 'Paid', orderStatus: 'Completed', notes: '' },
      { id: 'HB-2025-064', customerName: 'Priya Sharma', customerPhone: '(416) 555-3456', customerEmail: 'priya@gmail.com', items: 'Birthday Cake 1.5kg', pickupDate: '2025-07-20T10:00', amount: 75.00, paymentStatus: 'Paid', orderStatus: 'Completed', notes: '' }
    ];

    // Seed more orders for calendar/reporting (adding up to 28 total orders as in donut chart)
    for (let i = 1; i <= 18; i++) {
      const customersList = this.customers;
      const cust = customersList[Math.floor(Math.random() * customersList.length)];
      const amount = [35.00, 45.00, 75.00, 90.00, 110.00, 150.00][Math.floor(Math.random() * 6)];
      const status = ['Completed', 'Completed', 'Completed', 'Confirmed', 'In Progress', 'Ready'][Math.floor(Math.random() * 6)];
      const payStatus = status === 'Completed' ? 'Paid' : (Math.random() > 0.5 ? 'Deposit Paid' : 'Unpaid');

      // Random dates in July 2025
      const day = Math.floor(Math.random() * 28) + 1;
      const dateStr = `2025-07-${day < 10 ? '0' + day : day}T12:00`;

      this.orders.push({
        id: `HS-2025-0${5 + i}`,
        customerName: cust.name,
        customerPhone: cust.phone,
        customerEmail: cust.email,
        items: 'Assorted Bakery Products',
        pickupDate: dateStr,
        amount: amount,
        paymentStatus: payStatus,
        orderStatus: status,
        notes: 'Generated seed order.'
      });
    }

    // Expenses
    this.expenses = [
      { id: 'EXP-1', date: '2025-07-31', category: 'Ingredients', item: 'Flour (10kg)', amount: 35.00, method: 'Cash', notes: 'Wholesale Baker supplier' },
      { id: 'EXP-2', date: '2025-07-31', category: 'Ingredients', item: 'Butter (2kg)', amount: 42.50, method: 'Cash', notes: 'Local store purchase' },
      { id: 'EXP-3', date: '2025-07-31', category: 'Packaging', item: 'Cake Boxes (10)', amount: 18.00, method: 'Cash', notes: 'Supplier delivery' },
      { id: 'EXP-4', date: '2025-07-31', category: 'Utilities', item: 'Electricity Bill', amount: 85.75, method: 'Online', notes: 'June bill' },
      { id: 'EXP-5', date: '2025-07-31', category: 'Marketing', item: 'Instagram Ads', amount: 40.00, method: 'Card', notes: 'Promo campaign' },
      { id: 'EXP-6', date: '2025-07-30', category: 'Ingredients', item: 'Sugar (5kg)', amount: 22.00, method: 'Cash', notes: 'Store run' },
      { id: 'EXP-7', date: '2025-07-30', category: 'Delivery', item: 'Fuel', amount: 25.00, method: 'Cash', notes: 'Delivery van fill' }
    ];

    // Inventory
    this.inventory = [
      { id: 'INV-1', name: 'Flour', category: 'Ingredients', stock: 18, unit: 'kg', threshold: 10 },
      { id: 'INV-2', name: 'Sugar', category: 'Ingredients', stock: 12, unit: 'kg', threshold: 8 },
      { id: 'INV-3', name: 'Butter', category: 'Ingredients', stock: 2, unit: 'kg', threshold: 3 }, // Alert
      { id: 'INV-4', name: 'Eggs', category: 'Ingredients', stock: 24, unit: 'pcs', threshold: 20 },
      { id: 'INV-5', name: 'Cocoa Powder', category: 'Ingredients', stock: 1.2, unit: 'kg', threshold: 2 }, // Alert
      { id: 'INV-6', name: 'Cake Boxes (10 inch)', category: 'Packaging', stock: 15, unit: 'pcs', threshold: 20 } // Alert
    ];

    this.saveState();
  },

  // Mobile Sidebar Drawer Toggle Helpers
  toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active');
  },

  closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
  },

  // ----------------------------------------------------
  // GLOBAL LAYOUT & ROUTING EVENT HANDLERS
  // ----------------------------------------------------
  setupEventListeners() {
    // Navigation routing
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = item.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // Mobile Hamburger & Overlay Triggers
    const mobToggle = document.getElementById('mobile-menu-toggle');
    const mobClose = document.getElementById('mobile-sidebar-close-btn');
    const mobOverlay = document.getElementById('sidebar-overlay');

    if (mobToggle) mobToggle.addEventListener('click', () => this.toggleMobileSidebar());
    if (mobClose) mobClose.addEventListener('click', () => this.closeMobileSidebar());
    if (mobOverlay) mobOverlay.addEventListener('click', () => this.closeMobileSidebar());

    // Mobile Bottom Navigation Bar Items
    document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        if (item.id === 'mob-nav-more') {
          this.toggleMobileSidebar();
        } else {
          const tab = item.getAttribute('data-tab');
          if (tab) this.switchTab(tab);
        }
      });
    });

    // Mobile FAB Trigger (New Order)
    const mobFab = document.getElementById('mobile-fab');
    if (mobFab) {
      mobFab.addEventListener('click', () => {
        this.openModal('orderModal');
      });
    }


    // Theme Toggle
    document.getElementById('theme-switcher-btn').addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('hos_theme', newTheme);

      const themeText = newTheme === 'light' ? 'Chic Rose' : 'Cocoa Gold';
      document.querySelector('.theme-text').textContent = themeText;

      // Re-render charts to adjust grid lines & text colors
      this.renderCharts();
    });

    // Notifications Click Trigger
    const bellTrigger = document.getElementById('notification-trigger');
    const bellDropdown = document.getElementById('notification-menu');
    bellTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      bellDropdown.classList.toggle('active');
    });

    document.addEventListener('click', () => {
      bellDropdown.classList.remove('active');
    });

    // Period Selectors in Header
    document.getElementById('dashboard-period-select').addEventListener('change', (e) => {
      this.dashboardPeriod = e.target.value;
      this.renderDashboard();
    });

    // Dashboard Selectors inside Charts
    document.getElementById('sales-chart-period-select').addEventListener('change', () => {
      this.renderSalesOverviewChart();
    });

    document.getElementById('expense-chart-period-select').addEventListener('change', () => {
      this.renderExpenseSummaryDonut();
    });

    document.getElementById('products-chart-period-select').addEventListener('change', () => {
      this.renderTopProductsList();
    });

    // Detail Report Open Actions when clicking Metric Cards
    document.getElementById('card-sales-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('reports', { reportType: 'sales' });
    });

    document.getElementById('card-expenses-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('reports', { reportType: 'expenses' });
    });

    document.getElementById('card-profit-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('reports', { reportType: 'profit' });
    });

    document.getElementById('card-orders-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('orders');
    });

    document.getElementById('card-pending-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('orders', { status: 'Pending' });
    });

    document.getElementById('card-due-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('orders', { payment: 'Unpaid' });
    });

    // Buttons bindings on Dashboard
    document.getElementById('btn-new-order-dash').addEventListener('click', () => this.openModal('orderModal'));
    document.getElementById('btn-add-expense-dash').addEventListener('click', () => this.openModal('expenseModal'));
    document.getElementById('btn-dash-cal-prev').addEventListener('click', () => this.dashboardCalendarPrevMonth());
    document.getElementById('btn-dash-cal-next').addEventListener('click', () => this.dashboardCalendarNextMonth());

    // Orders Filter Handlers
    document.getElementById('order-search-input').addEventListener('input', () => {
      this.pagination.orders.current = 1;
      this.renderOrdersTable();
    });
    document.getElementById('order-status-filter').addEventListener('change', () => {
      this.pagination.orders.current = 1;
      this.renderOrdersTable();
    });
    document.getElementById('order-payment-filter').addEventListener('change', () => {
      this.pagination.orders.current = 1;
      this.renderOrdersTable();
    });

    // Expenses Filter Handlers
    document.getElementById('expense-search-input').addEventListener('input', () => {
      this.pagination.expenses.current = 1;
      this.renderExpensesTable();
    });
    document.getElementById('expense-category-filter').addEventListener('change', () => {
      this.pagination.expenses.current = 1;
      this.renderExpensesTable();
    });
    document.getElementById('expense-date-start').addEventListener('change', () => {
      this.pagination.expenses.current = 1;
      this.renderExpensesTable();
    });
    document.getElementById('expense-date-end').addEventListener('change', () => {
      this.pagination.expenses.current = 1;
      this.renderExpensesTable();
    });

    // Customers Filter Handlers
    document.getElementById('customer-search-input').addEventListener('input', () => {
      this.pagination.customers.current = 1;
      this.renderCustomersTable();
    });

    // Inventory Filter Handlers
    document.getElementById('inventory-search-input').addEventListener('input', () => {
      this.pagination.inventory.current = 1;
      this.renderInventoryTable();
    });
    document.getElementById('inventory-category-filter').addEventListener('change', () => {
      this.pagination.inventory.current = 1;
      this.renderInventoryTable();
    });

    // Payments Filter Handlers
    document.getElementById('payment-search-input').addEventListener('input', () => {
      this.pagination.payments.current = 1;
      this.renderPaymentsTable();
    });
    document.getElementById('payment-status-filter').addEventListener('change', () => {
      this.pagination.payments.current = 1;
      this.renderPaymentsTable();
    });

    // Modal Forms Submissions
    document.getElementById('orderForm').addEventListener('submit', (e) => this.handleOrderSubmit(e));
    document.getElementById('expenseForm').addEventListener('submit', (e) => this.handleExpenseSubmit(e));
    document.getElementById('customerForm').addEventListener('submit', (e) => this.handleCustomerSubmit(e));
    document.getElementById('inventoryForm').addEventListener('submit', (e) => this.handleInventorySubmit(e));
    document.getElementById('addExpenseCategoryForm').addEventListener('submit', (e) => this.handleAddExpenseCat(e));
    document.getElementById('addInventoryCategoryForm').addEventListener('submit', (e) => this.handleAddInventoryCat(e));
    document.getElementById('business-info-form').addEventListener('submit', (e) => this.handleBusinessInfoSubmit(e));

    // Reports sub-tab triggers
    document.querySelectorAll('.report-tab-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.report-tab-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        this.renderReportsMain();
      });
    });

    // Reports date handlers
    document.getElementById('report-date-start').addEventListener('change', () => this.renderReportsMain());
    document.getElementById('report-date-end').addEventListener('change', () => this.renderReportsMain());

    // Settings sub-tab switches
    document.querySelectorAll('.settings-tab-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.settings-tab-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const targetSection = item.getAttribute('data-settings-section');
        document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
        document.getElementById(`settings-${targetSection}`).classList.add('active');
      });
    });

    // Backup & Export Handlers
    document.getElementById('btn-backup-export').addEventListener('click', () => this.exportDatabaseBackup());
    document.getElementById('btn-backup-import').addEventListener('click', () => this.importDatabaseBackup());
    document.getElementById('btn-reset-db').addEventListener('click', () => this.resetDatabaseConfirm());

    // Modal controls trigger bindings
    document.getElementById('btn-new-order-trigger').addEventListener('click', () => this.openModal('orderModal'));
    document.getElementById('btn-calendar-new-order').addEventListener('click', () => this.openModal('orderModal'));
    document.getElementById('btn-add-customer-trigger').addEventListener('click', () => this.openModal('customerModal'));
    document.getElementById('btn-expense-categories-trigger').addEventListener('click', () => this.openModal('expenseCategoriesModal'));
    document.getElementById('btn-add-expense-trigger').addEventListener('click', () => this.openModal('expenseModal'));
    document.getElementById('btn-inventory-categories-trigger').addEventListener('click', () => this.openModal('inventoryCategoriesModal'));
    document.getElementById('btn-add-inventory-trigger').addEventListener('click', () => this.openModal('inventoryModal'));

    // Modal Close Triggers
    document.getElementById('btn-order-modal-close').addEventListener('click', () => this.closeModal('orderModal'));
    document.getElementById('btn-order-modal-cancel').addEventListener('click', () => this.closeModal('orderModal'));
    document.getElementById('btn-expense-modal-close').addEventListener('click', () => this.closeModal('expenseModal'));
    document.getElementById('btn-expense-modal-cancel').addEventListener('click', () => this.closeModal('expenseModal'));
    document.getElementById('btn-customer-modal-close').addEventListener('click', () => this.closeModal('customerModal'));
    document.getElementById('btn-customer-modal-cancel').addEventListener('click', () => this.closeModal('customerModal'));
    document.getElementById('btn-inventory-modal-close').addEventListener('click', () => this.closeModal('inventoryModal'));
    document.getElementById('btn-inventory-modal-cancel').addEventListener('click', () => this.closeModal('inventoryModal'));
    document.getElementById('btn-expense-cat-close').addEventListener('click', () => this.closeModal('expenseCategoriesModal'));
    document.getElementById('btn-inventory-cat-close').addEventListener('click', () => this.closeModal('inventoryCategoriesModal'));

    // Calendar Navigation clicks
    document.getElementById('btn-calendar-prev').addEventListener('click', () => this.calendarPrevMonth());
    document.getElementById('btn-calendar-next').addEventListener('click', () => this.calendarNextMonth());
  },

  // Switch Tab Panels
  switchTab(tabName, options = {}) {
    this.activeTab = tabName;

    // Auto-close mobile drawer if open
    this.closeMobileSidebar();

    // Toggle active classes in desktop menu
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
      if (item.getAttribute('data-tab') === tabName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Toggle active classes in mobile bottom nav bar
    document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(item => {
      if (item.getAttribute('data-tab') === tabName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Toggle active panel
    document.querySelectorAll('.panel-container .tab-panel').forEach(panel => {
      if (panel.getAttribute('id') === `panel-${tabName}`) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    // Populate dropdowns & trigger tab-specific renders
    if (tabName === 'dashboard') {
      this.renderDashboard();
    } else if (tabName === 'orders') {
      if (options.status) {
        document.getElementById('order-status-filter').value = options.status;
      }
      if (options.payment) {
        document.getElementById('order-payment-filter').value = options.payment;
      }
      this.renderOrdersTable();
    } else if (tabName === 'calendar') {
      this.renderCalendar();
    } else if (tabName === 'customers') {
      this.renderCustomersTable();
    } else if (tabName === 'expenses') {
      this.populateCategoryDropdowns();
      this.renderExpensesTable();
    } else if (tabName === 'inventory') {
      this.populateCategoryDropdowns();
      this.renderInventoryTable();
    } else if (tabName === 'payments') {
      this.renderPaymentsTable();
    } else if (tabName === 'reports') {
      if (options.reportType) {
        document.querySelectorAll('.report-tab-item').forEach(item => {
          if (item.getAttribute('data-report') === options.reportType) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        });
      }
      this.setupReportsDates();
      this.renderReportsMain();
    } else if (tabName === 'settings') {
      this.renderSettings();
    }

    // Refresh icons
    lucide.createIcons();
  },

  updateGlobalHeader() {
    // Current Header Date text
    const opt = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    document.getElementById('current-header-date').textContent = this.currentDate.toLocaleDateString('en-US', opt);
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - DASHBOARD VIEW
  // ----------------------------------------------------
  renderDashboard() {
    this.calculateDashboardMetrics();

    // 1. Render Dashboard Orders Table (filtered by selected period)
    this.renderDashboardOrdersTable();

    // 2. Render Recent Expenses List
    this.renderDashboardExpensesList();

    // 3. Render Dashboard Mini Calendar
    this.renderDashboardMiniCalendar();

    // 4. Render Side widgets
    this.renderSalesOverviewChart();
    this.renderExpenseSummaryDonut();
    this.renderTopProductsList();

    lucide.createIcons();
  },

  calculateDashboardMetrics() {
    const period = this.dashboardPeriod;
    const filterText = period.toUpperCase();

    // Update metric card labels
    document.getElementById('lbl-metric-orders').textContent = `${filterText}'S ORDERS`;
    document.getElementById('lbl-metric-sales').textContent = `${filterText}'S SALES`;
    document.getElementById('lbl-metric-expenses').textContent = `${filterText}'S EXPENSES`;
    document.getElementById('lbl-metric-profit').textContent = `${filterText}'S PROFIT`;

    // Filter orders & expenses by selected period
    const orders = this.getOrdersInPeriod(period);
    const expenses = this.getExpensesInPeriod(period);

    // Orders count
    const ordersCount = orders.length;
    document.getElementById('today-orders-val').textContent = ordersCount;

    // Sales Sum
    const salesTotal = orders.reduce((sum, o) => sum + o.amount, 0);
    document.getElementById('today-sales-val').textContent = `$${salesTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Expenses Sum
    const expensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
    document.getElementById('today-expenses-val').textContent = `$${expensesTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Profit
    const profitTotal = salesTotal - expensesTotal;
    const profitEl = document.getElementById('today-profit-val');
    profitEl.textContent = `$${profitTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (profitTotal < 0) {
      profitEl.classList.add('text-danger');
    } else {
      profitEl.classList.remove('text-danger');
    }

    // Pending Orders count (Point-in-time metrics, not matching period)
    const pendingOrdersCount = this.orders.filter(o => o.orderStatus === 'Confirmed' || o.orderStatus === 'In Progress' || o.orderStatus === 'Ready').length;
    document.getElementById('pending-orders-val').textContent = pendingOrdersCount;

    // Payments Due (Point-in-time metrics, not matching period)
    const dueAmount = this.orders
      .filter(o => (o.paymentStatus === 'Unpaid' || o.paymentStatus === 'Deposit Paid') && o.orderStatus !== 'Cancelled')
      .reduce((sum, o) => {
        const remaining = o.paymentStatus === 'Deposit Paid' ? o.amount / 2 : o.amount;
        return sum + remaining;
      }, 0);

    document.getElementById('payments-due-val').textContent = `$${dueAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  // Helper: filter orders by period surrounding July 31, 2025
  getOrdersInPeriod(period) {
    const todayStr = '2025-07-31';

    if (period === 'today') {
      return this.orders.filter(o => o.pickupDate.startsWith(todayStr) && o.orderStatus !== 'Cancelled');
    } else if (period === 'week') {
      // Week of July 28 - Aug 3, 2025
      return this.orders.filter(o => o.pickupDate >= '2025-07-28T00:00' && o.pickupDate <= '2025-08-03T23:59' && o.orderStatus !== 'Cancelled');
    } else if (period === 'month') {
      // July 2025
      return this.orders.filter(o => o.pickupDate.startsWith('2025-07') && o.orderStatus !== 'Cancelled');
    } else if (period === 'year') {
      // 2025
      return this.orders.filter(o => o.pickupDate.startsWith('2025') && o.orderStatus !== 'Cancelled');
    }
    return [];
  },

  // Helper: filter expenses by period surrounding July 31, 2025
  getExpensesInPeriod(period) {
    const todayStr = '2025-07-31';

    if (period === 'today') {
      return this.expenses.filter(e => e.date === todayStr);
    } else if (period === 'week') {
      return this.expenses.filter(e => e.date >= '2025-07-28' && e.date <= '2025-08-03');
    } else if (period === 'month') {
      return this.expenses.filter(e => e.date.startsWith('2025-07'));
    } else if (period === 'year') {
      return this.expenses.filter(e => e.date.startsWith('2025'));
    }
    return [];
  },

  // 1. Dashboard Orders Table
  renderDashboardOrdersTable() {
    const tableTitle = document.getElementById('dashboard-orders-table-title');
    const period = this.dashboardPeriod;
    const periodLabel = period === 'today' ? "Today" : (period === 'week' ? "This Week" : (period === 'month' ? "This Month" : "This Year"));
    tableTitle.textContent = `${periodLabel}'s Orders`;

    const orders = this.getOrdersInPeriod(period).sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));
    const tbody = document.getElementById('dashboard-orders-table-body');
    tbody.innerHTML = '';

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 30px;">No orders recorded in this period.</td></tr>`;
      return;
    }

    orders.slice(0, 5).forEach(o => {
      const initials = o.customerName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      const timeStr = new Date(o.pickupDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      const trHtml = `
        <tr>
          <td><span class="order-id-txt" style="font-size:0.8rem;">${o.id}</span></td>
          <td>
            <div class="customer-cell" style="gap:8px;">
              <div class="avatar-initials" style="width:26px; height:26px; font-size:0.65rem;">${initials}</div>
              <div class="customer-meta-info">
                <span class="customer-name" style="font-size:0.8rem; font-weight:600;">${o.customerName}</span>
                <span class="customer-phone" style="font-size:0.68rem;">${o.customerPhone}</span>
              </div>
            </div>
          </td>
          <td style="font-size:0.8rem; max-width: 140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${o.items}</td>
          <td style="font-size:0.8rem;">${timeStr}</td>
          <td style="font-weight: 600; font-size:0.8rem;">$${o.amount.toFixed(2)}</td>
          <td><span class="badge badge-${this.getStatusBadgeType(o.orderStatus)}" style="font-size:0.65rem; padding: 2px 8px;">${o.orderStatus}</span></td>
          <td><span class="badge badge-${this.getPaymentBadgeType(o.paymentStatus)}" style="font-size:0.65rem; padding: 2px 8px;">${o.paymentStatus}</span></td>
          <td style="text-align: center;">
            <button class="btn-action-trigger" onclick="app.editOrder('${o.id}')" title="Edit" style="padding:2px;">
              <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
            </button>
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', trHtml);
    });

    lucide.createIcons();
  },

  // 2. Dashboard Recent Expenses List
  renderDashboardExpensesList() {
    const expenses = this.expenses.slice(0, 5); // Just show the top 5 overall recent ones or filter
    const list = document.getElementById('dashboard-recent-expenses');
    list.innerHTML = '';

    if (expenses.length === 0) {
      list.innerHTML = `<div class="list-item" style="color:var(--color-text-muted); font-size:0.8rem; padding: 20px 0;">No expenses found.</div>`;
      return;
    }

    expenses.forEach(e => {
      const expDate = new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const itemHtml = `
        <div class="list-item" style="padding-bottom: 8px;">
          <div class="item-info">
            <h4 class="item-title" style="font-size:0.8rem;">${e.item}</h4>
            <p class="item-subtitle" style="font-size:0.68rem;">${e.category} | ${expDate}</p>
          </div>
          <div class="item-meta">
            <span class="item-value-bold" style="font-size:0.8rem;">$${e.amount.toFixed(2)}</span>
          </div>
        </div>
      `;
      list.insertAdjacentHTML('beforeend', itemHtml);
    });
  },

  // 3. Dashboard Mini Calendar
  renderDashboardMiniCalendar() {
    const miniCells = document.getElementById('dashboard-mini-calendar-cells');
    miniCells.innerHTML = '';

    const year = this.miniCalDate.getFullYear();
    const month = this.miniCalDate.getMonth();

    // Month label (e.g. August 2025)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    document.getElementById('dashboard-mini-calendar-month-year').textContent = `${monthNames[month]} ${year}`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevLastDay = new Date(year, month, 0).getDate();

    // Fill prev month days
    for (let x = firstDayIndex; x > 0; x--) {
      const prevDay = prevLastDay - x + 1;
      const prevMonthIdx = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;

      miniCells.appendChild(this.createMiniCalendarCell(prevYear, prevMonthIdx, prevDay, true));
    }

    // Current month days
    for (let i = 1; i <= lastDay; i++) {
      miniCells.appendChild(this.createMiniCalendarCell(year, month, i, false));
    }

    // Fill next month days
    const totalCells = miniCells.children.length;
    const remainingDays = 35 - totalCells; // 5 rows = 35 cells
    const finalRemaining = remainingDays < 0 ? 42 - totalCells : remainingDays;

    for (let j = 1; j <= finalRemaining; j++) {
      const nextMonthIdx = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;

      miniCells.appendChild(this.createMiniCalendarCell(nextYear, nextMonthIdx, j, true));
    }

    // Render event list for selected day
    this.renderMiniCalendarDayEvents();
  },

  createMiniCalendarCell(year, month, day, isOtherMonth) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const cell = document.createElement('div');
    cell.className = 'mini-calendar-cell';
    cell.textContent = day;

    if (isOtherMonth) {
      cell.classList.add('other-month');
    }

    // Today
    if (!isOtherMonth && year === 2025 && month === 6 && day === 31) {
      cell.classList.add('today');
    }

    // Selected state
    if (dateStr === this.miniCalSelectedDayStr) {
      cell.classList.add('selected');
    }

    // Checking if there are orders
    const hasOrders = this.orders.some(o => o.pickupDate.startsWith(dateStr) && o.orderStatus !== 'Cancelled');
    if (hasOrders) {
      cell.classList.add('has-orders');
    }

    cell.addEventListener('click', () => {
      // Remove selected
      document.querySelectorAll('.mini-calendar-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');

      this.miniCalSelectedDayStr = dateStr;
      this.renderMiniCalendarDayEvents();
    });

    return cell;
  },

  renderMiniCalendarDayEvents() {
    const dateLabel = document.getElementById('dashboard-mini-calendar-selected-date-label');
    const container = document.getElementById('dashboard-mini-calendar-events');
    container.innerHTML = '';

    // Format label date (Thu, July 31, 2025)
    const selDate = new Date(this.miniCalSelectedDayStr + 'T12:00:00');
    dateLabel.textContent = selDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    // Filter orders
    const dayOrders = this.orders.filter(o => o.pickupDate.startsWith(this.miniCalSelectedDayStr) && o.orderStatus !== 'Cancelled');

    if (dayOrders.length === 0) {
      container.innerHTML = `<div style="font-size:0.75rem; color:var(--color-text-muted); padding: 15px 0;">No events scheduled.</div>`;
      return;
    }

    dayOrders.forEach(o => {
      const timeStr = new Date(o.pickupDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const cleanStatus = o.orderStatus.replace(/\s+/g, '');

      const chipHtml = `
        <div class="mini-event-chip evt-${cleanStatus}" onclick="app.editOrder('${o.id}')">
          <span class="mini-event-time">${timeStr}</span>
          <span class="mini-event-details">${o.customerName} - ${o.items}</span>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', chipHtml);
    });
  },

  dashboardCalendarPrevMonth() {
    this.miniCalDate.setMonth(this.miniCalDate.getMonth() - 1);
    this.renderDashboardMiniCalendar();
  },

  dashboardCalendarNextMonth() {
    this.miniCalDate.setMonth(this.miniCalDate.getMonth() + 1);
    this.renderDashboardMiniCalendar();
  },

  // ----------------------------------------------------
  // CHART RENDERING (DASHBOARD REDESIGNED)
  // ----------------------------------------------------

  // 1. Sales Line Chart
  renderSalesOverviewChart() {
    const period = document.getElementById('sales-chart-period-select').value;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(93, 54, 39, 0.3)' : 'rgba(240, 230, 232, 0.8)';
    const textColor = isDark ? '#b59c94' : '#8a7376';
    const primaryColor = isDark ? '#d9a962' : '#e05275';
    const primaryLightColor = isDark ? 'rgba(217, 169, 98, 0.2)' : 'rgba(224, 82, 117, 0.1)';

    if (this.charts.salesOverview) this.charts.salesOverview.destroy();

    let labels = [];
    let salesData = [];
    let headerTotal = 0;

    if (period === 'week') {
      labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      salesData = [650.00, 480.00, 750.00, 1245.00, 890.00, 450.00, 185.00];
      headerTotal = salesData.reduce((a, b) => a + b, 0);
    } else if (period === 'month') {
      labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
      salesData = [1850.00, 2450.00, 3100.00, 5050.00];
      headerTotal = salesData.reduce((a, b) => a + b, 0);
    } else if (period === 'year') {
      labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      salesData = [5500, 6200, 7800, 8400, 9100, 11500, 12450, 0, 0, 0, 0, 0];
      headerTotal = salesData.reduce((a, b) => a + b, 0);
    }

    document.getElementById('week-sales-total').textContent = `$${headerTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const ctx = document.getElementById('salesOverviewChart').getContext('2d');
    this.charts.salesOverview = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Sales ($)',
          data: salesData,
          borderColor: primaryColor,
          borderWidth: 3,
          backgroundColor: primaryLightColor,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: primaryColor,
          pointBorderColor: isDark ? '#2c130b' : '#ffffff',
          pointHoverRadius: 7,
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 } } }
        }
      }
    });
  },

  // 2. Expense Summary Donut Chart (replaces the previous orders overview donut)
  renderExpenseSummaryDonut() {
    const period = document.getElementById('expense-chart-period-select').value;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(93, 54, 39, 0.3)' : 'rgba(240, 230, 232, 0.8)';
    const textColor = isDark ? '#b59c94' : '#8a7376';

    if (this.charts.expenseSummary) this.charts.expenseSummary.destroy();

    // Group categories
    const categoriesSum = {};
    this.expenseCategories.forEach(cat => categoriesSum[cat] = 0);

    const expenses = this.getExpensesInPeriod(period);
    expenses.forEach(e => {
      categoriesSum[e.category] = (categoriesSum[e.category] || 0) + e.amount;
    });

    const totalSum = Object.values(categoriesSum).reduce((a, b) => a + b, 0);
    document.getElementById('donut-total-orders').textContent = `$${totalSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const chartLabels = Object.keys(categoriesSum);
    const chartData = Object.values(categoriesSum);

    const chartColors = [
      '#e05275', // Ingredients (Primary pink)
      '#f1c40f', // Packaging
      '#3498db', // Utilities
      '#2ecc71', // Marketing
      '#9b59b6', // Delivery
      '#95a5a6'  // Others
    ];

    const ctx = document.getElementById('ordersOverviewChart').getContext('2d');
    this.charts.expenseSummary = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: chartLabels,
        datasets: [{
          data: chartData.every(v => v === 0) ? [1] : chartData, // Fallback if 0
          backgroundColor: chartData.every(v => v === 0) ? ['#e9e9e9'] : chartColors,
          borderWidth: isDark ? 2 : 1,
          borderColor: isDark ? '#2c130b' : '#ffffff',
          hoverOffset: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: { legend: { display: false } }
      }
    });

    // Populate legend row categories
    const legendList = document.getElementById('expense-summary-category-legend');
    legendList.innerHTML = '';

    chartLabels.forEach((label, idx) => {
      const amt = categoriesSum[label];
      const percentage = totalSum > 0 ? ((amt / totalSum) * 100).toFixed(0) : 0;

      const legendHtml = `
        <div class="legend-row">
          <div class="legend-left">
            <span class="legend-color" style="background-color: ${chartColors[idx]};"></span>
            <span style="font-weight:500;">${label}</span>
          </div>
          <div class="legend-right">
            <span>$${amt.toFixed(2)}</span>
            <span style="font-size:0.68rem; font-weight:400; margin-left:6px; color:var(--color-text-muted);">${percentage}%</span>
          </div>
        </div>
      `;
      legendList.insertAdjacentHTML('beforeend', legendHtml);
    });
  },

  // 3. Top Products Progress list
  renderTopProductsList() {
    const period = document.getElementById('products-chart-period-select').value;
    const list = document.getElementById('dashboard-top-products');
    list.innerHTML = '';

    // Simulated products counts based on period
    let productsSales = [];
    if (period === 'week') {
      productsSales = [
        { name: 'Floral Cupcakes', count: 12, max: 15 },
        { name: 'Birthday Cakes', count: 7, max: 15 },
        { name: 'Cookies', count: 6, max: 15 },
        { name: 'Brownies', count: 4, max: 15 },
        { name: 'Cupcake Bouquets', count: 2, max: 15 }
      ];
    } else if (period === 'month') {
      productsSales = [
        { name: 'Floral Cupcakes', count: 45, max: 50 },
        { name: 'Birthday Cakes', count: 28, max: 50 },
        { name: 'Cookies', count: 22, max: 50 },
        { name: 'Brownies', count: 18, max: 50 },
        { name: 'Cupcake Bouquets', count: 15, max: 50 }
      ];
    } else if (period === 'year') {
      productsSales = [
        { name: 'Floral Cupcakes', count: 320, max: 350 },
        { name: 'Birthday Cakes', count: 180, max: 350 },
        { name: 'Cookies', count: 145, max: 350 },
        { name: 'Brownies', count: 110, max: 350 },
        { name: 'Cupcake Bouquets', count: 95, max: 350 }
      ];
    }

    productsSales.forEach(p => {
      const percentage = (p.count / p.max) * 100;
      const pHtml = `
        <div class="product-progress-wrapper" style="margin-bottom:8px;">
          <div class="progress-header" style="font-size:0.75rem;">
            <span class="product-name">${p.name}</span>
            <span class="product-count" style="font-weight:600;">${p.count} Orders</span>
          </div>
          <div class="progress-bar-bg" style="height:5px;">
            <div class="progress-bar-fill" style="width: ${percentage}%;"></div>
          </div>
        </div>
      `;
      list.insertAdjacentHTML('beforeend', pHtml);
    });
  },

  // Redraws dashboard charts
  renderCharts() {
    this.renderSalesOverviewChart();
    this.renderExpenseSummaryDonut();
    this.renderTopProductsList();
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - ORDERS VIEW
  // ----------------------------------------------------
  renderOrdersTable() {
    const searchVal = document.getElementById('order-search-input').value.toLowerCase();
    const statusVal = document.getElementById('order-status-filter').value;
    const paymentVal = document.getElementById('order-payment-filter').value;

    // Filter orders
    let filtered = this.orders.filter(o => {
      const matchesSearch = o.id.toLowerCase().includes(searchVal) ||
        o.customerName.toLowerCase().includes(searchVal) ||
        o.customerPhone.includes(searchVal) ||
        o.items.toLowerCase().includes(searchVal);

      const matchesStatus = statusVal === 'all' || o.orderStatus === statusVal;
      const matchesPayment = paymentVal === 'all' || o.paymentStatus === paymentVal;

      return matchesSearch && matchesStatus && matchesPayment;
    });

    // Sort orders by pickupDate descending
    filtered.sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));

    const totalRecords = filtered.length;
    const limit = this.pagination.orders.limit;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    if (this.pagination.orders.current > totalPages) {
      this.pagination.orders.current = totalPages;
    }

    const startIndex = (this.pagination.orders.current - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    const infoText = totalRecords > 0
      ? `Showing ${startIndex + 1} to ${Math.min(startIndex + limit, totalRecords)} of ${totalRecords} orders`
      : 'Showing 0 to 0 of 0 orders';
    document.getElementById('orders-pagination-info').textContent = infoText;

    this.renderPaginationControls('orders', totalPages);

    const tbody = document.getElementById('orders-table-body');
    tbody.innerHTML = '';

    if (paginated.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 40px;">No matching orders found.</td></tr>`;
      return;
    }

    paginated.forEach(o => {
      const dateOpt = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
      const pickupFormatted = new Date(o.pickupDate).toLocaleDateString('en-US', dateOpt);
      const initials = o.customerName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

      const trHtml = `
        <tr>
          <td><span class="order-id-txt">${o.id}</span></td>
          <td>
            <div class="customer-cell">
              <div class="avatar-initials">${initials}</div>
              <div class="customer-meta-info">
                <span class="customer-name" style="font-weight:600;">${o.customerName}</span>
                <span class="customer-phone">${o.customerPhone}</span>
              </div>
            </div>
          </td>
          <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${o.items}</td>
          <td>${pickupFormatted}</td>
          <td style="font-weight: 600;">$${o.amount.toFixed(2)}</td>
          <td><span class="badge badge-${this.getPaymentBadgeType(o.paymentStatus)}">${o.paymentStatus}</span></td>
          <td><span class="badge badge-${this.getStatusBadgeType(o.orderStatus)}">${o.orderStatus}</span></td>
          <td style="text-align: center;">
            <button class="btn-action-trigger" onclick="app.editOrder('${o.id}')" title="Edit Order">
              <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
            </button>
            <button class="btn-action-trigger text-danger" onclick="app.deleteOrder('${o.id}')" title="Delete Order" style="margin-left: 8px;">
              <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
            </button>
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', trHtml);
    });

    lucide.createIcons();
  },

  // ----------------------------------------------------
  // CALENDAR VIEWER CODE
  // ----------------------------------------------------
  renderCalendar() {
    const calendarGrid = document.getElementById('calendar-grid-cells');
    calendarGrid.innerHTML = '';

    const year = this.calendarDate.getFullYear();
    const month = this.calendarDate.getMonth();

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById('calendar-month-year').textContent = `${monthNames[month]} ${year}`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevLastDay = new Date(year, month, 0).getDate();

    // Fill prev month days
    for (let x = firstDayIndex; x > 0; x--) {
      const prevDay = prevLastDay - x + 1;
      const prevMonthIdx = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;

      calendarGrid.appendChild(this.createCalendarDayCell(prevYear, prevMonthIdx, prevDay, true));
    }

    // Current month days
    for (let i = 1; i <= lastDay; i++) {
      calendarGrid.appendChild(this.createCalendarDayCell(year, month, i, false));
    }

    // Fill next month days
    const totalCells = calendarGrid.children.length;
    const remainingDays = 42 - totalCells;
    for (let j = 1; j <= remainingDays; j++) {
      const nextMonthIdx = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;

      calendarGrid.appendChild(this.createCalendarDayCell(nextYear, nextMonthIdx, j, true));
    }

    lucide.createIcons();
  },

  createCalendarDayCell(year, month, day, isOtherMonth) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell';
    if (isOtherMonth) cell.classList.add('other-month');

    if (!isOtherMonth && year === 2025 && month === 6 && day === 31) {
      cell.classList.add('today');
    }

    const dayNum = document.createElement('div');
    dayNum.className = 'calendar-day-number';
    dayNum.textContent = day;
    cell.appendChild(dayNum);

    const dayOrders = this.orders.filter(o => o.pickupDate.startsWith(dateStr) && o.orderStatus !== 'Cancelled');

    if (dayOrders.length > 0) {
      const evList = document.createElement('div');
      evList.className = 'calendar-events-list';

      dayOrders.forEach(o => {
        const timeStr = o.pickupDate.slice(11, 16);
        const cleanStatus = o.orderStatus.replace(/\s+/g, '');

        const badge = document.createElement('div');
        badge.className = `calendar-event-badge evt-${cleanStatus}`;
        badge.innerHTML = `<span style="font-weight:600;">${timeStr}</span> <span>${o.customerName}</span>`;
        badge.setAttribute('title', `${o.customerName} - ${o.items}`);
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          app.editOrder(o.id);
        });

        evList.appendChild(badge);
      });

      cell.appendChild(evList);
    }

    return cell;
  },

  calendarPrevMonth() {
    this.calendarDate.setMonth(this.calendarDate.getMonth() - 1);
    this.renderCalendar();
  },

  calendarNextMonth() {
    this.calendarDate.setMonth(this.calendarDate.getMonth() + 1);
    this.renderCalendar();
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - EXPENSES VIEW
  // ----------------------------------------------------
  renderExpensesTable() {
    const searchVal = document.getElementById('expense-search-input').value.toLowerCase();
    const categoryVal = document.getElementById('expense-category-filter').value;
    const dateStartVal = document.getElementById('expense-date-start').value;
    const dateEndVal = document.getElementById('expense-date-end').value;

    let filtered = this.expenses.filter(e => {
      const matchesSearch = e.item.toLowerCase().includes(searchVal) ||
        (e.notes && e.notes.toLowerCase().includes(searchVal));

      const matchesCategory = categoryVal === 'all' || e.category === categoryVal;
      const matchesStart = !dateStartVal || e.date >= dateStartVal;
      const matchesEnd = !dateEndVal || e.date <= dateEndVal;

      return matchesSearch && matchesCategory && matchesStart && matchesEnd;
    });

    filtered.sort((a, b) => b.date.localeCompare(a.date));

    const totalExpenseSum = filtered.reduce((sum, e) => sum + e.amount, 0);
    document.getElementById('expenses-total-summary').textContent = `$${totalExpenseSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const totalRecords = filtered.length;
    const limit = this.pagination.expenses.limit;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    if (this.pagination.expenses.current > totalPages) {
      this.pagination.expenses.current = totalPages;
    }

    const startIndex = (this.pagination.expenses.current - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    const infoText = totalRecords > 0
      ? `Showing ${startIndex + 1} to ${Math.min(startIndex + limit, totalRecords)} of ${totalRecords} expenses`
      : 'Showing 0 to 0 of 0 expenses';
    document.getElementById('expenses-pagination-info').textContent = infoText;

    this.renderPaginationControls('expenses', totalPages);

    const tbody = document.getElementById('expenses-table-body');
    tbody.innerHTML = '';

    if (paginated.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 40px;">No matching expenses found.</td></tr>`;
      return;
    }

    paginated.forEach(exp => {
      const dateOpt = { month: 'short', day: 'numeric', year: 'numeric' };
      const expDateFormatted = new Date(exp.date + 'T00:00:00').toLocaleDateString('en-US', dateOpt);

      const trHtml = `
        <tr>
          <td>${expDateFormatted}</td>
          <td><span class="badge badge-neutral">${exp.category}</span></td>
          <td style="font-weight: 500;">${exp.item}</td>
          <td style="font-weight: 600;">$${exp.amount.toFixed(2)}</td>
          <td>${exp.method}</td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-muted); font-size: 0.8rem;">${exp.notes || '-'}</td>
          <td style="text-align: center;">
            <button class="btn-action-trigger" onclick="app.editExpense('${exp.id}')" title="Edit Expense">
              <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
            </button>
            <button class="btn-action-trigger text-danger" onclick="app.deleteExpense('${exp.id}')" title="Delete Expense" style="margin-left: 8px;">
              <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
            </button>
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', trHtml);
    });

    lucide.createIcons();
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - CUSTOMERS VIEW
  // ----------------------------------------------------
  renderCustomersTable() {
    const searchVal = document.getElementById('customer-search-input').value.toLowerCase();

    let filtered = this.customers.filter(c => {
      return c.name.toLowerCase().includes(searchVal) ||
        c.phone.includes(searchVal) ||
        c.email.toLowerCase().includes(searchVal);
    });

    filtered.sort((a, b) => b.totalSpent - a.totalSpent);

    const totalRecords = filtered.length;
    const limit = this.pagination.customers.limit;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    if (this.pagination.customers.current > totalPages) {
      this.pagination.customers.current = totalPages;
    }

    const startIndex = (this.pagination.customers.current - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    const infoText = totalRecords > 0
      ? `Showing ${startIndex + 1} to ${Math.min(startIndex + limit, totalRecords)} of ${totalRecords} customers`
      : 'Showing 0 to 0 of 0 customers';
    document.getElementById('customers-pagination-info').textContent = infoText;

    this.renderPaginationControls('customers', totalPages);

    const tbody = document.getElementById('customers-table-body');
    tbody.innerHTML = '';

    if (paginated.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 40px;">No customers found.</td></tr>`;
      return;
    }

    paginated.forEach(c => {
      const initials = c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      const lastOrderFormatted = c.lastOrder
        ? new Date(c.lastOrder + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Never';

      const trHtml = `
        <tr>
          <td>
            <div class="customer-cell">
              <div class="avatar-initials">${initials}</div>
              <span style="font-weight: 600;">${c.name}</span>
            </div>
          </td>
          <td>${c.phone}</td>
          <td>${c.email || '-'}</td>
          <td style="font-weight: 500;">${c.totalOrders}</td>
          <td style="font-weight: 600;">$${c.totalSpent.toFixed(2)}</td>
          <td>${lastOrderFormatted}</td>
          <td style="text-align: center;">
            <button class="btn-action-trigger" onclick="app.editCustomer('${c.id}')" title="Edit Customer">
              <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
            </button>
            <button class="btn-action-trigger text-danger" onclick="app.deleteCustomer('${c.id}')" title="Delete Customer" style="margin-left: 8px;">
              <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
            </button>
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', trHtml);
    });

    lucide.createIcons();
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - INVENTORY VIEW
  // ----------------------------------------------------
  renderInventoryTable() {
    const searchVal = document.getElementById('inventory-search-input').value.toLowerCase();
    const categoryVal = document.getElementById('inventory-category-filter').value;

    let filtered = this.inventory.filter(i => {
      const matchesSearch = i.name.toLowerCase().includes(searchVal);
      const matchesCategory = categoryVal === 'all' || i.category === categoryVal;
      return matchesSearch && matchesCategory;
    });

    filtered.sort((a, b) => a.name.localeCompare(b.name));

    const totalRecords = filtered.length;
    const limit = this.pagination.inventory.limit;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    if (this.pagination.inventory.current > totalPages) {
      this.pagination.inventory.current = totalPages;
    }

    const startIndex = (this.pagination.inventory.current - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    const infoText = totalRecords > 0
      ? `Showing ${startIndex + 1} to ${Math.min(startIndex + limit, totalRecords)} of ${totalRecords} items`
      : 'Showing 0 to 0 of 0 items';
    document.getElementById('inventory-pagination-info').textContent = infoText;

    this.renderPaginationControls('inventory', totalPages);

    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = '';

    if (paginated.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--color-text-muted); padding: 40px;">No inventory items found.</td></tr>`;
      return;
    }

    paginated.forEach(i => {
      let badgeClass = 'success';
      let statusText = 'In Stock';

      if (i.stock === 0) {
        badgeClass = 'danger';
        statusText = 'Out of Stock';
      } else if (i.stock < i.threshold) {
        badgeClass = 'warning';
        statusText = 'Low Stock';
      }

      const trHtml = `
        <tr>
          <td style="font-weight: 600;">${i.name}</td>
          <td><span class="badge badge-neutral">${i.category}</span></td>
          <td style="font-weight: 500;">${i.stock}</td>
          <td>${i.unit}</td>
          <td style="color: var(--color-text-muted);">${i.threshold} ${i.unit}</td>
          <td><span class="badge badge-${badgeClass}">${statusText}</span></td>
          <td style="text-align: center;">
            <button class="btn-action-trigger" onclick="app.editInventory('${i.id}')" title="Edit Item">
              <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
            </button>
            <button class="btn-action-trigger text-danger" onclick="app.deleteInventory('${i.id}')" title="Delete Item" style="margin-left: 8px;">
              <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
            </button>
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', trHtml);
    });

    lucide.createIcons();
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - PAYMENTS LEDGER VIEW
  // ----------------------------------------------------
  renderPaymentsTable() {
    const searchVal = document.getElementById('payment-search-input').value.toLowerCase();
    const statusVal = document.getElementById('payment-status-filter').value;

    let filtered = this.orders.filter(o => {
      const matchesSearch = o.id.toLowerCase().includes(searchVal) ||
        o.customerName.toLowerCase().includes(searchVal) ||
        o.items.toLowerCase().includes(searchVal);
      const matchesStatus = statusVal === 'all' || o.paymentStatus === statusVal;
      return matchesSearch && matchesStatus && o.orderStatus !== 'Cancelled';
    });

    filtered.sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));

    const totalRecords = filtered.length;
    const limit = this.pagination.payments.limit;
    const totalPages = Math.ceil(totalRecords / limit) || 1;

    if (this.pagination.payments.current > totalPages) {
      this.pagination.payments.current = totalPages;
    }

    const startIndex = (this.pagination.payments.current - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    const infoText = totalRecords > 0
      ? `Showing ${startIndex + 1} to ${Math.min(startIndex + limit, totalRecords)} of ${totalRecords} payments`
      : 'Showing 0 to 0 of 0 payments';
    document.getElementById('payments-pagination-info').textContent = infoText;

    this.renderPaginationControls('payments', totalPages);

    const tbody = document.getElementById('payments-table-body');
    tbody.innerHTML = '';

    if (paginated.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-text-muted); padding: 40px;">No payments found.</td></tr>`;
      return;
    }

    paginated.forEach(o => {
      const dateOpt = { month: 'short', day: 'numeric', year: 'numeric' };
      const dateStr = new Date(o.pickupDate).toLocaleDateString('en-US', dateOpt);

      const trHtml = `
        <tr>
          <td><span class="order-id-txt">${o.id}</span></td>
          <td style="font-weight:600;">${o.customerName}</td>
          <td>${dateStr}</td>
          <td style="font-weight:600;">$${o.amount.toFixed(2)}</td>
          <td><span class="badge badge-${this.getPaymentBadgeType(o.paymentStatus)}">${o.paymentStatus}</span></td>
          <td style="max-width: 250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.8rem; color:var(--color-text-muted);">${o.notes || '-'}</td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', trHtml);
    });

    lucide.createIcons();
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - REPORTS VIEW
  // ----------------------------------------------------
  setupReportsDates() {
    const startInput = document.getElementById('report-date-start');
    const endInput = document.getElementById('report-date-end');

    if (!startInput.value) startInput.value = '2025-07-01';
    if (!endInput.value) endInput.value = '2025-07-31';
  },

  renderReportsMain() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(93, 54, 39, 0.3)' : 'rgba(240, 230, 232, 0.8)';
    const textColor = isDark ? '#b59c94' : '#8a7376';
    const primaryColor = isDark ? '#d9a962' : '#e05275';

    const activeReportTab = document.querySelector('.report-tab-item.active').getAttribute('data-report');
    const startD = document.getElementById('report-date-start').value;
    const endD = document.getElementById('report-date-end').value;

    // Filter orders & expenses in range
    const ordersInRange = this.orders.filter(o => {
      const orderDate = o.pickupDate.slice(0, 10);
      return o.orderStatus !== 'Cancelled' && (!startD || orderDate >= startD) && (!endD || orderDate <= endD);
    });

    const expensesInRange = this.expenses.filter(e => {
      return (!startD || e.date >= startD) && (!endD || e.date <= endD);
    });

    if (this.charts.reportsMain) this.charts.reportsMain.destroy();
    const ctxReport = document.getElementById('reportsMainChart').getContext('2d');

    const totalSales = ordersInRange.reduce((sum, o) => sum + o.amount, 0);
    const totalExpenses = expensesInRange.reduce((sum, e) => sum + e.amount, 0);
    const totalOrders = ordersInRange.length;
    const avgOrderVal = totalOrders > 0 ? totalSales / totalOrders : 0;
    const netProfit = totalSales - totalExpenses;

    const metric1Lbl = document.getElementById('rep-metric-1-label');
    const metric1Val = document.getElementById('rep-metric-1-value');
    const metric2Lbl = document.getElementById('rep-metric-2-label');
    const metric2Val = document.getElementById('rep-metric-2-value');
    const metric3Lbl = document.getElementById('rep-metric-3-label');
    const metric3Val = document.getElementById('rep-metric-3-value');
    const metric4Lbl = document.getElementById('rep-metric-4-label');
    const metric4Val = document.getElementById('rep-metric-4-value');

    const chartTitle = document.getElementById('report-chart-title');

    if (activeReportTab === 'sales') {
      chartTitle.textContent = "Monthly Sales Transactions";
      metric1Lbl.textContent = "Total Sales";
      metric1Val.textContent = `$${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      metric1Val.className = "box-value";
      metric2Lbl.textContent = "Total Orders";
      metric2Val.textContent = totalOrders;
      metric3Lbl.textContent = "Avg Order Value";
      metric3Val.textContent = `$${avgOrderVal.toFixed(2)}`;
      metric4Lbl.textContent = "Growth (vs Last Month)";
      metric4Val.textContent = "+ 18%";
      metric4Val.className = "box-value text-success";

      const days = Array.from({ length: 31 }, (_, i) => i + 1);
      const salesByDay = Array(31).fill(0);
      ordersInRange.forEach(o => {
        const day = parseInt(o.pickupDate.slice(8, 10));
        if (day >= 1 && day <= 31) salesByDay[day - 1] += o.amount;
      });

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: days.map(d => `Jul ${d}`),
          datasets: [{
            label: 'Sales ($)',
            data: salesByDay,
            backgroundColor: primaryColor,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor } },
            y: { grid: { color: gridColor }, ticks: { color: textColor } }
          }
        }
      });

    } else if (activeReportTab === 'expenses') {
      chartTitle.textContent = "Expense Breakdown by Category";
      metric1Lbl.textContent = "Total Expenses";
      metric1Val.textContent = `$${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      metric1Val.className = "box-value";
      metric2Lbl.textContent = "Largest Category";

      const expenseGroups = {};
      this.expenseCategories.forEach(c => expenseGroups[c] = 0);
      expensesInRange.forEach(e => {
        expenseGroups[e.category] = (expenseGroups[e.category] || 0) + e.amount;
      });

      let maxCategory = 'None';
      let maxCatAmount = 0;
      Object.keys(expenseGroups).forEach(c => {
        if (expenseGroups[c] > maxCatAmount) {
          maxCategory = c;
          maxCatAmount = expenseGroups[c];
        }
      });

      metric2Val.textContent = maxCategory;
      metric3Lbl.textContent = "Transactions";
      metric3Val.textContent = expensesInRange.length;
      metric4Lbl.textContent = "Status";
      metric4Val.textContent = "On Budget";
      metric4Val.className = "box-value text-success";

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: Object.keys(expenseGroups),
          datasets: [{
            label: 'Expenses ($)',
            data: Object.values(expenseGroups),
            backgroundColor: isDark ? '#d9a962' : '#f1c40f',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor } },
            y: { grid: { color: gridColor }, ticks: { color: textColor } }
          }
        }
      });

    } else if (activeReportTab === 'profit') {
      chartTitle.textContent = "Monthly Sales vs Expenses";
      metric1Lbl.textContent = "Net Profit";
      metric1Val.textContent = `$${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      metric1Val.className = netProfit >= 0 ? "box-value text-success" : "box-value text-danger";
      metric2Lbl.textContent = "Total Revenues";
      metric2Val.textContent = `$${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      metric3Lbl.textContent = "Total Outflows";
      metric3Val.textContent = `$${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      metric4Lbl.textContent = "Margin";

      const margin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
      metric4Val.textContent = `${margin.toFixed(0)}%`;
      metric4Val.className = margin >= 0 ? "box-value text-success" : "box-value text-danger";

      const weeklyRevenue = [1850.00, 2450.00, 3100.00, 5050.00];
      const weeklyCost = [650.00, 950.00, 1100.00, 1150.75];

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
          datasets: [
            {
              label: 'Revenue ($)',
              data: weeklyRevenue,
              backgroundColor: '#2ecc71',
              borderRadius: 4
            },
            {
              label: 'Expenses ($)',
              data: weeklyCost,
              backgroundColor: '#e74c3c',
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor } },
            y: { grid: { color: gridColor }, ticks: { color: textColor } }
          }
        }
      });

    } else if (activeReportTab === 'products') {
      chartTitle.textContent = "Product Units Sold (This Month)";
      metric1Lbl.textContent = "Best Seller";
      metric1Val.textContent = "Floral Cupcakes";
      metric1Val.className = "box-value";
      metric2Lbl.textContent = "Units Sold";
      metric2Val.textContent = "45 Units";
      metric3Lbl.textContent = "Second Best";
      metric3Val.textContent = "Birthday Cakes (28)";
      metric4Lbl.textContent = "Unique Catalog Items";
      metric4Val.textContent = "8 Products";
      metric4Val.className = "box-value text-info";

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: ['Floral Cupcakes', 'Birthday Cakes', 'Cookies', 'Brownies', 'Cupcake Bouquets'],
          datasets: [{
            label: 'Orders Count',
            data: [45, 28, 22, 18, 15],
            backgroundColor: '#8e44ad',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          scales: {
            x: { grid: { color: gridColor }, ticks: { color: textColor } },
            y: { grid: { display: false }, ticks: { color: textColor } }
          }
        }
      });

    } else if (activeReportTab === 'customers') {
      chartTitle.textContent = "Top Customers Spent ($)";

      const sortedCust = [...this.customers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 5);

      metric1Lbl.textContent = "MVP Customer";
      metric1Val.textContent = sortedCust[0] ? sortedCust[0].name : '-';
      metric1Val.className = "box-value";
      metric2Lbl.textContent = "MVP Total Spent";
      metric2Val.textContent = sortedCust[0] ? `$${sortedCust[0].totalSpent.toFixed(2)}` : '$0.00';
      metric3Lbl.textContent = "Average Spending";

      const totalSpentAll = this.customers.reduce((sum, c) => sum + c.totalSpent, 0);
      const avgSpent = this.customers.length > 0 ? totalSpentAll / this.customers.length : 0;
      metric3Val.textContent = `$${avgSpent.toFixed(2)}`;

      metric4Lbl.textContent = "Total Database Size";
      metric4Val.textContent = `${this.customers.length} Contacts`;
      metric4Val.className = "box-value text-neutral";

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: sortedCust.map(c => c.name),
          datasets: [{
            label: 'Total Spent ($)',
            data: sortedCust.map(c => c.totalSpent),
            backgroundColor: '#3498db',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor } },
            y: { grid: { color: gridColor }, ticks: { color: textColor } }
          }
        }
      });
    }
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - SETTINGS VIEW
  // ----------------------------------------------------
  renderSettings() {
    document.getElementById('setting-biz-name').value = this.settings.businessName || '';
    document.getElementById('setting-biz-email').value = this.settings.email || '';
    document.getElementById('setting-biz-phone').value = this.settings.phone || '';
    document.getElementById('setting-biz-address').value = this.settings.address || '';
    document.getElementById('setting-biz-currency').value = this.settings.currency || 'CAD';
    document.getElementById('setting-biz-timezone').value = this.settings.timezone || 'EST';
  },

  // ----------------------------------------------------
  // PAGINATION CONTROLS GENERATOR
  // ----------------------------------------------------
  renderPaginationControls(type, totalPages) {
    const container = document.getElementById(`${type}-pagination-controls`);
    container.innerHTML = '';

    const prevBtn = document.createElement('button');
    prevBtn.className = `btn-icon btn-sm ${this.pagination[type].current === 1 ? 'disabled' : ''}`;
    prevBtn.innerHTML = `<i data-lucide="chevron-left" style="width:14px; height:14px;"></i>`;
    if (this.pagination[type].current > 1) {
      prevBtn.addEventListener('click', () => {
        this.pagination[type].current--;
        this.refreshActiveTabTable();
      });
    }
    container.appendChild(prevBtn);

    for (let i = 1; i <= totalPages; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `btn btn-sm ${this.pagination[type].current === i ? 'active' : 'btn-outline'}`;
      pageBtn.style.padding = '6px 12px';
      pageBtn.textContent = i;

      pageBtn.addEventListener('click', () => {
        this.pagination[type].current = i;
        this.refreshActiveTabTable();
      });
      container.appendChild(pageBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = `btn-icon btn-sm ${this.pagination[type].current === totalPages ? 'disabled' : ''}`;
    nextBtn.innerHTML = `<i data-lucide="chevron-right" style="width:14px; height:14px;"></i>`;
    if (this.pagination[type].current < totalPages) {
      nextBtn.addEventListener('click', () => {
        this.pagination[type].current++;
        this.refreshActiveTabTable();
      });
    }
    container.appendChild(nextBtn);
  },

  refreshActiveTabTable() {
    if (this.activeTab === 'orders') this.renderOrdersTable();
    else if (this.activeTab === 'expenses') this.renderExpensesTable();
    else if (this.activeTab === 'customers') this.renderCustomersTable();
    else if (this.activeTab === 'inventory') this.renderInventoryTable();
    else if (this.activeTab === 'payments') this.renderPaymentsTable();
  },

  // ----------------------------------------------------
  // MODALS OPERATIONS
  // ----------------------------------------------------
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('active');

    if (modalId === 'orderModal') {
      document.getElementById('orderForm').reset();
      document.getElementById('order-form-id').value = '';
      document.getElementById('orderModalTitle').textContent = 'New Order';
      document.getElementById('order-form-pickup').value = '2025-07-31T12:00';
    } else if (modalId === 'expenseModal') {
      document.getElementById('expenseForm').reset();
      document.getElementById('expense-form-id').value = '';
      document.getElementById('expenseModalTitle').textContent = 'Add Expense';

      this.populateCategoryDropdowns();

      const todayVal = this.currentDate.toISOString().slice(0, 10);
      document.getElementById('expense-form-date').value = todayVal;
    } else if (modalId === 'customerModal') {
      document.getElementById('customerForm').reset();
      document.getElementById('customer-form-id').value = '';
      document.getElementById('customerModalTitle').textContent = 'Add Customer';
    } else if (modalId === 'inventoryModal') {
      document.getElementById('inventoryForm').reset();
      document.getElementById('inventory-form-id').value = '';
      document.getElementById('inventoryModalTitle').textContent = 'Add Inventory Item';
      this.populateCategoryDropdowns();
    } else if (modalId === 'expenseCategoriesModal') {
      this.renderExpenseCategoriesManager();
    } else if (modalId === 'inventoryCategoriesModal') {
      this.renderInventoryCategoriesManager();
    }

    lucide.createIcons();
  },

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  },

  populateCategoryDropdowns() {
    const expSelect = document.getElementById('expense-form-category');
    if (expSelect) {
      expSelect.innerHTML = '';
      this.expenseCategories.forEach(cat => {
        expSelect.insertAdjacentHTML('beforeend', `<option value="${cat}">${cat}</option>`);
      });
    }

    const expFilter = document.getElementById('expense-category-filter');
    if (expFilter && expFilter.children.length <= 1) {
      expFilter.innerHTML = '<option value="all">All Categories</option>';
      this.expenseCategories.forEach(cat => {
        expFilter.insertAdjacentHTML('beforeend', `<option value="${cat}">${cat}</option>`);
      });
    }

    const invSelect = document.getElementById('inventory-form-category');
    if (invSelect) {
      invSelect.innerHTML = '';
      this.inventoryCategories.forEach(cat => {
        invSelect.insertAdjacentHTML('beforeend', `<option value="${cat}">${cat}</option>`);
      });
    }

    const invFilter = document.getElementById('inventory-category-filter');
    if (invFilter && invFilter.children.length <= 1) {
      invFilter.innerHTML = '<option value="all">All Categories</option>';
      this.inventoryCategories.forEach(cat => {
        invFilter.insertAdjacentHTML('beforeend', `<option value="${cat}">${cat}</option>`);
      });
    }
  },

  // ----------------------------------------------------
  // SUBMISSIONS HANDLERS (CRUD CREATES/UPDATES)
  // ----------------------------------------------------
  handleOrderSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('order-form-id').value;
    const customerName = document.getElementById('order-form-customer').value;
    const customerPhone = document.getElementById('order-form-phone').value;
    const customerEmail = document.getElementById('order-form-email').value;
    const items = document.getElementById('order-form-items').value;
    const pickupDate = document.getElementById('order-form-pickup').value;
    const amount = parseFloat(document.getElementById('order-form-amount').value);
    const paymentStatus = document.getElementById('order-form-payment').value;
    const orderStatus = document.getElementById('order-form-status').value;
    const notes = document.getElementById('order-form-notes').value;

    let targetOrder = null;
    if (id) {
      const idx = this.orders.findIndex(o => o.id === id);
      if (idx !== -1) {
        this.orders[idx] = { ...this.orders[idx], customerName, customerPhone, customerEmail, items, pickupDate, amount, paymentStatus, orderStatus, notes };
        targetOrder = this.orders[idx];
      }
    } else {
      const newId = `HS-2025-0${76 + this.orders.length}`;
      targetOrder = { id: newId, customerName, customerPhone, customerEmail, items, pickupDate, amount, paymentStatus, orderStatus, notes };
      this.orders.push(targetOrder);
    }

    this.updateCustomerProfile(customerName, customerPhone, customerEmail, amount);

    this.saveState();
    if (targetOrder) this.saveToDrive();

    this.closeModal('orderModal');

    if (this.activeTab === 'dashboard') this.renderDashboard();
    else if (this.activeTab === 'orders') this.renderOrdersTable();
    else if (this.activeTab === 'calendar') this.renderCalendar();
  },

  updateCustomerProfile(name, phone, email, amount) {
    const custIdx = this.customers.findIndex(c => c.name.toLowerCase() === name.toLowerCase() || c.phone === phone);
    const dateStr = this.currentDate.toISOString().slice(0, 10);

    if (custIdx !== -1) {
      this.customers[custIdx].totalOrders += 1;
      this.customers[custIdx].totalSpent += amount;
      this.customers[custIdx].lastOrder = dateStr;
      if (email) this.customers[custIdx].email = email;
    } else {
      const nextId = `CUST-${this.customers.length + 1}`;
      this.customers.push({
        id: nextId,
        name: name,
        phone: phone,
        email: email || '',
        totalOrders: 1,
        totalSpent: amount,
        lastOrder: dateStr
      });
    }
  },

  editOrder(id) {
    const order = this.orders.find(o => o.id === id);
    if (!order) return;

    this.openModal('orderModal');

    document.getElementById('order-form-id').value = order.id;
    document.getElementById('order-form-customer').value = order.customerName;
    document.getElementById('order-form-phone').value = order.customerPhone;
    document.getElementById('order-form-email').value = order.customerEmail || '';
    document.getElementById('order-form-items').value = order.items;
    document.getElementById('order-form-pickup').value = order.pickupDate;
    document.getElementById('order-form-amount').value = order.amount;
    document.getElementById('order-form-payment').value = order.paymentStatus;
    document.getElementById('order-form-status').value = order.orderStatus;
    document.getElementById('order-form-notes').value = order.notes || '';

    document.getElementById('orderModalTitle').textContent = `Edit Order ${id}`;
  },

  deleteOrder(id) {
    if (confirm(`Are you sure you want to delete order ${id}?`)) {
      this.orders = this.orders.filter(o => o.id !== id);
      this.saveState();
      this.saveToDrive();
      this.refreshActiveTabTable();
    }
  },

  handleExpenseSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('expense-form-id').value;
    const date = document.getElementById('expense-form-date').value;
    const category = document.getElementById('expense-form-category').value;
    const item = document.getElementById('expense-form-item').value;
    const amount = parseFloat(document.getElementById('expense-form-amount').value);
    const method = document.getElementById('expense-form-method').value;
    const notes = document.getElementById('expense-form-notes').value;

    let targetExp = null;
    if (id) {
      const idx = this.expenses.findIndex(exp => exp.id === id);
      if (idx !== -1) {
        this.expenses[idx] = { ...this.expenses[idx], date, category, item, amount, method, notes };
        targetExp = this.expenses[idx];
      }
    } else {
      const newId = `EXP-${this.expenses.length + 1}`;
      targetExp = { id: newId, date, category, item, amount, method, notes };
      this.expenses.push(targetExp);
    }

    this.saveState();
    if (targetExp) this.saveToDrive();

    this.closeModal('expenseModal');

    if (this.activeTab === 'dashboard') this.renderDashboard();
    else if (this.activeTab === 'expenses') this.renderExpensesTable();
  },

  editExpense(id) {
    const exp = this.expenses.find(e => e.id === id);
    if (!exp) return;

    this.openModal('expenseModal');

    document.getElementById('expense-form-id').value = exp.id;
    document.getElementById('expense-form-date').value = exp.date;
    document.getElementById('expense-form-category').value = exp.category;
    document.getElementById('expense-form-item').value = exp.item;
    document.getElementById('expense-form-amount').value = exp.amount;
    document.getElementById('expense-form-method').value = exp.method;
    document.getElementById('expense-form-notes').value = exp.notes || '';

    document.getElementById('expenseModalTitle').textContent = "Edit Expense";
  },

  deleteExpense(id) {
    if (confirm("Are you sure you want to delete this expense transaction?")) {
      this.expenses = this.expenses.filter(e => e.id !== id);
      this.saveState();
      this.saveToDrive();
      this.refreshActiveTabTable();
    }
  },

  handleCustomerSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('customer-form-id').value;
    const name = document.getElementById('customer-form-name').value;
    const phone = document.getElementById('customer-form-phone').value;
    const email = document.getElementById('customer-form-email').value;

    let targetCust = null;
    if (id) {
      const idx = this.customers.findIndex(c => c.id === id);
      if (idx !== -1) {
        this.customers[idx] = { ...this.customers[idx], name, phone, email };
        targetCust = this.customers[idx];
      }
    } else {
      const newId = `CUST-${this.customers.length + 1}`;
      targetCust = { id: newId, name, phone, email, totalOrders: 0, totalSpent: 0, lastOrder: '' };
      this.customers.push(targetCust);
    }

    this.saveState();
    if (targetCust) this.saveToDrive();

    this.closeModal('customerModal');
    this.renderCustomersTable();
  },

  editCustomer(id) {
    const cust = this.customers.find(c => c.id === id);
    if (!cust) return;

    this.openModal('customerModal');

    document.getElementById('customer-form-id').value = cust.id;
    document.getElementById('customer-form-name').value = cust.name;
    document.getElementById('customer-form-phone').value = cust.phone;
    document.getElementById('customer-form-email').value = cust.email || '';

    document.getElementById('customerModalTitle').textContent = "Edit Customer Profile";
  },

  deleteCustomer(id) {
    if (confirm("Are you sure you want to delete this customer?")) {
      this.customers = this.customers.filter(c => c.id !== id);
      this.saveState();
      this.saveToDrive();
      this.renderCustomersTable();
    }
  },

  handleInventorySubmit(e) {
    e.preventDefault();
    const id = document.getElementById('inventory-form-id').value;
    const name = document.getElementById('inventory-form-name').value;
    const category = document.getElementById('inventory-form-category').value;
    const stock = parseFloat(document.getElementById('inventory-form-stock').value);
    const unit = document.getElementById('inventory-form-unit').value;
    const threshold = parseFloat(document.getElementById('inventory-form-threshold').value);

    let targetInv = null;
    if (id) {
      const idx = this.inventory.findIndex(i => i.id === id);
      if (idx !== -1) {
        this.inventory[idx] = { ...this.inventory[idx], name, category, stock, unit, threshold };
        targetInv = this.inventory[idx];
      }
    } else {
      const newId = `INV-${this.inventory.length + 1}`;
      targetInv = { id: newId, name, category, stock, unit, threshold };
      this.inventory.push(targetInv);
    }

    this.saveState();
    if (targetInv) this.saveToDrive();

    this.closeModal('inventoryModal');
    this.renderInventoryTable();
  },

  editInventory(id) {
    const item = this.inventory.find(i => i.id === id);
    if (!item) return;

    this.openModal('inventoryModal');

    document.getElementById('inventory-form-id').value = item.id;
    document.getElementById('inventory-form-name').value = item.name;
    document.getElementById('inventory-form-category').value = item.category;
    document.getElementById('inventory-form-stock').value = item.stock;
    document.getElementById('inventory-form-unit').value = item.unit;
    document.getElementById('inventory-form-threshold').value = item.threshold;

    document.getElementById('inventoryModalTitle').textContent = "Edit Inventory Item";
  },

  deleteInventory(id) {
    if (confirm("Are you sure you want to delete this inventory item?")) {
      this.inventory = this.inventory.filter(i => i.id !== id);
      this.saveState();
      this.saveToDrive();
      this.renderInventoryTable();
    }
  },

  handleAddExpenseCat(e) {
    e.preventDefault();
    const input = document.getElementById('new-expense-category-input');
    const newCat = input.value.trim();
    if (newCat && !this.expenseCategories.includes(newCat)) {
      this.expenseCategories.push(newCat);
      this.saveState();
      input.value = '';
      this.renderExpenseCategoriesManager();
      this.populateCategoryDropdowns();
    }
  },

  removeExpenseCat(cat) {
    if (confirm(`Remove category "${cat}"? This will not delete transactions using it.`)) {
      this.expenseCategories = this.expenseCategories.filter(c => c !== cat);
      this.saveState();
      this.renderExpenseCategoriesManager();
      this.populateCategoryDropdowns();
    }
  },

  renderExpenseCategoriesManager() {
    const list = document.getElementById('expense-categories-list');
    list.innerHTML = '';
    this.expenseCategories.forEach(cat => {
      list.insertAdjacentHTML('beforeend', `
        <li class="manage-list-item">
          <span>${cat}</span>
          <button class="btn-remove-item" onclick="app.removeExpenseCat('${cat}')">
            <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
          </button>
        </li>
      `);
    });
    lucide.createIcons();
  },

  handleAddInventoryCat(e) {
    e.preventDefault();
    const input = document.getElementById('new-inventory-category-input');
    const newCat = input.value.trim();
    if (newCat && !this.inventoryCategories.includes(newCat)) {
      this.inventoryCategories.push(newCat);
      this.saveState();
      input.value = '';
      this.renderInventoryCategoriesManager();
      this.populateCategoryDropdowns();
    }
  },

  removeInventoryCat(cat) {
    if (confirm(`Remove category "${cat}"?`)) {
      this.inventoryCategories = this.inventoryCategories.filter(c => c !== cat);
      this.saveState();
      this.renderInventoryCategoriesManager();
      this.populateCategoryDropdowns();
    }
  },

  renderInventoryCategoriesManager() {
    const list = document.getElementById('inventory-categories-list');
    list.innerHTML = '';
    this.inventoryCategories.forEach(cat => {
      list.insertAdjacentHTML('beforeend', `
        <li class="manage-list-item">
          <span>${cat}</span>
          <button class="btn-remove-item" onclick="app.removeInventoryCat('${cat}')">
            <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
          </button>
        </li>
      `);
    });
    lucide.createIcons();
  },

  handleBusinessInfoSubmit(e) {
    e.preventDefault();
    this.settings.businessName = document.getElementById('setting-biz-name').value;
    this.settings.email = document.getElementById('setting-biz-email').value;
    this.settings.phone = document.getElementById('setting-biz-phone').value;
    this.settings.address = document.getElementById('setting-biz-address').value;
    this.settings.currency = document.getElementById('setting-biz-currency').value;
    this.settings.timezone = document.getElementById('setting-biz-timezone').value;
    this.saveState();
    document.querySelector('.brand-title h2').textContent = this.settings.businessName;
    alert("Business information updated successfully!");
  },

  // ----------------------------------------------------
  // BACKUP, RESET, AND MIGRATE
  // ----------------------------------------------------
  exportDatabaseBackup() {
    const dbDump = {
      orders: this.orders,
      expenses: this.expenses,
      customers: this.customers,
      inventory: this.inventory,
      expenseCategories: this.expenseCategories,
      inventoryCategories: this.inventoryCategories,
      settings: this.settings,
      theme: localStorage.getItem('hos_theme') || 'light'
    };

    const fileContent = JSON.stringify(dbDump, null, 2);
    const blob = new Blob([fileContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `house_of_sugar_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  importDatabaseBackup() {
    const fileInput = document.getElementById('backup-import-file');
    if (fileInput.files.length === 0) {
      alert("Please select a valid backup JSON file first.");
      return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.orders && data.expenses && data.customers && data.inventory) {
          if (confirm("This will replace all your current data. Do you want to proceed?")) {
            this.orders = data.orders;
            this.expenses = data.expenses;
            this.customers = data.customers;
            this.inventory = data.inventory;
            if (data.expenseCategories) this.expenseCategories = data.expenseCategories;
            if (data.inventoryCategories) this.inventoryCategories = data.inventoryCategories;
            if (data.settings) this.settings = data.settings;
            if (data.theme) localStorage.setItem('hos_theme', data.theme);

            this.saveState();
            alert("Database restored successfully! Reloading page...");
            window.location.reload();
          }
        } else {
          alert("Invalid backup file structure. Missing critical fields.");
        }
      } catch (err) {
        alert("Error parsing backup JSON file.");
      }
    };
    reader.readAsText(file);
  },

  resetDatabaseConfirm() {
    if (confirm("WARNING: This will wipe all current transactions and reset the tracker database. Are you sure?")) {
      localStorage.clear();
      window.location.reload();
    }
  },

  // Helpers
  getStatusBadgeType(status) {
    switch (status) {
      case 'Completed': return 'success';
      case 'Confirmed': return 'info';
      case 'In Progress': return 'warning';
      case 'Ready': return 'primary';
      case 'Cancelled': return 'danger';
      case 'Inquiry': return 'neutral';
      default: return 'neutral';
    }
  },

  getPaymentBadgeType(payment) {
    switch (payment) {
      case 'Paid': return 'success';
      case 'Deposit Paid': return 'info';
      case 'Unpaid': return 'danger';
      default: return 'neutral';
    }
  }
};

// Start the Application when DOM is fully ready
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
