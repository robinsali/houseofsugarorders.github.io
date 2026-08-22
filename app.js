/**
 * app.js - House of Sugar Order & Expense Tracker
 * Core Business Logic, State Engine, and Charts
 */

// Application State Namespace
const app = {
  // Security & Authentication State
  isAuthenticated: false,

  // Database Tables
  orders: [],
  expenses: [],
  customers: [],
  inventory: [],
  expenseCategories: [],
  inventoryCategories: [],
  recipes: [],
  activeRecipeId: null,
  isEditRecipeMode: false,
  settings: {},

  // UI Navigation & Filters
  activeTab: 'dashboard',
  currentDate: new Date(),

  // Dashboard Date Range & Period Filter ('all', 'today', 'week', 'month', 'year', 'custom')
  dashboardPeriod: 'all',
  dashboardDateStart: '',
  dashboardDateEnd: '',

  // Dashboard Mini-Calendar Date selectors
  miniCalDate: new Date(),
  miniCalSelectedDayStr: new Date().toISOString().slice(0, 10),

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

  // Column Sort States
  ordersSort: { col: 'pickupDate', dir: 'desc' },
  expensesSort: { col: 'date', dir: 'desc' },
  paymentsSort: { col: 'pickupDate', dir: 'desc' },

  // ----------------------------------------------------
  // INITIALIZATION & SECURITY GATEWAY
  // ----------------------------------------------------
  init() {
    this.setupEventListeners();
    this.updateGlobalHeader();

    // Show loading state initially while verifying OAuth session
    const loadingOverlay = document.getElementById('auth-loading-overlay');
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-main-container');

    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    if (authOverlay) authOverlay.style.display = 'none';
    if (appContainer) appContainer.style.display = 'none';

    this.initGoogleDrive();

    // Initialise Lucide icons
    lucide.createIcons();
  },

  // Load state from localStorage cache (offline/session support)
  loadState() {
    try {
      this.orders = JSON.parse(localStorage.getItem('hos_orders')) || [];
      this.expenses = JSON.parse(localStorage.getItem('hos_expenses')) || [];
      this.customers = JSON.parse(localStorage.getItem('hos_customers')) || [];
      this.inventory = JSON.parse(localStorage.getItem('hos_inventory')) || [];
      this.expenseCategories = JSON.parse(localStorage.getItem('hos_expense_categories')) || ['Ingredients', 'Packaging', 'Utilities', 'Marketing', 'Delivery', 'Equipment', 'Rent', 'Others'];
      this.inventoryCategories = JSON.parse(localStorage.getItem('hos_inventory_categories')) || ['Ingredients', 'Packaging', 'Decorations', 'Tools'];
      this.recipes = JSON.parse(localStorage.getItem('hos_recipes')) || [];
      this.settings = JSON.parse(localStorage.getItem('hos_settings')) || {};

      const theme = localStorage.getItem('hos_theme') || 'light';
      document.documentElement.setAttribute('data-theme', theme);
    } catch (e) {
      console.error("Error loading localStorage state:", e);
    }
  },

  // Save state to localStorage
  saveState() {
    if (!this.isAuthenticated) return; // Never persist unauthenticated state
    try {
      localStorage.setItem('hos_orders', JSON.stringify(this.orders));
      localStorage.setItem('hos_expenses', JSON.stringify(this.expenses));
      localStorage.setItem('hos_customers', JSON.stringify(this.customers));
      localStorage.setItem('hos_inventory', JSON.stringify(this.inventory));
      localStorage.setItem('hos_expense_categories', JSON.stringify(this.expenseCategories));
      localStorage.setItem('hos_inventory_categories', JSON.stringify(this.inventoryCategories));
      localStorage.setItem('hos_recipes', JSON.stringify(this.recipes));
      localStorage.setItem('hos_settings', JSON.stringify(this.settings));
    } catch (e) {
      console.error("Error saving localStorage state:", e);
    }
  },

  // ----------------------------------------------------
  // GOOGLE DRIVE SYNC ENGINE & SECURITY AUTHENTICATION
  // ----------------------------------------------------
  GOOGLE_CLIENT_ID: '186068315207-7ceuk54pdnfdp0pdhk3qlil890gs1n1d.apps.googleusercontent.com',
  DRIVE_FILE_NAME: 'house-of-sugar-data.json',

  driveFileId: null,
  isCloudSynced: false,
  accessToken: null,
  tokenClient: null,
  saveDriveTimer: null,

  initGoogleDrive() {
    // Check cached OAuth token
    try {
      const cached = JSON.parse(localStorage.getItem('hos_drive_token') || 'null');
      if (cached && cached.expires_at > Date.now()) {
        this.accessToken = cached.token;
        this.updateSignInUI(true);
        this.loadFromDrive();
        return;
      }
    } catch (e) { }

    // Check if previously authenticated in local mode
    if (localStorage.getItem('hos_authenticated') === 'true') {
      this.loadState();
      this.showAuthenticatedApp();
      return;
    }

    // No valid token -> show auth screen (ZERO business data rendered)
    localStorage.removeItem('hos_drive_token');
    this.showAuthScreen();
  },

  showAuthScreen() {
    this.isAuthenticated = false;
    this.accessToken = null;
    this.driveFileId = null;
    this.tokenClient = null;

    // Reset all memory database arrays to empty
    this.orders = [];
    this.expenses = [];
    this.customers = [];
    this.inventory = [];
    this.recipes = [];
    this.settings = {};

    // Clear DOM content to ensure zero business data leaks
    this.clearUIContainers();

    const loadingOverlay = document.getElementById('auth-loading-overlay');
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-main-container');

    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (authOverlay) authOverlay.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';

    this.updateSignInUI(false);
    this.updateCloudStatus(false, 'Drive: Sign In Required');
  },

  showAuthenticatedApp() {
    this.isAuthenticated = true;

    // If no orders or if orders only contain legacy outdated seed dates, initialize/refresh seed database
    const hasCurrentDates = this.orders.some(o => (o.pickupDate || '').slice(0, 4) === String(new Date().getFullYear()));
    if (this.orders.length === 0 || !hasCurrentDates) {
      this.seedDatabase();
    }

    const loadingOverlay = document.getElementById('auth-loading-overlay');
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-main-container');

    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (authOverlay) authOverlay.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';

    this.renderNotifications();
    this.switchTab(this.activeTab || 'dashboard');
  },

  clearUIContainers() {
    const textIds = [
      'today-orders-val', 'today-sales-val', 'today-expenses-val', 'today-profit-val',
      'pending-orders-val', 'payments-due-val', 'expenses-total-summary',
      'rep-metric-1-value', 'rep-metric-2-value', 'rep-metric-3-value', 'rep-metric-4-value'
    ];
    textIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '$0.00';
    });

    const htmlIds = [
      'dashboard-orders-table-body', 'dashboard-recent-expenses', 'dashboard-top-products',
      'orders-table-body', 'expenses-table-body', 'customers-table-body',
      'inventory-table-body', 'payments-table-body'
    ];
    htmlIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    if (this.charts.salesOverview) { this.charts.salesOverview.destroy(); this.charts.salesOverview = null; }
    if (this.charts.expenseSummary) { this.charts.expenseSummary.destroy(); this.charts.expenseSummary = null; }
    if (this.charts.reportsMain) { this.charts.reportsMain.destroy(); this.charts.reportsMain = null; }
  },

  _getTokenClient() {
    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.appdata',
        callback: (tokenResponse) => {
          if (tokenResponse.error) {
            console.warn('Google OAuth error:', tokenResponse.error);
            this.handleDemoSignIn();
            return;
          }
          this.accessToken = tokenResponse.access_token;
          const expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
          localStorage.setItem('hos_drive_token', JSON.stringify({
            token: this.accessToken,
            expires_at: expiresAt
          }));
          localStorage.setItem('hos_authenticated', 'true');
          this.updateSignInUI(true);
          this.loadFromDrive();
        }
      });
    }
    return this.tokenClient;
  },

  handleSignIn() {
    localStorage.setItem('hos_authenticated', 'true');
    if (typeof google === 'undefined' || !google.accounts) {
      this.handleDemoSignIn();
      return;
    }
    try {
      this._getTokenClient().requestAccessToken({ prompt: '' });
    } catch (err) {
      console.warn('Google Client OAuth Error:', err);
      this.handleDemoSignIn();
    }
  },

  handleDemoSignIn() {
    localStorage.setItem('hos_authenticated', 'true');
    this.loadState();
    if (this.orders.length === 0) {
      this.seedDatabase();
    }
    this.updateCloudStatus(false, 'Drive: Local Cache Mode');
    this.showAuthenticatedApp();
  },

  handleSignOut() {
    if (this.accessToken) {
      try { google.accounts.oauth2.revoke(this.accessToken, () => { }); } catch(e) {}
    }
    // Wipe local cache & session tokens completely on sign out
    localStorage.removeItem('hos_drive_token');
    localStorage.removeItem('hos_authenticated');
    localStorage.removeItem('hos_orders');
    localStorage.removeItem('hos_expenses');
    localStorage.removeItem('hos_customers');
    localStorage.removeItem('hos_inventory');
    localStorage.removeItem('hos_expense_categories');
    localStorage.removeItem('hos_inventory_categories');
    localStorage.removeItem('hos_recipes');
    localStorage.removeItem('hos_settings');

    this.showAuthScreen();
  },

  updateSignInUI(isSignedIn) {
    const signInBtn = document.getElementById('btn-google-signin');
    const signOutBtn = document.getElementById('btn-google-signout');
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
    if (!this.accessToken) {
      this.showAuthScreen();
      return;
    }
    try {
      this.updateCloudStatus(false, 'Drive: Loading...');

      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'${this.DRIVE_FILE_NAME}'&fields=files(id%2Cname)`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      if (listRes.status === 401) throw { status: 401 };
      if (!listRes.ok) throw { status: listRes.status };

      const listData = await listRes.json();

      if (listData.files && listData.files.length > 0) {
        this.driveFileId = listData.files[0].id;

        const fileRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${this.driveFileId}?alt=media`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } }
        );
        if (fileRes.status === 401) throw { status: 401 };
        if (!fileRes.ok) throw { status: fileRes.status };

        const data = await fileRes.json();

        // Merge Drive data into authenticated state
        this.orders = data.orders || [];
        this.expenses = data.expenses || [];
        this.customers = data.customers || [];
        this.inventory = data.inventory || [];
        this.expenseCategories = data.expenseCategories || ['Ingredients', 'Packaging', 'Utilities', 'Marketing', 'Delivery', 'Equipment', 'Rent', 'Others'];
        this.inventoryCategories = data.inventoryCategories || ['Ingredients', 'Packaging', 'Decorations', 'Tools'];
        this.recipes = data.recipes || [];
        this.settings = data.settings || {};

        this.saveState();
        this.updateCloudStatus(true, 'Drive: Live ✓');
        this.showAuthenticatedApp();
      } else {
        // First-time user on Drive
        this.orders = [];
        this.expenses = [];
        this.customers = [];
        this.inventory = [];
        this.expenseCategories = ['Ingredients', 'Packaging', 'Utilities', 'Marketing', 'Delivery', 'Equipment', 'Rent', 'Others'];
        this.inventoryCategories = ['Ingredients', 'Packaging', 'Decorations', 'Tools'];
        this.recipes = [];
        this.settings = {};

        await this.saveToDriveNow();
        this.updateCloudStatus(true, 'Drive: Live ✓');
        this.showAuthenticatedApp();
      }
    } catch (err) {
      console.warn('Drive load error:', err);
      if (err.status === 401) {
        localStorage.removeItem('hos_drive_token');
        this.showAuthScreen();
      } else {
        this.loadState();
        if (this.orders.length === 0) {
          this.seedDatabase();
        }
        this.updateCloudStatus(true, 'Local Storage Active ✓');
        this.showAuthenticatedApp();
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
        recipes: this.recipes,
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
        this.updateCloudStatus(true, 'Local Storage Saved ✓');
      }
    }
  },

  // Kept for backward compatibility (called by settings button)
  syncToDriveNow() {
    return this.saveToDriveNow();
  },

  // Seed default data matching user's screenshots
  seedDatabase() {
    // Dynamic date helper relative to current date (today)
    const now = new Date();
    const relativeISO = (offsetDays, hour = 12) => {
      const d = new Date(now);
      d.setDate(d.getDate() + offsetDays);
      d.setHours(hour, 0, 0, 0);
      return d.toISOString().slice(0, 16);
    };
    const relativeDateOnly = (offsetDays) => {
      const d = new Date(now);
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    };

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
      { id: 'CUST-1', name: 'Sarah Johnson', phone: '(416) 555-1234', email: 'sarah@gmail.com', totalOrders: 5, totalSpent: 450.00, lastOrder: relativeDateOnly(0) },
      { id: 'CUST-2', name: 'Emily Davis', phone: '(647) 555-5678', email: 'emily@gmail.com', totalOrders: 3, totalSpent: 280.00, lastOrder: relativeDateOnly(0) },
      { id: 'CUST-3', name: 'Michael Lee', phone: '(647) 555-9012', email: 'michael@gmail.com', totalOrders: 4, totalSpent: 320.00, lastOrder: relativeDateOnly(-1) },
      { id: 'CUST-4', name: 'Priya Sharma', phone: '(416) 555-3456', email: 'priya@gmail.com', totalOrders: 6, totalSpent: 560.00, lastOrder: relativeDateOnly(-2) },
      { id: 'CUST-5', name: 'David Wilson', phone: '(647) 555-7890', email: 'david@gmail.com', totalOrders: 2, totalSpent: 90.00, lastOrder: relativeDateOnly(-3) }
    ];

    // Orders relative to current date (today)
    this.orders = [
      {
        id: 'HS-2026-071',
        customerName: 'Sarah Johnson',
        customerPhone: '(416) 555-1234',
        customerEmail: 'sarah@gmail.com',
        items: 'Floral Cupcakes (12) - Vanilla',
        pickupDate: relativeISO(0, 12),
        advance: 30, remaining: 35, total: 65,
        payments: ['Deposit paid-Interac', 'Total paid-Interac'],
        platform: 'Instagram',
        orderStatus: 'Ready',
        notes: 'Vanilla flavor, light pink icing.'
      },
      {
        id: 'HS-2026-072',
        customerName: 'Emily Davis',
        customerPhone: '(647) 555-5678',
        customerEmail: 'emily@gmail.com',
        items: 'Birthday Cake (2.5kg) - Chocolate',
        pickupDate: relativeISO(0, 15),
        advance: 60, remaining: 60, total: 120,
        payments: ['Deposit paid-Cash'],
        platform: 'Facebook-HOS',
        orderStatus: 'In Progress',
        notes: 'Write "Happy 10th Birthday Chloe!" on top.'
      },
      {
        id: 'HS-2026-073',
        customerName: 'Michael Lee',
        customerPhone: '(647) 555-9012',
        customerEmail: 'michael@gmail.com',
        items: 'Cookies (24 pcs) - Chocolate Chip',
        pickupDate: relativeISO(0, 16),
        advance: 40, remaining: 0, total: 40,
        payments: ['Total paid-Cash'],
        platform: 'Whatsapp',
        orderStatus: 'Confirmed',
        notes: 'Wrap in luxury ribbons.'
      },
      {
        id: 'HS-2026-074',
        customerName: 'Priya Sharma',
        customerPhone: '(416) 555-3456',
        customerEmail: 'priya@gmail.com',
        items: 'Floral Cupcake Bouquet - Pink Theme',
        pickupDate: relativeISO(1, 11),
        advance: 35, remaining: 40, total: 75,
        payments: ['Deposit paid-Interac'],
        platform: 'Marketplace-HOS',
        orderStatus: 'Confirmed',
        notes: 'Bouquet arrangement of cupcakes.'
      },
      {
        id: 'HS-2026-075',
        customerName: 'David Wilson',
        customerPhone: '(647) 555-7890',
        customerEmail: 'david@gmail.com',
        items: 'Brownies (16 pcs) - Fudgy',
        pickupDate: relativeISO(2, 14),
        advance: 0, remaining: 45, total: 45,
        payments: [],
        platform: 'Marketplace-Arzu',
        orderStatus: 'Inquiry',
        notes: 'Inquiry only, draft order.'
      },
      { id: 'HB-2026-060', customerName: 'Sarah Johnson', customerPhone: '(416) 555-1234', customerEmail: 'sarah@gmail.com', items: 'Custom Cupcakes x6', pickupDate: relativeISO(-1, 10), advance: 50, remaining: 0, total: 50, payments: ['Total paid-Cash'], platform: 'Instagram', orderStatus: 'Completed', notes: '' },
      { id: 'HB-2026-061', customerName: 'Emily Davis', customerPhone: '(647) 555-5678', customerEmail: 'emily@gmail.com', items: 'Red Velvet Cake', pickupDate: relativeISO(-2, 11), advance: 90, remaining: 0, total: 90, payments: ['Total paid-Interac'], platform: 'Facebook-HOS', orderStatus: 'Completed', notes: '' },
      { id: 'HB-2026-062', customerName: 'Priya Sharma', customerPhone: '(416) 555-3456', customerEmail: 'priya@gmail.com', items: 'Rose Cupcakes x12', pickupDate: relativeISO(-3, 12), advance: 80, remaining: 0, total: 80, payments: ['Total paid-Interac'], platform: 'Marketplace-HOS', orderStatus: 'Completed', notes: '' },
      { id: 'HB-2026-063', customerName: 'Michael Lee', customerPhone: '(647) 555-9012', customerEmail: 'michael@gmail.com', items: 'Chocolate Brownies x12', pickupDate: relativeISO(-4, 14), advance: 35, remaining: 0, total: 35, payments: ['Total paid-Cash'], platform: 'Whatsapp', orderStatus: 'Completed', notes: '' },
      { id: 'HB-2026-064', customerName: 'Priya Sharma', customerPhone: '(416) 555-3456', customerEmail: 'priya@gmail.com', items: 'Birthday Cake 1.5kg', pickupDate: relativeISO(-5, 10), advance: 75, remaining: 0, total: 75, payments: ['Total paid-Cash'], platform: 'Facebook-Arzu', orderStatus: 'Completed', notes: '' }
    ];

    // Seed more orders across recent days
    const platforms = ['Instagram', 'Facebook-HOS', 'Whatsapp', 'Marketplace-HOS', 'Marketplace-Arzu', 'Facebook-Arzu'];
    for (let i = 1; i <= 18; i++) {
      const customersList = this.customers;
      const cust = customersList[Math.floor(Math.random() * customersList.length)];
      const total = [35, 45, 75, 90, 110, 150][Math.floor(Math.random() * 6)];
      const advance = Math.floor(total / 2);
      const status = ['Completed', 'Completed', 'Completed', 'Confirmed', 'In Progress', 'Ready'][Math.floor(Math.random() * 6)];
      const pmts = status === 'Completed' ? ['Total paid-Cash'] : (Math.random() > 0.5 ? ['Deposit paid-Interac'] : []);

      const dayOffset = -Math.floor(Math.random() * 25);
      const dateStr = relativeISO(dayOffset, 12);

      this.orders.push({
        id: `HS-2026-0${5 + i}`,
        customerName: cust.name,
        customerPhone: cust.phone,
        customerEmail: cust.email,
        items: 'Assorted Bakery Products',
        pickupDate: dateStr,
        advance: advance,
        remaining: total - advance,
        total: total,
        payments: pmts,
        platform: platforms[Math.floor(Math.random() * platforms.length)],
        orderStatus: status,
        notes: 'Generated seed order.'
      });
    }

    // Expenses relative to current date
    this.expenses = [
      { id: 'EXP-1', date: relativeDateOnly(0), category: 'Ingredients', item: 'Flour (10kg)', amount: 35.00, method: 'Cash', notes: 'Wholesale Baker supplier' },
      { id: 'EXP-2', date: relativeDateOnly(0), category: 'Ingredients', item: 'Butter (2kg)', amount: 42.50, method: 'Cash', notes: 'Local store purchase' },
      { id: 'EXP-3', date: relativeDateOnly(-1), category: 'Packaging', item: 'Cake Boxes (10)', amount: 18.00, method: 'Cash', notes: 'Supplier delivery' },
      { id: 'EXP-4', date: relativeDateOnly(-2), category: 'Utilities', item: 'Electricity Bill', amount: 85.75, method: 'Online', notes: 'Monthly bill' },
      { id: 'EXP-5', date: relativeDateOnly(-3), category: 'Marketing', item: 'Instagram Ads', amount: 40.00, method: 'Card', notes: 'Promo campaign' },
      { id: 'EXP-6', date: relativeDateOnly(-4), category: 'Ingredients', item: 'Sugar (5kg)', amount: 22.00, method: 'Cash', notes: 'Store run' },
      { id: 'EXP-7', date: relativeDateOnly(-5), category: 'Delivery', item: 'Fuel', amount: 25.00, method: 'Cash', notes: 'Delivery van fill' }
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

      this.renderCharts();
    });

    // Notifications Click Trigger
    const bellTrigger = document.getElementById('notification-trigger');
    const bellDropdown = document.getElementById('notification-menu');
    if (bellTrigger && bellDropdown) {
      bellTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        bellDropdown.classList.toggle('active');
      });

      document.addEventListener('click', () => {
        bellDropdown.classList.remove('active');
      });
    }

    // Dashboard Period Select & Date Range Handlers
    const dashPeriodSelect = document.getElementById('dashboard-period-select');
    const dashDateStart = document.getElementById('dashboard-date-start');
    const dashDateEnd = document.getElementById('dashboard-date-end');

    if (dashPeriodSelect) {
      dashPeriodSelect.addEventListener('change', (e) => {
        const p = e.target.value;
        this.dashboardPeriod = p;
        if (p === 'all') {
          dashDateStart.value = '';
          dashDateEnd.value = '';
          this.dashboardDateStart = '';
          this.dashboardDateEnd = '';
        } else if (p !== 'custom') {
          const range = this.getPeriodDates(p);
          dashDateStart.value = range.start;
          dashDateEnd.value = range.end;
          this.dashboardDateStart = range.start;
          this.dashboardDateEnd = range.end;
        }
        this.renderDashboard();
      });
    }

    const onDashDateChange = () => {
      if (dashPeriodSelect) dashPeriodSelect.value = 'custom';
      this.dashboardPeriod = 'custom';
      const s = dashDateStart.value;
      const e = dashDateEnd.value;
      if (s && e && s > e) {
        alert('Start date cannot be after End date.');
        dashDateEnd.value = '';
        return;
      }
      this.dashboardDateStart = s;
      this.dashboardDateEnd = e;
      this.renderDashboard();
    };

    if (dashDateStart) dashDateStart.addEventListener('change', onDashDateChange);
    if (dashDateEnd) dashDateEnd.addEventListener('change', onDashDateChange);

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

    // Detail Report Open Actions when clicking Metric Cards (passes Date Range + KPI Filters)
    document.getElementById('card-sales-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('orders', { dateStart: this.dashboardDateStart, dateEnd: this.dashboardDateEnd, fromKPI: 'Sales' });
    });

    document.getElementById('card-expenses-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('expenses', { dateStart: this.dashboardDateStart, dateEnd: this.dashboardDateEnd, fromKPI: 'Expenses' });
    });

    document.getElementById('card-profit-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('reports', { reportType: 'profit', dateStart: this.dashboardDateStart, dateEnd: this.dashboardDateEnd, fromKPI: 'Profit' });
    });

    document.getElementById('card-orders-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('orders', { dateStart: this.dashboardDateStart, dateEnd: this.dashboardDateEnd, fromKPI: 'Orders' });
    });

    document.getElementById('card-pending-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('orders', { status: 'Pending', dateStart: this.dashboardDateStart, dateEnd: this.dashboardDateEnd, fromKPI: 'Pending Orders' });
    });

    document.getElementById('card-due-click-target').addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('payments', { payment: 'Unpaid', dateStart: this.dashboardDateStart, dateEnd: this.dashboardDateEnd, fromKPI: 'Payments Due' });
    });

    // Buttons bindings on Dashboard
    document.getElementById('btn-new-order-dash').addEventListener('click', () => this.openModal('orderModal'));
    document.getElementById('btn-add-expense-dash').addEventListener('click', () => this.openModal('expenseModal'));
    document.getElementById('btn-dash-cal-prev').addEventListener('click', () => this.dashboardCalendarPrevMonth());
    document.getElementById('btn-dash-cal-next').addEventListener('click', () => this.dashboardCalendarNextMonth());

    // Orders Filter & Sorting Handlers
    const reRenderOrders = () => {
      this.pagination.orders.current = 1;
      this.renderOrdersTable();
    };

    document.getElementById('order-search-input')?.addEventListener('input', reRenderOrders);
    document.getElementById('order-status-filter')?.addEventListener('change', reRenderOrders);
    document.getElementById('order-payment-filter')?.addEventListener('change', reRenderOrders);
    document.getElementById('order-payment-method-filter')?.addEventListener('change', reRenderOrders);
    document.getElementById('order-date-start')?.addEventListener('change', reRenderOrders);
    document.getElementById('order-date-end')?.addEventListener('change', reRenderOrders);

    const orderColFilters = [
      'col-filter-order-id', 'col-filter-order-customer', 'col-filter-order-items',
      'col-filter-order-advance-min', 'col-filter-order-remaining-min',
      'col-filter-order-total-min', 'col-filter-order-platform'
    ];
    orderColFilters.forEach(id => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('input', reRenderOrders);
    });

    // Orders Column Sort Headers
    document.querySelectorAll('#orders-table .sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort-col');
        if (this.ordersSort.col === col) {
          this.ordersSort.dir = this.ordersSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this.ordersSort.col = col;
          this.ordersSort.dir = 'asc';
        }
        this.renderOrdersTable();
      });
    });

    // Clear Orders Filters
    const btnClearOrders = document.getElementById('btn-clear-order-filters');
    if (btnClearOrders) {
      btnClearOrders.addEventListener('click', () => {
        if (document.getElementById('order-search-input')) document.getElementById('order-search-input').value = '';
        if (document.getElementById('order-status-filter')) document.getElementById('order-status-filter').value = 'all';
        if (document.getElementById('order-payment-filter')) document.getElementById('order-payment-filter').value = 'all';
        if (document.getElementById('order-payment-method-filter')) document.getElementById('order-payment-method-filter').value = 'all';
        if (document.getElementById('order-date-start')) document.getElementById('order-date-start').value = '';
        if (document.getElementById('order-date-end')) document.getElementById('order-date-end').value = '';
        orderColFilters.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        reRenderOrders();
      });
    }

    // Expenses Filter & Sorting Handlers
    const reRenderExpenses = () => {
      this.pagination.expenses.current = 1;
      this.renderExpensesTable();
    };

    document.getElementById('expense-search-input').addEventListener('input', reRenderExpenses);
    document.getElementById('expense-category-filter').addEventListener('change', reRenderExpenses);
    document.getElementById('expense-date-start').addEventListener('change', reRenderExpenses);
    document.getElementById('expense-date-end').addEventListener('change', reRenderExpenses);

    const expColFilters = ['col-filter-exp-item', 'col-filter-exp-amount-min', 'col-filter-exp-method', 'col-filter-exp-notes'];
    expColFilters.forEach(id => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('input', reRenderExpenses);
    });

    // Expenses Column Sort Headers
    document.querySelectorAll('#expenses-table .sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort-col');
        if (this.expensesSort.col === col) {
          this.expensesSort.dir = this.expensesSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this.expensesSort.col = col;
          this.expensesSort.dir = 'asc';
        }
        this.renderExpensesTable();
      });
    });

    // Clear Expenses Filters
    const btnClearExpenses = document.getElementById('btn-clear-expense-filters');
    if (btnClearExpenses) {
      btnClearExpenses.addEventListener('click', () => {
        document.getElementById('expense-search-input').value = '';
        document.getElementById('expense-category-filter').value = 'all';
        document.getElementById('expense-date-start').value = '';
        document.getElementById('expense-date-end').value = '';
        expColFilters.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        reRenderExpenses();
      });
    }

    // Payments Filter & Sorting Handlers
    const reRenderPayments = () => {
      this.pagination.payments.current = 1;
      this.renderPaymentsTable();
    };

    document.getElementById('payment-search-input')?.addEventListener('input', reRenderPayments);
    document.getElementById('payment-status-filter')?.addEventListener('change', reRenderPayments);
    document.getElementById('payment-method-filter')?.addEventListener('change', reRenderPayments);
    document.getElementById('payment-date-start')?.addEventListener('change', reRenderPayments);
    document.getElementById('payment-date-end')?.addEventListener('change', reRenderPayments);

    const payColFilters = [
      'col-filter-pay-id', 'col-filter-pay-customer', 'col-filter-pay-advance-min',
      'col-filter-pay-remaining-min', 'col-filter-pay-total-min', 'col-filter-pay-notes'
    ];
    payColFilters.forEach(id => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('input', reRenderPayments);
    });

    // Payments Column Sort Headers
    document.querySelectorAll('#payments-table .sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort-col');
        if (this.paymentsSort.col === col) {
          this.paymentsSort.dir = this.paymentsSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this.paymentsSort.col = col;
          this.paymentsSort.dir = 'asc';
        }
        this.renderPaymentsTable();
      });
    });

    // Clear Payments Filters
    const btnClearPayments = document.getElementById('btn-clear-payment-filters');
    if (btnClearPayments) {
      btnClearPayments.addEventListener('click', () => {
        if (document.getElementById('payment-search-input')) document.getElementById('payment-search-input').value = '';
        if (document.getElementById('payment-status-filter')) document.getElementById('payment-status-filter').value = 'all';
        if (document.getElementById('payment-method-filter')) document.getElementById('payment-method-filter').value = 'all';
        if (document.getElementById('payment-date-start')) document.getElementById('payment-date-start').value = '';
        if (document.getElementById('payment-date-end')) document.getElementById('payment-date-end').value = '';
        payColFilters.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        reRenderPayments();
      });
    }

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

    // Modal Forms Submissions
    document.getElementById('orderForm').addEventListener('submit', (e) => this.handleOrderSubmit(e));
    document.getElementById('expenseForm').addEventListener('submit', (e) => this.handleExpenseSubmit(e));
    document.getElementById('customerForm').addEventListener('submit', (e) => this.handleCustomerSubmit(e));
    document.getElementById('inventoryForm').addEventListener('submit', (e) => this.handleInventorySubmit(e));
    document.getElementById('recipeForm').addEventListener('submit', (e) => this.handleRecipeSubmit(e));
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

    // Reports date & period handlers
    const reportPeriodSelect = document.getElementById('report-period-select');
    const reportDateStart = document.getElementById('report-date-start');
    const reportDateEnd = document.getElementById('report-date-end');

    if (reportPeriodSelect) {
      reportPeriodSelect.addEventListener('change', (e) => {
        const p = e.target.value;
        if (p === 'all') {
          if (reportDateStart) reportDateStart.value = '';
          if (reportDateEnd) reportDateEnd.value = '';
        } else if (p !== 'custom') {
          const range = this.getPeriodDates(p);
          if (reportDateStart) reportDateStart.value = range.start;
          if (reportDateEnd) reportDateEnd.value = range.end;
        }
        this.renderReportsMain();
      });
    }

    const onReportDateChange = () => {
      if (reportPeriodSelect) reportPeriodSelect.value = 'custom';
      this.renderReportsMain();
    };

    if (reportDateStart) reportDateStart.addEventListener('change', onReportDateChange);
    if (reportDateEnd) reportDateEnd.addEventListener('change', onReportDateChange);

    const btnClearReport = document.getElementById('btn-clear-report-filters');
    if (btnClearReport) {
      btnClearReport.addEventListener('click', () => {
        if (reportPeriodSelect) reportPeriodSelect.value = 'all';
        if (reportDateStart) reportDateStart.value = '';
        if (reportDateEnd) reportDateEnd.value = '';
        this.renderReportsMain();
      });
    }

    const btnExportReport = document.getElementById('btn-export-report');
    if (btnExportReport) {
      btnExportReport.addEventListener('click', () => this.exportReportData());
    }

    // Settings sub-tab switches
    document.querySelectorAll('.settings-tab-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.settings-tab-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        try {
          item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch (err) {}

        const targetSection = item.getAttribute('data-settings-section');
        document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
        const targetEl = document.getElementById(`settings-${targetSection}`);
        if (targetEl) targetEl.classList.add('active');
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
    document.getElementById('btn-recipe-modal-close').addEventListener('click', () => this.closeModal('recipeModal'));
    document.getElementById('btn-recipe-modal-cancel').addEventListener('click', () => this.closeModal('recipeModal'));
    document.getElementById('btn-expense-cat-close').addEventListener('click', () => this.closeModal('expenseCategoriesModal'));
    document.getElementById('btn-inventory-cat-close').addEventListener('click', () => this.closeModal('inventoryCategoriesModal'));

    // Rows-per-page selectors
    document.getElementById('orders-rows-select').addEventListener('change', (e) => {
      this.pagination.orders.limit = parseInt(e.target.value);
      this.pagination.orders.current = 1;
      this.renderOrdersTable();
    });
    document.getElementById('expenses-rows-select').addEventListener('change', (e) => {
      this.pagination.expenses.limit = parseInt(e.target.value);
      this.pagination.expenses.current = 1;
      this.renderExpensesTable();
    });
    document.getElementById('customers-rows-select').addEventListener('change', (e) => {
      this.pagination.customers.limit = parseInt(e.target.value);
      this.pagination.customers.current = 1;
      this.renderCustomersTable();
    });
    document.getElementById('inventory-rows-select').addEventListener('change', (e) => {
      this.pagination.inventory.limit = parseInt(e.target.value);
      this.pagination.inventory.current = 1;
      this.renderInventoryTable();
    });
    document.getElementById('payments-rows-select').addEventListener('change', (e) => {
      this.pagination.payments.limit = parseInt(e.target.value);
      this.pagination.payments.current = 1;
      this.renderPaymentsTable();
    });

    // Calendar Navigation clicks
    document.getElementById('btn-calendar-prev').addEventListener('click', () => this.calendarPrevMonth());
    document.getElementById('btn-calendar-next').addEventListener('click', () => this.calendarNextMonth());

    // Import Triggers
    document.getElementById('btn-import-orders-trigger').addEventListener('click', () => this.openImportModal('orders'));
    document.getElementById('btn-import-expenses-trigger').addEventListener('click', () => this.openImportModal('expenses'));

    this.setupImportModalListeners();
  },

  getPeriodDates(period) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (period === 'today') {
      return { start: todayStr, end: todayStr };
    } else if (period === 'week') {
      const dayOfWeek = now.getDay();
      const distToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
      const mon = new Date(now);
      mon.setDate(now.getDate() + distToMon);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
    } else if (period === 'month') {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
      return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
    } else if (period === 'year') {
      const y = now.getFullYear();
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    return { start: '', end: '' };
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
      if (options.dateStart !== undefined) document.getElementById('order-date-start').value = options.dateStart;
      if (options.dateEnd !== undefined) document.getElementById('order-date-end').value = options.dateEnd;
      if (options.status !== undefined) document.getElementById('order-status-filter').value = options.status;
      if (options.payment !== undefined) document.getElementById('order-payment-filter').value = options.payment;
      if (options.method !== undefined && document.getElementById('order-payment-method-filter')) document.getElementById('order-payment-method-filter').value = options.method;
      this.renderOrdersTable();
    } else if (tabName === 'calendar') {
      this.renderCalendar();
    } else if (tabName === 'customers') {
      this.renderCustomersTable();
    } else if (tabName === 'expenses') {
      if (options.dateStart !== undefined) document.getElementById('expense-date-start').value = options.dateStart;
      if (options.dateEnd !== undefined) document.getElementById('expense-date-end').value = options.dateEnd;
      this.populateCategoryDropdowns();
      this.renderExpensesTable();
    } else if (tabName === 'inventory') {
      this.populateCategoryDropdowns();
      this.renderInventoryTable();
    } else if (tabName === 'recipes') {
      this.renderRecipesWorkspace();
    } else if (tabName === 'payments') {
      if (options.dateStart !== undefined) document.getElementById('payment-date-start').value = options.dateStart;
      if (options.dateEnd !== undefined) document.getElementById('payment-date-end').value = options.dateEnd;
      if (options.payment !== undefined) document.getElementById('payment-status-filter').value = options.payment;
      if (options.method !== undefined && document.getElementById('payment-method-filter')) document.getElementById('payment-method-filter').value = options.method;
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
      if (options.dateStart !== undefined) document.getElementById('report-date-start').value = options.dateStart;
      if (options.dateEnd !== undefined) document.getElementById('report-date-end').value = options.dateEnd;
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
    const opt = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    const el = document.getElementById('current-header-date');
    if (el) el.textContent = new Date().toLocaleDateString('en-US', opt);
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
    const filterText = period === 'all' ? 'ALL TIME' : period.toUpperCase();

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

    // Sales Sum — use total field, fall back to legacy amount
    const salesTotal = orders.reduce((sum, o) => sum + (o.total ?? o.amount ?? 0), 0);
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

    // Pending Orders count (within the selected period)
    const pendingOrdersCount = orders.filter(o => o.orderStatus === 'Pending' || o.orderStatus === 'Confirmed' || o.orderStatus === 'In Progress' || o.orderStatus === 'Ready').length;
    document.getElementById('pending-orders-val').textContent = pendingOrdersCount;

    // Payments Due — sum of remaining field for non-cancelled orders with unpaid balance (within the selected period)
    const dueAmount = orders
      .filter(o => o.orderStatus !== 'Cancelled')
      .reduce((sum, o) => {
        const rem = o.remaining ?? 0;
        return sum + rem;
      }, 0);

    document.getElementById('payments-due-val').textContent = `$${dueAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  // Helper: filter orders by period & date range dynamically
  getOrdersInPeriod(period) {
    let start = this.dashboardDateStart;
    let end = this.dashboardDateEnd;

    if ((!period || period === 'all') && !start && !end) {
      return this.orders.filter(o => o.orderStatus !== 'Cancelled');
    }

    if (period && period !== 'custom' && period !== 'all' && (!start || !end)) {
      const dates = this.getPeriodDates(period);
      start = dates.start;
      end = dates.end;
    }

    return this.orders.filter(o => {
      if (o.orderStatus === 'Cancelled') return false;
      const dStr = (o.pickupDate || '').slice(0, 10);
      if (!dStr) return false;
      if (start && dStr < start) return false;
      if (end && dStr > end) return false;
      return true;
    });
  },

  // Helper: filter expenses by period & date range dynamically
  getExpensesInPeriod(period) {
    let start = this.dashboardDateStart;
    let end = this.dashboardDateEnd;

    if ((!period || period === 'all') && !start && !end) {
      return this.expenses;
    }

    if (period && period !== 'custom' && period !== 'all' && (!start || !end)) {
      const dates = this.getPeriodDates(period);
      start = dates.start;
      end = dates.end;
    }

    return this.expenses.filter(e => {
      const dStr = (e.date || '').slice(0, 10);
      if (!dStr) return false;
      if (start && dStr < start) return false;
      if (end && dStr > end) return false;
      return true;
    });
  },

  // 1. Dashboard Orders Table
  renderDashboardOrdersTable() {
    const tableTitle = document.getElementById('dashboard-orders-table-title');
    const period = this.dashboardPeriod;
    const periodLabel = period === 'today' ? "Today" : (period === 'week' ? "This Week" : (period === 'month' ? "This Month" : (period === 'year' ? "This Year" : (period === 'custom' ? "Selected Range" : "All Time"))));
    tableTitle.textContent = `${periodLabel}'s Orders`;

    const orders = this.getOrdersInPeriod(period).sort((a, b) => b.pickupDate.localeCompare(a.pickupDate));
    const tbody = document.getElementById('dashboard-orders-table-body');
    tbody.innerHTML = '';

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--color-text-muted); padding: 30px;">No orders recorded in this period.</td></tr>`;
      return;
    }

    orders.slice(0, 5).forEach(o => {
      const initials = o.customerName ? o.customerName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'CU';
      const timeStr = new Date(o.pickupDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const pymtList = Array.isArray(o.payments) ? o.payments : (o.paymentStatus ? [o.paymentStatus] : []);
      const pymtDisplay = pymtList.length ? pymtList.map(p => `<span class="badge badge-info" style="font-size:0.58rem; padding:1px 5px; margin:1px;">${p}</span>`).join('') : '<span class="badge badge-danger" style="font-size:0.58rem; padding:1px 5px;">Unpaid</span>';
      const platformDisplay = o.platform ? `<span style="font-size:0.7rem; color:var(--color-text-muted);">${o.platform}</span>` : '-';

      const trHtml = `
        <tr>
          <td><span class="order-id-txt" style="font-size:0.8rem;">${o.id}</span></td>
          <td>
            <div class="customer-cell" style="gap:8px;">
              <div class="avatar-initials" style="width:26px; height:26px; font-size:0.65rem;">${initials}</div>
              <div class="customer-meta-info">
                <span class="customer-name" style="font-size:0.8rem; font-weight:600;">${o.customerName}</span>
                <span class="customer-phone" style="font-size:0.68rem;">${o.customerPhone || ''}</span>
              </div>
            </div>
          </td>
          <td style="font-size:0.8rem; max-width: 140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${o.items}</td>
          <td style="font-size:0.8rem;">${timeStr}</td>
          <td style="font-weight:600; font-size:0.8rem;">$${(o.advance ?? 0).toFixed(2)}</td>
          <td style="font-size:0.8rem;">$${(o.remaining ?? 0).toFixed(2)}</td>
          <td style="font-weight:600; font-size:0.8rem;">$${(o.total ?? o.amount ?? 0).toFixed(2)}</td>
          <td><span class="badge badge-${this.getStatusBadgeType(o.orderStatus)}" style="font-size:0.65rem; padding: 2px 8px;">${o.orderStatus}</span></td>
          <td>${pymtDisplay}</td>
          <td>${platformDisplay}</td>
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
    const expenses = this.getExpensesInPeriod(this.dashboardPeriod).slice(0, 5);
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

  // 3. Top Products List for Dashboard (Dynamic Calculation)
  renderTopProductsList() {
    const list = document.getElementById('dashboard-top-products');
    if (!list) return;
    list.innerHTML = '';

    const orders = this.getOrdersInPeriod(this.dashboardPeriod);
    const productCounts = {};

    orders.forEach(o => {
      if (!o.items) return;
      const itemsList = o.items.split(/[,;\+]/).map(i => i.trim()).filter(Boolean);
      itemsList.forEach(itemName => {
        productCounts[itemName] = (productCounts[itemName] || 0) + 1;
      });
    });

    const sortedProducts = Object.keys(productCounts)
      .map(name => ({ name, count: productCounts[name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    if (sortedProducts.length === 0) {
      list.innerHTML = `<div style="color:var(--color-text-muted); font-size:0.8rem; padding:15px 0;">No product sales in this period.</div>`;
      return;
    }

    const maxCount = Math.max(...sortedProducts.map(p => p.count), 1);

    sortedProducts.forEach(p => {
      const percentage = Math.min(100, (p.count / maxCount) * 100);
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

  // ----------------------------------------------------
  // RENDERING LOGIC - ORDERS VIEW (FULL FILTERING & SORTING)
  // ----------------------------------------------------
  renderOrdersTable() {
    const searchVal = (document.getElementById('order-search-input')?.value || '').toLowerCase();
    const statusVal = document.getElementById('order-status-filter')?.value || 'all';
    const paymentVal = document.getElementById('order-payment-filter')?.value || 'all';
    const methodVal = document.getElementById('order-payment-method-filter')?.value || 'all';
    const dateStart = document.getElementById('order-date-start')?.value || '';
    const dateEnd = document.getElementById('order-date-end')?.value || '';

    const colId = (document.getElementById('col-filter-order-id')?.value || '').toLowerCase();
    const colCust = (document.getElementById('col-filter-order-customer')?.value || '').toLowerCase();
    const colItems = (document.getElementById('col-filter-order-items')?.value || '').toLowerCase();
    const colAdvMin = parseFloat(document.getElementById('col-filter-order-advance-min')?.value) || 0;
    const colRemMin = parseFloat(document.getElementById('col-filter-order-remaining-min')?.value) || 0;
    const colTotMin = parseFloat(document.getElementById('col-filter-order-total-min')?.value) || 0;
    const colPlatform = (document.getElementById('col-filter-order-platform')?.value || '').toLowerCase();

    // Filter pipeline
    let filtered = this.orders.filter(o => {
      const pickupStr = (o.pickupDate || '').slice(0, 10);

      const matchesSearch = !searchVal ||
        o.id.toLowerCase().includes(searchVal) ||
        o.customerName.toLowerCase().includes(searchVal) ||
        (o.customerPhone && o.customerPhone.includes(searchVal)) ||
        o.items.toLowerCase().includes(searchVal);

      const matchesStatus = statusVal === 'all' || o.orderStatus === statusVal;

      const pymtList = Array.isArray(o.payments) ? o.payments : (o.paymentStatus ? [o.paymentStatus] : []);
      const pmtString = pymtList.join(' ').toLowerCase();

      const isPaid = (o.remaining === 0 && (o.total > 0 || o.amount > 0)) || pmtString.includes('total paid') || pmtString.includes('paid');
      const isDepositPaid = (o.advance > 0 && o.remaining > 0) || pmtString.includes('deposit paid') || pmtString.includes('deposit');
      const isUnpaid = ((!o.advance || o.advance === 0) && (o.remaining > 0 || o.total > 0)) || pmtString.includes('unpaid') || pymtList.length === 0;

      let matchesPayment = paymentVal === 'all';
      if (paymentVal === 'Paid') matchesPayment = isPaid;
      else if (paymentVal === 'Deposit Paid') matchesPayment = isDepositPaid;
      else if (paymentVal === 'Unpaid') matchesPayment = isUnpaid;

      const matchesMethod = methodVal === 'all' || pmtString.includes(methodVal.toLowerCase());

      const matchesDateStart = !dateStart || pickupStr >= dateStart;
      const matchesDateEnd = !dateEnd || pickupStr <= dateEnd;

      const matchesColId = !colId || o.id.toLowerCase().includes(colId);
      const matchesColCust = !colCust || o.customerName.toLowerCase().includes(colCust);
      const matchesColItems = !colItems || o.items.toLowerCase().includes(colItems);
      const matchesColAdv = (o.advance ?? 0) >= colAdvMin;
      const matchesColRem = (o.remaining ?? 0) >= colRemMin;
      const matchesColTot = (o.total ?? o.amount ?? 0) >= colTotMin;
      const matchesColPlatform = !colPlatform || (o.platform && o.platform.toLowerCase().includes(colPlatform));

      return matchesSearch && matchesStatus && matchesPayment && matchesMethod && matchesDateStart && matchesDateEnd &&
        matchesColId && matchesColCust && matchesColItems && matchesColAdv && matchesColRem && matchesColTot && matchesColPlatform;
    });

    // Sorting pipeline
    const { col, dir } = this.ordersSort;
    filtered.sort((a, b) => {
      let valA = a[col] ?? '';
      let valB = b[col] ?? '';

      if (col === 'total') { valA = a.total ?? a.amount ?? 0; valB = b.total ?? b.amount ?? 0; }
      else if (col === 'advance') { valA = a.advance ?? 0; valB = b.advance ?? 0; }
      else if (col === 'remaining') { valA = a.remaining ?? 0; valB = b.remaining ?? 0; }
      else if (col === 'payment') {
        const pA = Array.isArray(a.payments) ? a.payments.join(',') : (a.paymentStatus || '');
        const pB = Array.isArray(b.payments) ? b.payments.join(',') : (b.paymentStatus || '');
        valA = pA; valB = pB;
      }

      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB));
      }
      return dir === 'asc' ? cmp : -cmp;
    });

    // Update Header Sort Icons
    document.querySelectorAll('#orders-table .sortable-th').forEach(th => {
      const thCol = th.getAttribute('data-sort-col');
      th.classList.remove('sort-asc', 'sort-desc');
      if (thCol === col) {
        th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    // Summary Footer Totals across ALL filtered records
    const sumAdvance = filtered.reduce((s, o) => s + (o.advance ?? 0), 0);
    const sumRemaining = filtered.reduce((s, o) => s + (o.remaining ?? 0), 0);
    const sumTotal = filtered.reduce((s, o) => s + (o.total ?? o.amount ?? 0), 0);

    const tfootAdv = document.getElementById('orders-tfoot-advance');
    const tfootRem = document.getElementById('orders-tfoot-remaining');
    const tfootTot = document.getElementById('orders-tfoot-total');
    if (tfootAdv) tfootAdv.textContent = `$${sumAdvance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (tfootRem) tfootRem.textContent = `$${sumRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (tfootTot) tfootTot.textContent = `$${sumTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    // Update Filter Status Bar
    const statusBar = document.getElementById('orders-filter-status-bar');
    const statusText = document.getElementById('orders-filter-status-text');
    const totalAll = this.orders.length;

    const activeList = [];
    if (dateStart || dateEnd) activeList.push(`Date: ${dateStart || 'Start'} to ${dateEnd || 'End'}`);
    if (statusVal !== 'all') activeList.push(`Status: ${statusVal}`);
    if (paymentVal !== 'all') activeList.push(`Payment: ${paymentVal}`);
    if (searchVal) activeList.push(`Search: "${searchVal}"`);
    if (colId || colCust || colItems || colAdvMin || colRemMin || colTotMin || colPlatform) activeList.push(`Column Filters`);

    if (filtered.length < totalAll || activeList.length > 0) {
      if (statusBar) statusBar.style.display = 'flex';
      const summaryStr = activeList.length ? ` — Filters: ${activeList.join(' | ')}` : ' (Filtered)';
      if (statusText) statusText.textContent = `Showing ${filtered.length} of ${totalAll} orders${summaryStr}`;
    } else {
      if (statusBar) statusBar.style.display = 'none';
    }

    // Pagination pipeline
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
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--color-text-muted); padding: 40px;">No matching orders found.</td></tr>`;
      return;
    }

    paginated.forEach(o => {
      const dateOpt = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
      const pickupFormatted = new Date(o.pickupDate).toLocaleDateString('en-US', dateOpt);
      const initials = o.customerName ? o.customerName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'CU';
      const pymtList = Array.isArray(o.payments) ? o.payments : (o.paymentStatus ? [o.paymentStatus] : []);
      const pymtDisplay = pymtList.length ? pymtList.map(p => `<span class="badge badge-info" style="font-size:0.7rem; margin:1px;">${p}</span>`).join('') : '<span class="badge badge-danger">Unpaid</span>';
      const platformDisplay = o.platform || '-';

      const trHtml = `
        <tr>
          <td><span class="order-id-txt">${o.id}</span></td>
          <td>
            <div class="customer-cell">
              <div class="avatar-initials">${initials}</div>
              <div class="customer-meta-info">
                <span class="customer-name" style="font-weight:600;">${o.customerName}</span>
                <span class="customer-phone">${o.customerPhone || ''}</span>
              </div>
            </div>
          </td>
          <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${o.items}</td>
          <td>${pickupFormatted}</td>
          <td style="font-weight:600;">$${(o.advance ?? 0).toFixed(2)}</td>
          <td>$${(o.remaining ?? 0).toFixed(2)}</td>
          <td style="font-weight:600;">$${(o.total ?? o.amount ?? 0).toFixed(2)}</td>
          <td>${pymtDisplay}</td>
          <td><span style="font-size:0.8rem;">${platformDisplay}</span></td>
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
  // RENDERING LOGIC - EXPENSES VIEW (FULL FILTERING & SORTING)
  // ----------------------------------------------------
  renderExpensesTable() {
    const searchVal = (document.getElementById('expense-search-input')?.value || '').toLowerCase();
    const categoryVal = document.getElementById('expense-category-filter')?.value || 'all';
    const dateStartVal = document.getElementById('expense-date-start')?.value || '';
    const dateEndVal = document.getElementById('expense-date-end')?.value || '';

    const colItem = (document.getElementById('col-filter-exp-item')?.value || '').toLowerCase();
    const colAmountMin = parseFloat(document.getElementById('col-filter-exp-amount-min')?.value) || 0;
    const colMethod = (document.getElementById('col-filter-exp-method')?.value || '').toLowerCase();
    const colNotes = (document.getElementById('col-filter-exp-notes')?.value || '').toLowerCase();

    let filtered = this.expenses.filter(e => {
      const matchesSearch = !searchVal ||
        e.item.toLowerCase().includes(searchVal) ||
        (e.notes && e.notes.toLowerCase().includes(searchVal));

      const matchesCategory = categoryVal === 'all' || e.category === categoryVal;
      const matchesStart = !dateStartVal || e.date >= dateStartVal;
      const matchesEnd = !dateEndVal || e.date <= dateEndVal;

      const matchesColItem = !colItem || e.item.toLowerCase().includes(colItem);
      const matchesColAmount = e.amount >= colAmountMin;
      const matchesColMethod = !colMethod || (e.method && e.method.toLowerCase().includes(colMethod));
      const matchesColNotes = !colNotes || (e.notes && e.notes.toLowerCase().includes(colNotes));

      return matchesSearch && matchesCategory && matchesStart && matchesEnd &&
        matchesColItem && matchesColAmount && matchesColMethod && matchesColNotes;
    });

    const { col, dir } = this.expensesSort;
    filtered.sort((a, b) => {
      let valA = a[col] ?? '';
      let valB = b[col] ?? '';
      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB));
      }
      return dir === 'asc' ? cmp : -cmp;
    });

    document.querySelectorAll('#expenses-table .sortable-th').forEach(th => {
      const thCol = th.getAttribute('data-sort-col');
      th.classList.remove('sort-asc', 'sort-desc');
      if (thCol === col) {
        th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    const totalExpenseSum = filtered.reduce((sum, e) => sum + e.amount, 0);
    const summaryCard = document.getElementById('expenses-total-summary');
    const tfootAmt = document.getElementById('expenses-tfoot-amount');
    if (summaryCard) summaryCard.textContent = `$${totalExpenseSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (tfootAmt) tfootAmt.textContent = `$${totalExpenseSum.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const statusBar = document.getElementById('expenses-filter-status-bar');
    const statusText = document.getElementById('expenses-filter-status-text');
    const totalAll = this.expenses.length;

    const activeList = [];
    if (dateStartVal || dateEndVal) activeList.push(`Date: ${dateStartVal || 'Start'} to ${dateEndVal || 'End'}`);
    if (categoryVal !== 'all') activeList.push(`Category: ${categoryVal}`);
    if (searchVal) activeList.push(`Search: "${searchVal}"`);
    if (colItem || colAmountMin || colMethod || colNotes) activeList.push(`Column Filters`);

    if (filtered.length < totalAll || activeList.length > 0) {
      if (statusBar) statusBar.style.display = 'flex';
      const summaryStr = activeList.length ? ` — Filters: ${activeList.join(' | ')}` : ' (Filtered)';
      if (statusText) statusText.textContent = `Showing ${filtered.length} of ${totalAll} expenses${summaryStr}`;
    } else {
      if (statusBar) statusBar.style.display = 'none';
    }

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
  // RENDERING LOGIC - PAYMENTS LEDGER VIEW (FULL FILTERING & SORTING)
  // ----------------------------------------------------
  renderPaymentsTable() {
    const searchVal = (document.getElementById('payment-search-input')?.value || '').toLowerCase();
    const statusVal = document.getElementById('payment-status-filter')?.value || 'all';
    const methodVal = document.getElementById('payment-method-filter')?.value || 'all';
    const dateStart = document.getElementById('payment-date-start')?.value || '';
    const dateEnd = document.getElementById('payment-date-end')?.value || '';

    const colId = (document.getElementById('col-filter-pay-id')?.value || '').toLowerCase();
    const colCust = (document.getElementById('col-filter-pay-customer')?.value || '').toLowerCase();
    const colAdvMin = parseFloat(document.getElementById('col-filter-pay-advance-min')?.value) || 0;
    const colRemMin = parseFloat(document.getElementById('col-filter-pay-remaining-min')?.value) || 0;
    const colTotMin = parseFloat(document.getElementById('col-filter-pay-total-min')?.value) || 0;
    const colNotes = (document.getElementById('col-filter-pay-notes')?.value || '').toLowerCase();

    let filtered = this.orders.filter(o => {
      if (o.orderStatus === 'Cancelled') return false;
      const pickupStr = (o.pickupDate || '').slice(0, 10);

      const matchesSearch = !searchVal ||
        o.id.toLowerCase().includes(searchVal) ||
        o.customerName.toLowerCase().includes(searchVal) ||
        o.items.toLowerCase().includes(searchVal);

      const pymtList = Array.isArray(o.payments) ? o.payments : (o.paymentStatus ? [o.paymentStatus] : []);
      const pmtString = pymtList.join(' ').toLowerCase();

      const isPaid = (o.remaining === 0 && (o.total > 0 || o.amount > 0)) || pmtString.includes('total paid') || pmtString.includes('paid');
      const isDepositPaid = (o.advance > 0 && o.remaining > 0) || pmtString.includes('deposit paid') || pmtString.includes('deposit');
      const isUnpaid = ((!o.advance || o.advance === 0) && (o.remaining > 0 || o.total > 0)) || pmtString.includes('unpaid') || pymtList.length === 0;

      let matchesStatus = statusVal === 'all';
      if (statusVal === 'Paid') matchesStatus = isPaid;
      else if (statusVal === 'Deposit Paid') matchesStatus = isDepositPaid;
      else if (statusVal === 'Unpaid') matchesStatus = isUnpaid;

      const matchesMethod = methodVal === 'all' || pmtString.includes(methodVal.toLowerCase());

      const matchesDateStart = !dateStart || pickupStr >= dateStart;
      const matchesDateEnd = !dateEnd || pickupStr <= dateEnd;

      const matchesColId = !colId || o.id.toLowerCase().includes(colId);
      const matchesColCust = !colCust || o.customerName.toLowerCase().includes(colCust);
      const matchesColAdv = (o.advance ?? 0) >= colAdvMin;
      const matchesColRem = (o.remaining ?? 0) >= colRemMin;
      const matchesColTot = (o.total ?? o.amount ?? 0) >= colTotMin;
      const matchesColNotes = !colNotes || (o.notes && o.notes.toLowerCase().includes(colNotes));

      return matchesSearch && matchesStatus && matchesMethod && matchesDateStart && matchesDateEnd &&
        matchesColId && matchesColCust && matchesColAdv && matchesColRem && matchesColTot && matchesColNotes;
    });

    const { col, dir } = this.paymentsSort;
    filtered.sort((a, b) => {
      let valA = a[col] ?? '';
      let valB = b[col] ?? '';
      if (col === 'total') { valA = a.total ?? a.amount ?? 0; valB = b.total ?? b.amount ?? 0; }
      else if (col === 'advance') { valA = a.advance ?? 0; valB = b.advance ?? 0; }
      else if (col === 'remaining') { valA = a.remaining ?? 0; valB = b.remaining ?? 0; }

      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB));
      }
      return dir === 'asc' ? cmp : -cmp;
    });

    document.querySelectorAll('#payments-table .sortable-th').forEach(th => {
      const thCol = th.getAttribute('data-sort-col');
      th.classList.remove('sort-asc', 'sort-desc');
      if (thCol === col) {
        th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    const sumAdv = filtered.reduce((s, o) => s + (o.advance ?? 0), 0);
    const sumRem = filtered.reduce((s, o) => s + (o.remaining ?? 0), 0);
    const sumTot = filtered.reduce((s, o) => s + (o.total ?? o.amount ?? 0), 0);

    const tfootAdv = document.getElementById('payments-tfoot-advance');
    const tfootRem = document.getElementById('payments-tfoot-remaining');
    const tfootTot = document.getElementById('payments-tfoot-total');
    if (tfootAdv) tfootAdv.textContent = `$${sumAdv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (tfootRem) tfootRem.textContent = `$${sumRem.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (tfootTot) tfootTot.textContent = `$${sumTot.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const statusBar = document.getElementById('payments-filter-status-bar');
    const statusText = document.getElementById('payments-filter-status-text');
    const totalAll = this.orders.filter(o => o.orderStatus !== 'Cancelled').length;

    const activeList = [];
    if (dateStart || dateEnd) activeList.push(`Date: ${dateStart || 'Start'} to ${dateEnd || 'End'}`);
    if (statusVal !== 'all') activeList.push(`Status: ${statusVal}`);
    if (searchVal) activeList.push(`Search: "${searchVal}"`);
    if (colId || colCust || colAdvMin || colRemMin || colTotMin || colNotes) activeList.push(`Column Filters`);

    if (filtered.length < totalAll || activeList.length > 0) {
      if (statusBar) statusBar.style.display = 'flex';
      const summaryStr = activeList.length ? ` — Filters: ${activeList.join(' | ')}` : ' (Filtered)';
      if (statusText) statusText.textContent = `Showing ${filtered.length} of ${totalAll} payments${summaryStr}`;
    } else {
      if (statusBar) statusBar.style.display = 'none';
    }

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
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-text-muted); padding: 40px;">No payments found.</td></tr>`;
      return;
    }

    paginated.forEach(o => {
      const dateOpt = { month: 'short', day: 'numeric', year: 'numeric' };
      const dateStr = new Date(o.pickupDate).toLocaleDateString('en-US', dateOpt);
      const pymtList = Array.isArray(o.payments) ? o.payments : (o.paymentStatus ? [o.paymentStatus] : []);
      const pymtDisplay = pymtList.length ? pymtList.map(p => `<span class="badge badge-info" style="font-size:0.75rem; margin:1px;">${p}</span>`).join('') : '<span class="badge badge-danger">Unpaid</span>';

      const trHtml = `
        <tr>
          <td><span class="order-id-txt">${o.id}</span></td>
          <td style="font-weight:600;">${o.customerName}</td>
          <td>${dateStr}</td>
          <td style="font-weight:600;">$${(o.advance ?? 0).toFixed(2)}</td>
          <td>$${(o.remaining ?? 0).toFixed(2)}</td>
          <td style="font-weight:600;">$${(o.total ?? o.amount ?? 0).toFixed(2)}</td>
          <td>${pymtDisplay}</td>
          <td style="max-width: 250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.8rem; color:var(--color-text-muted);">${o.notes || '-'}</td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', trHtml);
    });

    lucide.createIcons();
  },

  // ----------------------------------------------------
  // RENDERING LOGIC - REPORTS VIEW (OVERHAULED FORMULAS)
  // ----------------------------------------------------
  setupReportsDates() {
    const startInput = document.getElementById('report-date-start');
    const endInput = document.getElementById('report-date-end');
    const periodSelect = document.getElementById('report-period-select');

    if (periodSelect && periodSelect.value !== 'all' && periodSelect.value !== 'custom') {
      const range = this.getPeriodDates(periodSelect.value);
      if (startInput) startInput.value = range.start;
      if (endInput) endInput.value = range.end;
    }
  },

  renderReportsMain() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(93, 54, 39, 0.3)' : 'rgba(240, 230, 232, 0.8)';
    const textColor = isDark ? '#b59c94' : '#8a7376';
    const primaryColor = isDark ? '#d9a962' : '#e05275';

    const activeReportTab = document.querySelector('.report-tab-item.active')?.getAttribute('data-report') || 'sales';
    const startD = document.getElementById('report-date-start').value;
    const endD = document.getElementById('report-date-end').value;

    // Filter orders & expenses strictly by selected date range
    const ordersInRange = this.orders.filter(o => {
      const orderDate = (o.pickupDate || '').slice(0, 10);
      return o.orderStatus !== 'Cancelled' && (!startD || orderDate >= startD) && (!endD || orderDate <= endD);
    });

    const expensesInRange = this.expenses.filter(e => {
      const expDate = (e.date || '').slice(0, 10);
      return (!startD || expDate >= startD) && (!endD || expDate <= endD);
    });

    if (this.charts.reportsMain) {
      this.charts.reportsMain.destroy();
      this.charts.reportsMain = null;
    }
    const ctxReport = document.getElementById('reportsMainChart').getContext('2d');

    const totalSales = ordersInRange.reduce((sum, o) => sum + (o.total ?? o.amount ?? 0), 0);
    const totalExpenses = expensesInRange.reduce((sum, e) => sum + e.amount, 0);
    const totalOrders = ordersInRange.length;
    const avgOrderVal = totalOrders > 0 ? totalSales / totalOrders : 0;
    const netProfit = totalSales - totalExpenses;

    // Growth calculation (compare against prior equal period length)
    let growthText = '0%';
    if (startD && endD) {
      const dStart = new Date(startD);
      const dEnd = new Date(endD);
      const diffMs = dEnd.getTime() - dStart.getTime();
      const diffDays = Math.max(1, Math.round(diffMs / 86400000)) + 1;

      const priorEnd = new Date(dStart.getTime() - 86400000);
      const priorStart = new Date(priorEnd.getTime() - ((diffDays - 1) * 86400000));
      const priorStartStr = priorStart.toISOString().slice(0, 10);
      const priorEndStr = priorEnd.toISOString().slice(0, 10);

      const priorOrders = this.orders.filter(o => {
        const d = (o.pickupDate || '').slice(0, 10);
        return o.orderStatus !== 'Cancelled' && d >= priorStartStr && d <= priorEndStr;
      });
      const priorSales = priorOrders.reduce((sum, o) => sum + (o.total ?? o.amount ?? 0), 0);

      if (priorSales > 0) {
        const pct = ((totalSales - priorSales) / priorSales) * 100;
        growthText = `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
      } else if (totalSales > 0) {
        growthText = '+100%';
      }
    }

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
      chartTitle.textContent = "Sales Revenue over Selected Period";
      metric1Lbl.textContent = "Total Sales";
      metric1Val.textContent = `$${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      metric1Val.className = "box-value";

      metric2Lbl.textContent = "Total Orders";
      metric2Val.textContent = totalOrders;

      metric3Lbl.textContent = "Avg Order Value";
      metric3Val.textContent = `$${avgOrderVal.toFixed(2)}`;

      metric4Lbl.textContent = "Growth (vs Prior Period)";
      metric4Val.textContent = growthText;
      metric4Val.className = growthText.startsWith('-') ? "box-value text-danger" : "box-value text-success";

      const dateMap = {};
      ordersInRange.forEach(o => {
        const day = (o.pickupDate || '').slice(0, 10);
        if (day) dateMap[day] = (dateMap[day] || 0) + (o.total ?? o.amount ?? 0);
      });
      const sortedDays = Object.keys(dateMap).sort();

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: sortedDays.length ? sortedDays : ['No Data'],
          datasets: [{
            label: 'Sales ($)',
            data: sortedDays.length ? sortedDays.map(d => dateMap[d]) : [0],
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

      metric2Lbl.textContent = "Largest Category";
      metric2Val.textContent = maxCategory;

      metric3Lbl.textContent = "Transactions";
      metric3Val.textContent = expensesInRange.length;

      metric4Lbl.textContent = "Status";
      metric4Val.textContent = expensesInRange.length > 0 ? "Active" : "No Expenses";
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
      chartTitle.textContent = "Net Profit (Sales vs Expenses)";
      metric1Lbl.textContent = "Net Profit";
      metric1Val.textContent = `$${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      metric1Val.className = netProfit >= 0 ? "box-value text-success" : "box-value text-danger";

      metric2Lbl.textContent = "Total Revenues";
      metric2Val.textContent = `$${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      metric3Lbl.textContent = "Total Outflows";
      metric3Val.textContent = `$${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      metric4Lbl.textContent = "Profit Margin";
      const margin = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
      metric4Val.textContent = `${margin.toFixed(1)}%`;
      metric4Val.className = margin >= 0 ? "box-value text-success" : "box-value text-danger";

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: ['Financial Overview'],
          datasets: [
            { label: 'Revenue ($)', data: [totalSales], backgroundColor: '#2ecc71', borderRadius: 4 },
            { label: 'Expenses ($)', data: [totalExpenses], backgroundColor: '#e74c3c', borderRadius: 4 },
            { label: 'Net Profit ($)', data: [netProfit], backgroundColor: primaryColor, borderRadius: 4 }
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
      chartTitle.textContent = "Best Selling Products";

      const productCounts = {};
      ordersInRange.forEach(o => {
        if (!o.items) return;
        const itemsList = o.items.split(/[,;\+]/).map(i => i.trim()).filter(Boolean);
        itemsList.forEach(itemName => {
          productCounts[itemName] = (productCounts[itemName] || 0) + 1;
        });
      });

      const sortedProd = Object.keys(productCounts)
        .map(name => ({ name, count: productCounts[name] }))
        .sort((a, b) => b.count - a.count);

      const best = sortedProd[0];
      metric1Lbl.textContent = "Best Seller";
      metric1Val.textContent = best ? best.name : 'None';
      metric1Val.className = "box-value";

      metric2Lbl.textContent = "Units Sold";
      metric2Val.textContent = best ? `${best.count} Orders` : '0 Units';

      metric3Lbl.textContent = "Second Best";
      metric3Val.textContent = sortedProd[1] ? `${sortedProd[1].name} (${sortedProd[1].count})` : 'None';

      metric4Lbl.textContent = "Unique Catalog Items";
      metric4Val.textContent = `${sortedProd.length} Products`;
      metric4Val.className = "box-value text-info";

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: sortedProd.length ? sortedProd.slice(0, 7).map(p => p.name) : ['No Orders'],
          datasets: [{
            label: 'Orders Count',
            data: sortedProd.length ? sortedProd.slice(0, 7).map(p => p.count) : [0],
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

      const custMap = {};
      ordersInRange.forEach(o => {
        if (!o.customerName) return;
        custMap[o.customerName] = (custMap[o.customerName] || 0) + (o.total ?? o.amount ?? 0);
      });

      const sortedCust = Object.keys(custMap)
        .map(name => ({ name, spent: custMap[name] }))
        .sort((a, b) => b.spent - a.spent);

      metric1Lbl.textContent = "MVP Customer";
      metric1Val.textContent = sortedCust[0] ? sortedCust[0].name : 'None';
      metric1Val.className = "box-value";

      metric2Lbl.textContent = "MVP Total Spent";
      metric2Val.textContent = sortedCust[0] ? `$${sortedCust[0].spent.toFixed(2)}` : '$0.00';

      metric3Lbl.textContent = "Average Spending";
      const totalSpentAll = sortedCust.reduce((s, c) => s + c.spent, 0);
      const avgSpent = sortedCust.length > 0 ? totalSpentAll / sortedCust.length : 0;
      metric3Val.textContent = `$${avgSpent.toFixed(2)}`;

      metric4Lbl.textContent = "Active Customers";
      metric4Val.textContent = `${sortedCust.length} Contacts`;
      metric4Val.className = "box-value text-neutral";

      this.charts.reportsMain = new Chart(ctxReport, {
        type: 'bar',
        data: {
          labels: sortedCust.length ? sortedCust.slice(0, 7).map(c => c.name) : ['No Customers'],
          datasets: [{
            label: 'Total Spent ($)',
            data: sortedCust.length ? sortedCust.slice(0, 7).map(c => c.spent) : [0],
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
    if (totalPages <= 1) return;

    const current = this.pagination[type].current;
    const WINDOW = 5; // max page buttons visible at once

    // Calculate the sliding window of pages to show
    let startPage = Math.max(1, current - Math.floor(WINDOW / 2));
    let endPage = startPage + WINDOW - 1;
    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - WINDOW + 1);
    }

    // Prev arrow
    const prevBtn = document.createElement('button');
    prevBtn.className = `btn-icon btn-sm${current === 1 ? ' disabled' : ''}`;
    prevBtn.innerHTML = `<i data-lucide="chevron-left" style="width:14px;height:14px;"></i>`;
    prevBtn.title = 'Previous page';
    if (current > 1) {
      prevBtn.addEventListener('click', () => {
        this.pagination[type].current--;
        this.refreshActiveTabTable();
      });
    }
    container.appendChild(prevBtn);

    // First page + ellipsis if window doesn't start at 1
    if (startPage > 1) {
      const firstBtn = document.createElement('button');
      firstBtn.className = 'btn btn-sm btn-outline';
      firstBtn.style.padding = '5px 10px';
      firstBtn.textContent = '1';
      firstBtn.addEventListener('click', () => {
        this.pagination[type].current = 1;
        this.refreshActiveTabTable();
      });
      container.appendChild(firstBtn);

      if (startPage > 2) {
        const dots = document.createElement('span');
        dots.className = 'pagination-ellipsis';
        dots.textContent = '…';
        container.appendChild(dots);
      }
    }

    // Windowed page buttons
    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `btn btn-sm ${current === i ? 'active' : 'btn-outline'}`;
      pageBtn.style.padding = '5px 10px';
      pageBtn.textContent = i;
      pageBtn.addEventListener('click', () => {
        this.pagination[type].current = i;
        this.refreshActiveTabTable();
      });
      container.appendChild(pageBtn);
    }

    // Ellipsis + last page if window doesn't reach the end
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        const dots = document.createElement('span');
        dots.className = 'pagination-ellipsis';
        dots.textContent = '…';
        container.appendChild(dots);
      }

      const lastBtn = document.createElement('button');
      lastBtn.className = 'btn btn-sm btn-outline';
      lastBtn.style.padding = '5px 10px';
      lastBtn.textContent = totalPages;
      lastBtn.addEventListener('click', () => {
        this.pagination[type].current = totalPages;
        this.refreshActiveTabTable();
      });
      container.appendChild(lastBtn);
    }

    // Next arrow
    const nextBtn = document.createElement('button');
    nextBtn.className = `btn-icon btn-sm${current === totalPages ? ' disabled' : ''}`;
    nextBtn.innerHTML = `<i data-lucide="chevron-right" style="width:14px;height:14px;"></i>`;
    nextBtn.title = 'Next page';
    if (current < totalPages) {
      nextBtn.addEventListener('click', () => {
        this.pagination[type].current++;
        this.refreshActiveTabTable();
      });
    }
    container.appendChild(nextBtn);

    lucide.createIcons();
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
      const now = new Date();
      const nowISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById('order-form-pickup').value = nowISO;
    } else if (modalId === 'expenseModal') {
      document.getElementById('expenseForm').reset();
      document.getElementById('expense-form-id').value = '';
      document.getElementById('expenseModalTitle').textContent = 'Add Expense';

      this.populateCategoryDropdowns();

      const todayVal = new Date().toISOString().slice(0, 10);
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
    } else if (modalId === 'recipeModal') {
      document.getElementById('recipeForm').reset();
      document.getElementById('recipe-form-id').value = '';
      document.getElementById('recipeModalTitle').textContent = 'New Product Recipe';
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
    const advance = parseInt(document.getElementById('order-form-advance').value) || 0;
    const remaining = parseInt(document.getElementById('order-form-remaining').value) || 0;
    const total = parseInt(document.getElementById('order-form-total').value) || 0;
    const payments = Array.from(document.querySelectorAll('#order-form-payment input[type=checkbox]:checked')).map(cb => cb.value);
    const platform = document.getElementById('order-form-platform').value;
    const orderStatus = document.getElementById('order-form-status').value;
    const notes = document.getElementById('order-form-notes').value;

    let targetOrder = null;
    if (id) {
      const idx = this.orders.findIndex(o => o.id === id);
      if (idx !== -1) {
        this.orders[idx] = { ...this.orders[idx], customerName, customerPhone, customerEmail, items, pickupDate, advance, remaining, total, payments, platform, orderStatus, notes };
        targetOrder = this.orders[idx];
      }
    } else {
      const newId = `HS-2025-0${76 + this.orders.length}`;
      targetOrder = { id: newId, customerName, customerPhone, customerEmail, items, pickupDate, advance, remaining, total, payments, platform, orderStatus, notes };
      this.orders.push(targetOrder);
    }

    this.updateCustomerProfile(customerName, customerPhone, customerEmail, total);

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
    document.getElementById('order-form-advance').value = order.advance ?? '';
    document.getElementById('order-form-remaining').value = order.remaining ?? '';
    document.getElementById('order-form-total').value = order.total ?? order.amount ?? '';
    // Restore payment checkboxes
    const pymtList = Array.isArray(order.payments) ? order.payments : (order.paymentStatus ? [order.paymentStatus] : []);
    document.querySelectorAll('#order-form-payment input[type=checkbox]').forEach(cb => {
      cb.checked = pymtList.includes(cb.value);
    });
    document.getElementById('order-form-platform').value = order.platform || '';
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

  getPaymentBadgeType(payments) {
    // Legacy support: accept string or array
    const list = Array.isArray(payments) ? payments : (payments ? [payments] : []);
    if (list.length === 0) return 'danger';
    const last = list[list.length - 1].toLowerCase();
    if (last.includes('total')) return 'success';
    if (last.includes('remaining')) return 'warning';
    if (last.includes('deposit')) return 'info';
    return 'info';
  },

  // ----------------------------------------------------
  // RECIPE COSTING WORKSPACE ENGINE
  // ----------------------------------------------------
  seedRecipesData() {
    this.recipes = [
      {
        id: 'REC-1',
        name: 'Mango Tresleches',
        salePrice: 45.00,
        yield: '1/2 Kg',
        ingredients: [
          { name: 'Flour (All Purpose)', category: 'Bread', price: 11.99, size: 5000, qty: 50 },
          { name: 'Corn Starch', category: 'Bread', price: 7.00, size: 1000, qty: 83 },
          { name: 'Granulated Sugar', category: 'Bread', price: 5.99, size: 4000, qty: 165 },
          { name: 'Baking Powder', category: 'Bread', price: 3.27, size: 284, qty: 1.5 },
          { name: 'Baking Soda', category: 'Bread', price: 1.37, size: 454, qty: 1.5 },
          { name: 'Salt', category: 'Bread', price: 1.68, size: 1000, qty: 1.5 },
          { name: 'Vanilla Extract', category: 'Bread', price: 3.97, size: 225, qty: 10 },
          { name: 'Eggs', category: 'Bread', price: 4.64, size: 12, qty: 5 },
          { name: 'Oil', category: 'Bread', price: 7.97, size: 2840, qty: 35 },
          { name: 'Icing Sugar', category: 'Frosting', price: 3.77, size: 1000, qty: 50 },
          { name: 'Vanilla Extract', category: 'Frosting', price: 3.97, size: 225, qty: 5 },
          { name: 'Whipping Cream', category: 'Frosting', price: 6.28, size: 955, qty: 600 },
          { name: 'Evaporated Milk', category: 'Frosting', price: 1.78, size: 354, qty: 354 },
          { name: 'Condensed Milk', category: 'Frosting', price: 2.28, size: 300, qty: 150 },
          { name: 'Mangoes', category: 'Frosting', price: 4.66, size: 600, qty: 200 },
          { name: 'Mango Puree', category: 'Frosting', price: 4.47, size: 850, qty: 500 }
        ],
        labor: [
          { task: 'Preparation & Baking', rate: 15, hours: 0 },
          { task: 'Decorating', rate: 15, hours: 0 }
        ],
        packaging: [
          { item: 'Tresleches Tray', price: 1.50, size: 1, qty: 1 },
          { item: 'Ribbon', price: 5.00, size: 10, qty: 0 }
        ],
        delivery: { miles: 0, ratePerMile: 0.50 }
      },
      {
        id: 'REC-2',
        name: 'Brownie',
        salePrice: 40.00,
        yield: '16 Pcs Box',
        ingredients: [
          { name: 'Dark Chocolate', category: 'Bread', price: 12.00, size: 1000, qty: 250 },
          { name: 'Butter', category: 'Bread', price: 6.50, size: 454, qty: 200 },
          { name: 'Granulated Sugar', category: 'Bread', price: 5.99, size: 4000, qty: 300 },
          { name: 'Flour (All Purpose)', category: 'Bread', price: 11.99, size: 5000, qty: 120 },
          { name: 'Cocoa Powder', category: 'Bread', price: 8.50, size: 500, qty: 50 },
          { name: 'Eggs', category: 'Bread', price: 4.64, size: 12, qty: 4 }
        ],
        labor: [
          { task: 'Baking & Packing', rate: 15, hours: 0.5 }
        ],
        packaging: [
          { item: 'Brownie Box', price: 2.00, size: 1, qty: 1 }
        ],
        delivery: { miles: 0, ratePerMile: 0.50 }
      },
      {
        id: 'REC-3',
        name: 'Oreo Dessert Cups',
        salePrice: 35.00,
        yield: '6 Cups',
        ingredients: [
          { name: 'Oreo Biscuits', category: 'Bread', price: 4.50, size: 500, qty: 300 },
          { name: 'Whipping Cream', category: 'Frosting', price: 6.28, size: 955, qty: 400 },
          { name: 'Cream Cheese', category: 'Frosting', price: 5.50, size: 500, qty: 200 },
          { name: 'Condensed Milk', category: 'Frosting', price: 2.28, size: 300, qty: 100 }
        ],
        labor: [],
        packaging: [
          { item: 'Dessert Cups (6)', price: 3.00, size: 6, qty: 6 }
        ],
        delivery: { miles: 0, ratePerMile: 0.50 }
      },
      {
        id: 'REC-4',
        name: 'Strawberry Dessert Cups',
        salePrice: 38.00,
        yield: '6 Cups',
        ingredients: [
          { name: 'Strawberries', category: 'Frosting', price: 6.00, size: 500, qty: 300 },
          { name: 'Whipping Cream', category: 'Frosting', price: 6.28, size: 955, qty: 400 },
          { name: 'Condensed Milk', category: 'Frosting', price: 2.28, size: 300, qty: 120 }
        ],
        labor: [],
        packaging: [
          { item: 'Dessert Cups (6)', price: 3.00, size: 6, qty: 6 }
        ],
        delivery: { miles: 0, ratePerMile: 0.50 }
      },
      {
        id: 'REC-5',
        name: 'LotusBiscoff Dessert Cups',
        salePrice: 42.00,
        yield: '6 Cups',
        ingredients: [
          { name: 'Lotus Biscoff Spread', category: 'Frosting', price: 8.50, size: 400, qty: 250 },
          { name: 'Biscoff Biscuits', category: 'Bread', price: 4.00, size: 250, qty: 150 },
          { name: 'Whipping Cream', category: 'Frosting', price: 6.28, size: 955, qty: 400 }
        ],
        labor: [],
        packaging: [
          { item: 'Dessert Cups (6)', price: 3.00, size: 6, qty: 6 }
        ],
        delivery: { miles: 0, ratePerMile: 0.50 }
      },
      {
        id: 'REC-6',
        name: 'Rasmalai Tresleches',
        salePrice: 48.00,
        yield: '1/2 Kg',
        ingredients: [
          { name: 'Flour (All Purpose)', category: 'Bread', price: 11.99, size: 5000, qty: 50 },
          { name: 'Rasmalai Milk', category: 'Frosting', price: 6.50, size: 500, qty: 350 },
          { name: 'Whipping Cream', category: 'Frosting', price: 6.28, size: 955, qty: 500 },
          { name: 'Pistachios & Almonds', category: 'Frosting', price: 10.00, size: 250, qty: 40 }
        ],
        labor: [],
        packaging: [
          { item: 'Tresleches Tray', price: 1.50, size: 1, qty: 1 }
        ],
        delivery: { miles: 0, ratePerMile: 0.50 }
      }
    ];
    if (!this.activeRecipeId && this.recipes.length > 0) {
      this.activeRecipeId = this.recipes[0].id;
    }
    this.saveState();
  },

  renderRecipesWorkspace() {
    if (!this.recipes || this.recipes.length === 0) {
      this.seedRecipesData();
    }
    if (!this.activeRecipeId && this.recipes.length > 0) {
      this.activeRecipeId = this.recipes[0].id;
    }

    this.renderRecipeTabs();
    this.renderActiveRecipeContent();
  },

  renderRecipeTabs() {
    const container = document.getElementById('recipe-tabs-list');
    if (!container) return;
    container.innerHTML = '';

    this.recipes.forEach(r => {
      const isActive = r.id === this.activeRecipeId;
      const btn = document.createElement('button');
      btn.className = `recipe-tab-btn ${isActive ? 'active' : ''}`;
      btn.innerHTML = `
        <span>${r.name}</span>
        ${r.yield ? `<span class="tab-badge">${r.yield}</span>` : ''}
      `;
      btn.addEventListener('click', () => {
        this.activeRecipeId = r.id;
        this.isEditRecipeMode = false;
        this.renderRecipeTabs();
        this.renderActiveRecipeContent();
      });
      container.appendChild(btn);
    });

    lucide.createIcons();

    // Rebind the static Add Recipe button (lives outside the scrollable list)
    const addBtn = document.getElementById('recipe-tab-add-btn');
    if (addBtn) {
      addBtn.onclick = () => this.openModal('recipeModal');
    }
  },

  calculateRecipeTotals(r) {
    let ingredientsCost = 0;
    if (r.ingredients && r.ingredients.length) {
      r.ingredients.forEach(ing => {
        const price = parseFloat(ing.price) || 0;
        const size = parseFloat(ing.size) || 1;
        const qty = parseFloat(ing.qty) || 0;
        const perUnit = size > 0 ? price / size : 0;
        ingredientsCost += perUnit * qty;
      });
    }

    let laborCost = 0;
    if (r.labor && r.labor.length) {
      r.labor.forEach(l => {
        const rate = parseFloat(l.rate) || 0;
        const hours = parseFloat(l.hours) || 0;
        laborCost += rate * hours;
      });
    }

    let packagingCost = 0;
    if (r.packaging && r.packaging.length) {
      r.packaging.forEach(p => {
        const price = parseFloat(p.price) || 0;
        const size = parseFloat(p.size) || 1;
        const qty = parseFloat(p.qty) || 0;
        const perUnit = size > 0 ? price / size : 0;
        packagingCost += perUnit * qty;
      });
    }

    let deliveryCost = 0;
    if (r.delivery) {
      const miles = parseFloat(r.delivery.miles) || 0;
      const rate = parseFloat(r.delivery.ratePerMile) || 0;
      deliveryCost = miles * rate;
    }

    const grandTotal = ingredientsCost + laborCost + packagingCost + deliveryCost;
    const salePrice = parseFloat(r.salePrice) || 0;
    const netProfit = salePrice - grandTotal;
    const profitMargin = salePrice > 0 ? (netProfit / salePrice) * 100 : 0;

    return {
      ingredientsCost,
      laborCost,
      packagingCost,
      deliveryCost,
      grandTotal,
      salePrice,
      netProfit,
      profitMargin
    };
  },

  toggleEditRecipeMode() {
    this.isEditRecipeMode = !this.isEditRecipeMode;
    this.renderActiveRecipeContent();
  },

  renderActiveRecipeContent() {
    const workspace = document.getElementById('recipe-costing-workspace');
    if (!workspace) return;

    const r = this.recipes.find(rec => rec.id === this.activeRecipeId);
    if (!r) {
      workspace.innerHTML = '<div style="padding:40px; text-align:center; color:var(--color-text-muted);">No recipe selected. Select or create a product recipe above.</div>';
      return;
    }

    const totals = this.calculateRecipeTotals(r);

    let marginClass = 'margin-high';
    if (totals.profitMargin < 25) marginClass = 'margin-low';
    else if (totals.profitMargin < 50) marginClass = 'margin-medium';

    const isEdit = this.isEditRecipeMode;

    workspace.innerHTML = `
      <div class="recipe-header-bar">
        <div class="recipe-header-title">
          <input type="text" class="recipe-name-input" value="${r.name}" onchange="app.updateRecipeHeader('${r.id}', 'name', this.value)" placeholder="Recipe Name">
          <input type="text" class="costing-input-sm" style="width: 130px; font-weight:600;" value="${r.yield || ''}" onchange="app.updateRecipeHeader('${r.id}', 'yield', this.value)" placeholder="Yield / Size (e.g. 1/2 Kg)">
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <button class="btn ${isEdit ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="app.toggleEditRecipeMode()">
            <i data-lucide="${isEdit ? 'check' : 'edit-3'}" style="width:14px; height:14px;"></i>
            <span>${isEdit ? 'Done Editing' : 'Edit Recipe'}</span>
          </button>
          <button class="btn btn-outline btn-sm text-danger" onclick="app.deleteRecipe('${r.id}')" title="Delete Recipe">
            <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
            <span>Delete Recipe</span>
          </button>
        </div>
      </div>

      <div class="recipe-editor-grid">
        <!-- Left Column: Ingredients Table -->
        <div class="costing-card">
          <div class="costing-card-header">
            <div class="costing-card-title">
              <i data-lucide="shopping-basket"></i>
              <span>Ingredients & Frosting</span>
            </div>
            ${isEdit ? `
              <button class="btn btn-outline btn-sm" onclick="app.addRecipeIngredient('${r.id}')">
                <i data-lucide="plus" style="width:12px; height:12px;"></i> Add Item
              </button>
            ` : ''}
          </div>

          <table class="costing-table">
            <thead>
              <tr>
                <th>Ingredient Name</th>
                <th style="width:75px;">Pack ($)</th>
                <th style="width:70px;">Pack Size</th>
                <th style="width:75px;">$/Unit</th>
                <th style="width:70px;">Qty Used</th>
                <th style="width:75px;">Cost ($)</th>
                ${isEdit ? '<th style="width:30px;"></th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${(r.ingredients || []).map((ing, idx) => {
      const price = parseFloat(ing.price) || 0;
      const size = parseFloat(ing.size) || 1;
      const qty = parseFloat(ing.qty) || 0;
      const perUnit = size > 0 ? price / size : 0;
      const cost = perUnit * qty;
      return `
                  <tr>
                    <td><input type="text" class="costing-input-sm" value="${ing.name}" onchange="app.updateRecipeIngredient('${r.id}', ${idx}, 'name', this.value)"></td>
                    <td><input type="number" step="0.01" class="costing-input-sm" value="${ing.price}" onchange="app.updateRecipeIngredient('${r.id}', ${idx}, 'price', this.value)"></td>
                    <td><input type="number" step="0.01" class="costing-input-sm" value="${ing.size}" onchange="app.updateRecipeIngredient('${r.id}', ${idx}, 'size', this.value)"></td>
                    <td class="cost-calculated-val">$${perUnit.toFixed(4)}</td>
                    <td><input type="number" step="0.01" class="costing-input-sm" value="${ing.qty}" onchange="app.updateRecipeIngredient('${r.id}', ${idx}, 'qty', this.value)"></td>
                    <td class="cost-calculated-val">$${cost.toFixed(2)}</td>
                    ${isEdit ? `
                      <td>
                        <button class="btn-action-trigger text-danger" onclick="app.deleteRecipeIngredient('${r.id}', ${idx})" title="Remove">
                          <i data-lucide="x" style="width:12px; height:12px;"></i>
                        </button>
                      </td>
                    ` : ''}
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>
          <div style="margin-top:12px; text-align:right; font-size:0.88rem; font-weight:700;">
            Total Ingredients Cost: <span style="color:var(--color-primary); font-size:0.95rem;">$${totals.ingredientsCost.toFixed(2)}</span>
          </div>
        </div>

        <!-- Right Column: Labor, Packaging, Delivery & Profit Summary -->
        <div>
          <!-- Labor & Prep -->
          <div class="costing-card">
            <div class="costing-card-header">
              <div class="costing-card-title">
                <i data-lucide="clock"></i>
                <span>Preparation & Labor</span>
              </div>
              ${isEdit ? `
                <button class="btn btn-outline btn-sm" onclick="app.addRecipeLabor('${r.id}')">
                  <i data-lucide="plus" style="width:12px; height:12px;"></i> Add Task
                </button>
              ` : ''}
            </div>
            <table class="costing-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th style="width:85px;">Rate/Hr ($)</th>
                  <th style="width:80px;">Hours</th>
                  <th style="width:80px;">Cost ($)</th>
                  ${isEdit ? '<th style="width:30px;"></th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${(r.labor || []).map((l, idx) => {
      const rate = parseFloat(l.rate) || 0;
      const hours = parseFloat(l.hours) || 0;
      const cost = rate * hours;
      return `
                    <tr>
                      <td><input type="text" class="costing-input-sm" value="${l.task}" onchange="app.updateRecipeLabor('${r.id}', ${idx}, 'task', this.value)"></td>
                      <td><input type="number" step="0.5" class="costing-input-sm" value="${l.rate}" onchange="app.updateRecipeLabor('${r.id}', ${idx}, 'rate', this.value)"></td>
                      <td><input type="number" step="0.1" class="costing-input-sm" value="${l.hours}" onchange="app.updateRecipeLabor('${r.id}', ${idx}, 'hours', this.value)"></td>
                      <td class="cost-calculated-val">$${cost.toFixed(2)}</td>
                      ${isEdit ? `
                        <td>
                          <button class="btn-action-trigger text-danger" onclick="app.deleteRecipeLabor('${r.id}', ${idx})" title="Remove">
                            <i data-lucide="x" style="width:12px; height:12px;"></i>
                          </button>
                        </td>
                      ` : ''}
                    </tr>
                  `;
    }).join('')}
              </tbody>
            </table>
          </div>

          <!-- Packaging -->
          <div class="costing-card">
            <div class="costing-card-header">
              <div class="costing-card-title">
                <i data-lucide="box"></i>
                <span>Packaging</span>
              </div>
              ${isEdit ? `
                <button class="btn btn-outline btn-sm" onclick="app.addRecipePackaging('${r.id}')">
                  <i data-lucide="plus" style="width:12px; height:12px;"></i> Add Item
                </button>
              ` : ''}
            </div>
            <table class="costing-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style="width:75px;">Price ($)</th>
                  <th style="width:70px;">Pack Size</th>
                  <th style="width:70px;">Qty Needed</th>
                  <th style="width:75px;">Cost ($)</th>
                  ${isEdit ? '<th style="width:30px;"></th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${(r.packaging || []).map((p, idx) => {
      const price = parseFloat(p.price) || 0;
      const size = parseFloat(p.size) || 1;
      const qty = parseFloat(p.qty) || 0;
      const perUnit = size > 0 ? price / size : 0;
      const cost = perUnit * qty;
      return `
                    <tr>
                      <td><input type="text" class="costing-input-sm" value="${p.item}" onchange="app.updateRecipePackaging('${r.id}', ${idx}, 'item', this.value)"></td>
                      <td><input type="number" step="0.01" class="costing-input-sm" value="${p.price}" onchange="app.updateRecipePackaging('${r.id}', ${idx}, 'price', this.value)"></td>
                      <td><input type="number" step="1" class="costing-input-sm" value="${p.size}" onchange="app.updateRecipePackaging('${r.id}', ${idx}, 'size', this.value)"></td>
                      <td><input type="number" step="0.1" class="costing-input-sm" value="${p.qty}" onchange="app.updateRecipePackaging('${r.id}', ${idx}, 'qty', this.value)"></td>
                      <td class="cost-calculated-val">$${cost.toFixed(2)}</td>
                      ${isEdit ? `
                        <td>
                          <button class="btn-action-trigger text-danger" onclick="app.deleteRecipePackaging('${r.id}', ${idx})" title="Remove">
                            <i data-lucide="x" style="width:12px; height:12px;"></i>
                          </button>
                        </td>
                      ` : ''}
                    </tr>
                  `;
    }).join('')}
              </tbody>
            </table>
          </div>

          <!-- Profit Summary Card (Matching Spreadsheet Breakdown) -->
          <div class="profit-summary-card">
            <h4 style="margin-top:0; margin-bottom:14px; color:var(--color-primary); font-size:1.05rem; display:flex; align-items:center; gap:8px;">
              <i data-lucide="calculator" style="width:18px; height:18px;"></i>
              <span>Cost Breakdown & Profit Margin</span>
            </h4>
            
            <table class="summary-table">
              <tr>
                <td class="summary-label">INGREDIENTS & FROSTING</td>
                <td class="summary-val">$${totals.ingredientsCost.toFixed(2)}</td>
              </tr>
              <tr>
                <td class="summary-label">PREPARATION & LABOR</td>
                <td class="summary-val">$${totals.laborCost.toFixed(2)}</td>
              </tr>
              <tr>
                <td class="summary-label">PACKAGING</td>
                <td class="summary-val">$${totals.packagingCost.toFixed(2)}</td>
              </tr>
              <tr>
                <td class="summary-label">DELIVERY</td>
                <td class="summary-val">$${totals.deliveryCost.toFixed(2)}</td>
              </tr>
              <tr class="summary-grand-row">
                <td class="summary-label" style="color:var(--color-text);">GRAND TOTAL COST</td>
                <td class="summary-val">$${totals.grandTotal.toFixed(2)}</td>
              </tr>
            </table>

            <div class="profit-margin-highlight">
              <div class="margin-stat-row">
                <span class="margin-stat-label">SALE PRICE ($):</span>
                <input type="number" step="1" class="costing-input-sm" style="width:110px; font-size:1.1rem; font-weight:700; text-align:right; color:var(--color-primary);" value="${r.salePrice}" onchange="app.updateRecipeHeader('${r.id}', 'salePrice', this.value)">
              </div>
              <div class="margin-stat-row">
                <span class="margin-stat-label">NET PROFIT:</span>
                <span class="margin-stat-val" style="color:${totals.netProfit >= 0 ? '#27ae60' : '#e74c3c'}">$${totals.netProfit.toFixed(2)}</span>
              </div>
              <div class="margin-stat-row">
                <span class="margin-stat-label">PROFIT MARGIN:</span>
                <span class="profit-badge-pill ${marginClass}">${totals.profitMargin.toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    lucide.createIcons();
  },

  updateRecipeHeader(recipeId, field, val) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r) return;
    if (field === 'salePrice') r.salePrice = parseFloat(val) || 0;
    else r[field] = val;
    this.saveState();
    this.saveToDrive();
    this.renderRecipeTabs();
    this.renderActiveRecipeContent();
  },

  updateRecipeIngredient(recipeId, idx, field, val) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r || !r.ingredients || !r.ingredients[idx]) return;
    if (field === 'price' || field === 'size' || field === 'qty') {
      r.ingredients[idx][field] = parseFloat(val) || 0;
    } else {
      r.ingredients[idx][field] = val;
    }
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  addRecipeIngredient(recipeId) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r) return;
    if (!r.ingredients) r.ingredients = [];
    r.ingredients.push({ name: 'New Ingredient', category: 'Ingredients', price: 5.00, size: 1000, qty: 100 });
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  deleteRecipeIngredient(recipeId, idx) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r || !r.ingredients) return;
    r.ingredients.splice(idx, 1);
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  updateRecipeLabor(recipeId, idx, field, val) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r || !r.labor || !r.labor[idx]) return;
    if (field === 'rate' || field === 'hours') {
      r.labor[idx][field] = parseFloat(val) || 0;
    } else {
      r.labor[idx][field] = val;
    }
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  addRecipeLabor(recipeId) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r) return;
    if (!r.labor) r.labor = [];
    r.labor.push({ task: 'Baking & Decorating', rate: 15, hours: 1 });
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  deleteRecipeLabor(recipeId, idx) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r || !r.labor) return;
    r.labor.splice(idx, 1);
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  updateRecipePackaging(recipeId, idx, field, val) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r || !r.packaging || !r.packaging[idx]) return;
    if (field === 'price' || field === 'size' || field === 'qty') {
      r.packaging[idx][field] = parseFloat(val) || 0;
    } else {
      r.packaging[idx][field] = val;
    }
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  addRecipePackaging(recipeId) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r) return;
    if (!r.packaging) r.packaging = [];
    r.packaging.push({ item: 'Packaging Box', price: 2.00, size: 1, qty: 1 });
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  deleteRecipePackaging(recipeId, idx) {
    const r = this.recipes.find(rec => rec.id === recipeId);
    if (!r || !r.packaging) return;
    r.packaging.splice(idx, 1);
    this.saveState();
    this.saveToDrive();
    this.renderActiveRecipeContent();
  },

  handleRecipeSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('recipe-form-id').value;
    const name = document.getElementById('recipe-form-name').value;
    const salePrice = parseFloat(document.getElementById('recipe-form-price').value) || 0;
    const yieldVal = document.getElementById('recipe-form-yield').value;

    if (id) {
      const idx = this.recipes.findIndex(rec => rec.id === id);
      if (idx !== -1) {
        this.recipes[idx].name = name;
        this.recipes[idx].salePrice = salePrice;
        this.recipes[idx].yield = yieldVal;
        this.activeRecipeId = id;
      }
    } else {
      const newId = `REC-${Date.now()}`;
      const newRecipe = {
        id: newId,
        name,
        salePrice,
        yield: yieldVal,
        ingredients: [
          { name: 'Flour (All Purpose)', category: 'Bread', price: 11.99, size: 5000, qty: 100 },
          { name: 'Granulated Sugar', category: 'Bread', price: 5.99, size: 4000, qty: 150 }
        ],
        labor: [],
        packaging: [
          { item: 'Box', price: 1.50, size: 1, qty: 1 }
        ],
        delivery: { miles: 0, ratePerMile: 0 }
      };

      this.recipes.push(newRecipe);
      this.activeRecipeId = newId;
    }

    this.saveState();
    this.saveToDrive();
    this.closeModal('recipeModal');
    this.renderRecipesWorkspace();
  },

  deleteRecipe(recipeId) {
    if (confirm("Are you sure you want to delete this product recipe?")) {
      this.recipes = this.recipes.filter(rec => rec.id !== recipeId);
      if (this.recipes.length > 0) {
        this.activeRecipeId = this.recipes[0].id;
      } else {
        this.activeRecipeId = null;
      }
      this.saveState();
      this.saveToDrive();
      this.renderRecipesWorkspace();
    }
  },

  // ----------------------------------------------------
  // CSV / EXCEL IMPORT ENGINE
  // ----------------------------------------------------

  // Internal state for the import wizard
  _import: {
    type: 'orders',       // 'orders' | 'expenses'
    rawHeaders: [],       // Column names from the uploaded file
    rawRows: [],          // Array of row objects from the file
    parsedFile: false
  },

  // App field definitions for mapping
  _orderFields: [
    { key: 'customerName', label: 'Customer Name', required: true, aliases: ['name', 'customer', 'client', 'customer name'] },
    { key: 'items', label: 'Order Details', required: true, aliases: ['details', 'items', 'order', 'product', 'description', 'cake', 'item'] },
    { key: 'customerPhone', label: 'Phone', required: false, aliases: ['phone', 'mobile', 'contact', 'tel'] },
    { key: 'customerEmail', label: 'Email / Social ID', required: false, aliases: ['email', 'social', 'instagram', 'media id', 'email/social media id', 'social media'] },
    { key: 'platform', label: 'Owner / Platform', required: false, aliases: ['owner', 'platform', 'channel', 'source'] },
    { key: 'orderStatus', label: 'Status', required: false, aliases: ['status', 'order status', 'state'] },
    { key: 'pickupDate', label: 'Due Date', required: false, aliases: ['due date', 'date', 'pickup', 'delivery date', 'pickup date'] },
    { key: 'total', label: 'Total Price', required: false, aliases: ['total price', 'total', 'amount', 'price', 'grand total'] },
    { key: 'advance', label: 'Advance', required: false, aliases: ['advance', 'deposit', 'paid', 'advance paid'] },
    { key: 'remaining', label: 'Pending Price', required: false, aliases: ['pending price', 'pending', 'remaining', 'balance', 'due', 'outstanding'] },
    { key: 'payments', label: 'Mode of Payment', required: false, aliases: ['mode of payment', 'payment mode', 'payment method', 'payment', 'mode'] },
    { key: 'notes', label: 'Notes', required: false, aliases: ['notes', 'remarks', 'comment', 'special instructions'] }
  ],

  _expenseFields: [
    { key: 'date', label: 'Date', required: true, aliases: ['date', 'transaction date', 'expense date'] },
    { key: 'item', label: 'Description', required: true, aliases: ['description', 'item', 'expense item', 'sub-description', 'name', 'subdescription'] },
    { key: 'category', label: 'Category', required: false, aliases: ['category', 'type', 'type of transaction', 'expense type'] },
    { key: 'amount', label: 'Amount', required: true, aliases: ['amount', 'total', 'price', 'cost', 'value'] },
    { key: 'method', label: 'Payment Method', required: false, aliases: ['payment method', 'method', 'payment mode', 'mode', 'paid via'] },
    { key: 'notes', label: 'Notes', required: false, aliases: ['notes', 'remarks', 'comment', 'status', 'reference'] }
  ],

  openImportModal(type) {
    // Reset state
    this._import = { type: type || 'orders', rawHeaders: [], rawRows: [], parsedFile: false };

    // Reset UI to step 1
    document.getElementById('import-step-1').style.display = '';
    document.getElementById('import-step-2').style.display = 'none';
    document.getElementById('import-step-3').style.display = 'none';
    document.getElementById('import-file-info').style.display = 'none';
    document.getElementById('import-dropzone').style.display = '';
    document.getElementById('import-file-input').value = '';
    document.getElementById('btn-import-next').disabled = true;

    // Set toggle state
    document.querySelectorAll('.import-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-type') === this._import.type);
    });

    document.getElementById('importModalTitle').textContent =
      this._import.type === 'orders' ? 'Import Orders' : 'Import Expenses';

    this.openModal('importModal');
  },

  setupImportModalListeners() {
    // Close / cancel
    document.getElementById('btn-import-modal-close').addEventListener('click', () => this.closeModal('importModal'));
    document.getElementById('btn-import-cancel').addEventListener('click', () => this.closeModal('importModal'));
    document.getElementById('btn-import-done').addEventListener('click', () => {
      this.closeModal('importModal');
      this.refreshActiveTabTable();
      if (this.activeTab === 'dashboard') this.renderDashboard();
    });

    // Back button (step 2 → step 1)
    document.getElementById('btn-import-back').addEventListener('click', () => {
      document.getElementById('import-step-2').style.display = 'none';
      document.getElementById('import-step-1').style.display = '';
    });

    // Type toggle buttons
    document.querySelectorAll('.import-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.import-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._import.type = btn.getAttribute('data-type');
        document.getElementById('importModalTitle').textContent =
          this._import.type === 'orders' ? 'Import Orders' : 'Import Expenses';
        // Re-run auto-match if file is already loaded
        if (this._import.parsedFile) this._renderMappingGrid();
      });
    });

    // File input change
    document.getElementById('import-file-input').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this._handleImportFile(e.target.files[0]);
      }
    });

    // Clear file
    document.getElementById('btn-import-file-clear').addEventListener('click', () => {
      this._import.parsedFile = false;
      this._import.rawHeaders = [];
      this._import.rawRows = [];
      document.getElementById('import-file-info').style.display = 'none';
      document.getElementById('import-dropzone').style.display = '';
      document.getElementById('import-file-input').value = '';
      document.getElementById('btn-import-next').disabled = true;
    });

    // Drag and drop
    const dz = document.getElementById('import-dropzone');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this._handleImportFile(file);
    });
    dz.addEventListener('click', () => document.getElementById('import-file-input').click());

    // Next: go to mapping
    document.getElementById('btn-import-next').addEventListener('click', () => {
      document.getElementById('import-step-1').style.display = 'none';
      document.getElementById('import-step-2').style.display = '';
      this._renderMappingGrid();
    });

    // Confirm import
    document.getElementById('btn-import-confirm').addEventListener('click', () => this._executeImport());
  },

  _handleImportFile(file) {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
      alert('Please upload a .xlsx, .xls, or .csv file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

        if (json.length === 0) {
          alert('The file appears to be empty or has no data rows.');
          return;
        }

        this._import.rawHeaders = Object.keys(json[0]);
        this._import.rawRows = json;
        this._import.parsedFile = true;

        // Show file info
        document.getElementById('import-file-name').textContent = file.name;
        document.getElementById('import-file-rows').textContent = `${json.length} row${json.length !== 1 ? 's' : ''}`;
        document.getElementById('import-file-info').style.display = 'flex';
        document.getElementById('import-dropzone').style.display = 'none';
        document.getElementById('btn-import-next').disabled = false;
      } catch (err) {
        console.error('File parse error:', err);
        alert('Could not read the file. Please ensure it is a valid Excel or CSV file.');
      }
    };
    reader.readAsArrayBuffer(file);
  },

  _autoMatchColumn(fileHeader) {
    // Try to auto-match a file column header to an app field key
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const fields = this._import.type === 'orders' ? this._orderFields : this._expenseFields;
    const fhNorm = normalize(fileHeader);

    for (const field of fields) {
      for (const alias of field.aliases) {
        if (normalize(alias) === fhNorm || fhNorm.includes(normalize(alias)) || normalize(alias).includes(fhNorm)) {
          return field.key;
        }
      }
    }
    return '__skip__';
  },

  _renderMappingGrid() {
    const fields = this._import.type === 'orders' ? this._orderFields : this._expenseFields;
    const headers = this._import.rawHeaders;
    const grid = document.getElementById('import-mapping-grid');
    grid.innerHTML = '';

    // Build a map: fileHeader → auto-matched appField
    const autoMapped = {};
    headers.forEach(h => { autoMapped[h] = this._autoMatchColumn(h); });

    fields.forEach(field => {
      // Find which file column was auto-matched to this field
      const matchedHeader = Object.keys(autoMapped).find(h => autoMapped[h] === field.key) || '';

      const row = document.createElement('div');
      row.className = 'import-mapping-row' + (field.required ? ' required-field' : '');

      // Left: App field label
      const labelDiv = document.createElement('div');
      labelDiv.className = 'import-mapping-label';
      labelDiv.innerHTML = `${field.label}${field.required ? '<span class="import-mapping-required">Required</span>' : ''}`;

      // Arrow
      const arrowDiv = document.createElement('div');
      arrowDiv.className = 'import-mapping-arrow';
      arrowDiv.textContent = '←';

      // Right: dropdown of file columns
      const select = document.createElement('select');
      select.className = 'import-mapping-select';
      select.setAttribute('data-field', field.key);

      const skipOpt = document.createElement('option');
      skipOpt.value = '__skip__';
      skipOpt.textContent = '— Skip this field —';
      select.appendChild(skipOpt);

      headers.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        if (h === matchedHeader) opt.selected = true;
        select.appendChild(opt);
      });

      if (!matchedHeader) select.value = '__skip__';

      row.appendChild(labelDiv);
      row.appendChild(arrowDiv);
      row.appendChild(select);
      grid.appendChild(row);
    });

    // Render preview of the raw data
    this._renderImportPreview();
  },

  _renderImportPreview() {
    const headers = this._import.rawHeaders;
    const rows = this._import.rawRows.slice(0, 3);
    const thead = document.getElementById('import-preview-thead');
    const tbody = document.getElementById('import-preview-tbody');
    const countEl = document.getElementById('import-preview-count');

    countEl.textContent = `(showing ${rows.length} of ${this._import.rawRows.length} rows)`;

    thead.innerHTML = '<tr>' + headers.map(h => `<th style="font-size:0.75rem; white-space:nowrap;">${h}</th>`).join('') + '</tr>';
    tbody.innerHTML = rows.map(row =>
      '<tr>' + headers.map(h => {
        const val = String(row[h] || '');
        return `<td style="font-size:0.75rem; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${val}">${val}</td>`;
      }).join('') + '</tr>'
    ).join('');
  },

  _executeImport() {
    const type = this._import.type;
    const rows = this._import.rawRows;

    // Build a field→column map from the selects
    const mapping = {};
    document.querySelectorAll('#import-mapping-grid .import-mapping-select').forEach(sel => {
      const fieldKey = sel.getAttribute('data-field');
      const colHeader = sel.value;
      if (colHeader !== '__skip__') mapping[fieldKey] = colHeader;
    });

    // Validate required fields are mapped
    const fields = type === 'orders' ? this._orderFields : this._expenseFields;
    const missingRequired = fields.filter(f => f.required && !mapping[f.key]);
    if (missingRequired.length > 0) {
      alert('Please map these required fields first:\n' + missingRequired.map(f => '• ' + f.label).join('\n'));
      return;
    }

    let imported = 0;
    let skipped = 0;

    if (type === 'orders') {
      rows.forEach(row => {
        try {
          const customerName = (row[mapping.customerName] || '').trim();
          if (!customerName) { skipped++; return; }

          const items = (row[mapping.items] || 'Import').trim();

          // Parse date: try to get a valid datetime string
          let pickupDate = '2025-07-31T12:00';
          if (mapping.pickupDate && row[mapping.pickupDate]) {
            const d = new Date(row[mapping.pickupDate]);
            if (!isNaN(d.getTime())) {
              pickupDate = d.toISOString().slice(0, 16);
            } else {
              pickupDate = String(row[mapping.pickupDate]).replace(' ', 'T').slice(0, 16) || pickupDate;
            }
          }

          const total = parseFloat(row[mapping.total] || 0) || 0;
          const advance = parseFloat(row[mapping.advance] || 0) || 0;
          const remaining = mapping.remaining
            ? (parseFloat(row[mapping.remaining] || 0) || 0)
            : Math.max(0, total - advance);

          const platform = (row[mapping.platform] || '').trim();
          const orderStatus = (row[mapping.orderStatus] || 'Completed').trim();
          const notes = (row[mapping.notes] || '').trim();
          const customerPhone = (row[mapping.customerPhone] || '').trim();
          const customerEmail = (row[mapping.customerEmail] || '').trim();

          // Parse payment mode into array format
          let payments = [];
          if (mapping.payments && row[mapping.payments]) {
            const rawPayment = String(row[mapping.payments]).trim();
            if (rawPayment) payments = [rawPayment];
          }

          const newId = `IMP-${Date.now()}-${imported}`;
          const newOrder = {
            id: newId,
            customerName, customerPhone, customerEmail,
            items, pickupDate, advance, remaining, total,
            payments, platform, orderStatus, notes
          };

          this.orders.push(newOrder);

          // Update/create customer profile
          if (customerName) {
            this.updateCustomerProfile(customerName, customerPhone, customerEmail, total);
          }

          imported++;
        } catch (err) {
          console.warn('Skipped row due to error:', err, row);
          skipped++;
        }
      });

    } else {
      // Expenses import
      rows.forEach(row => {
        try {
          const date = mapping.date
            ? this._parseImportDate(row[mapping.date])
            : this.currentDate.toISOString().slice(0, 10);

          const item = (row[mapping.item] || '').trim();
          if (!item) { skipped++; return; }

          const amount = parseFloat(row[mapping.amount] || 0) || 0;
          if (amount === 0 && !mapping.amount) { skipped++; return; }

          // Ensure category exists; add it if not
          let category = (row[mapping.category] || 'Uncategorised').trim() || 'Uncategorised';
          if (!this.expenseCategories.includes(category)) {
            this.expenseCategories.push(category);
          }

          const method = (row[mapping.method] || 'Cash').trim() || 'Cash';
          const notes = (row[mapping.notes] || '').trim();

          const newId = `EXP-IMP-${Date.now()}-${imported}`;
          this.expenses.push({ id: newId, date, category, item, amount, method, notes });
          imported++;
        } catch (err) {
          console.warn('Skipped expense row:', err, row);
          skipped++;
        }
      });
    }

    this.saveState();
    this.saveToDrive();

    // Show step 3 (done)
    document.getElementById('import-step-2').style.display = 'none';
    document.getElementById('import-step-3').style.display = '';
    document.getElementById('import-done-title').textContent = imported > 0 ? 'Import Successful!' : 'Nothing Imported';
    document.getElementById('import-done-message').textContent =
      imported > 0
        ? `${imported} ${type} record${imported !== 1 ? 's' : ''} were added to your app.`
        : 'No records were imported. Please check your file and column mapping.';

    const statsEl = document.getElementById('import-done-stats');
    statsEl.innerHTML = [
      `<span class="import-stat-pill success">${imported} Imported</span>`,
      skipped > 0 ? `<span class="import-stat-pill warning">${skipped} Skipped</span>` : ''
    ].join('');

    lucide.createIcons();
  },

  _parseImportDate(rawVal) {
    if (!rawVal) return this.currentDate.toISOString().slice(0, 10);
    const str = String(rawVal).trim();
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    // Try common formats: DD/MM/YYYY or MM/DD/YYYY
    const parts = str.split(/[\/\-\.]/);
    if (parts.length === 3) {
      const y = parts[2].length === 4 ? parts[2] : '20' + parts[2];
      const m = parts[1].padStart(2, '0');
      const day = parts[0].padStart(2, '0');
      const attempt = new Date(`${y}-${m}-${day}`);
      if (!isNaN(attempt.getTime())) return attempt.toISOString().slice(0, 10);
    }
    return this.currentDate.toISOString().slice(0, 10);
  }
};

// Start the Application when DOM is fully ready
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
