/**
 * Living Oils - Admin Dashboard Logic
 * Real-time order monitoring, status management, filtering, and Firebase syncing.
 */

(function () {
  let allOrders = [];
  let isFirstLoad = true;
  let activeStatusFilter = "all";
  let activeSearchQuery = "";
  let activeDateFilter = "all";
  let soundEnabled = localStorage.getItem("living_oils_sound") !== "false";
  let activeOrderInModal = null;
  let toastTimer = null;

  // DOM Elements
  const tableBody = document.querySelector("#ordersTableBody");
  const emptyState = document.querySelector("#emptyState");
  const searchInput = document.querySelector("#orderSearchInput");
  const dateFilterSelect = document.querySelector("#dateFilterSelect");
  const statusFilterTabs = document.querySelector("#statusFilterTabs");
  const exportCsvBtn = document.querySelector("#exportCsvBtn");
  const addSampleBtn = document.querySelector("#addSampleBtn");
  const emptyAddTestBtn = document.querySelector("#emptyAddTestBtn");
  const refreshBtn = document.querySelector("#refreshBtn");
  const soundToggleBtn = document.querySelector("#soundToggleBtn");
  const soundIcon = document.querySelector("#soundIcon");
  const soundText = document.querySelector("#soundText");
  const connStatusBtn = document.querySelector("#connStatusBtn");
  const connStatusText = document.querySelector("#connStatusText");
  const openSettingsBtn = document.querySelector("#openSettingsBtn");

  // Metrics Elements
  const totalOrdersCount = document.querySelector("#totalOrdersCount");
  const pendingOrdersCount = document.querySelector("#pendingOrdersCount");
  const todayOrdersCount = document.querySelector("#todayOrdersCount");
  const totalRevenueAmount = document.querySelector("#totalRevenueAmount");

  // Filter Count Elements
  const countAll = document.querySelector("#countAll");
  const countPending = document.querySelector("#countPending");
  const countConfirmed = document.querySelector("#countConfirmed");
  const countDelivered = document.querySelector("#countDelivered");
  const countCancelled = document.querySelector("#countCancelled");

  // Modals
  const orderDetailsModal = document.querySelector("#orderDetailsModal");
  const modalOrderIdTitle = document.querySelector("#modalOrderIdTitle");
  const modalDetailsContent = document.querySelector("#modalDetailsContent");
  const closeDetailsModalBtn = document.querySelector("#closeDetailsModalBtn");
  const closeDetailsDoneBtn = document.querySelector("#closeDetailsDoneBtn");
  const printOrderBtn = document.querySelector("#printOrderBtn");

  const settingsModal = document.querySelector("#settingsModal");
  const closeSettingsModalBtn = document.querySelector("#closeSettingsModalBtn");
  const firebaseConfigInput = document.querySelector("#firebaseConfigInput");
  const saveFirebaseBtn = document.querySelector("#saveFirebaseBtn");
  const testFirebaseBtn = document.querySelector("#testFirebaseBtn");
  const clearFirebaseBtn = document.querySelector("#clearFirebaseBtn");
  const clearAllOrdersBtn = document.querySelector("#clearAllOrdersBtn");

  // Currency Formatter
  const money = (n) =>
    n == null
      ? "Price to confirm"
      : new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 0
        }).format(n);

  // Date Formatter
  function formatDate(isoStr) {
    if (!isoStr) return "N/A";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return "N/A";
      return d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      });
    } catch (e) {
      return isoStr;
    }
  }

  // Relative Time Formatter
  function timeAgo(isoStr) {
    if (!isoStr) return "";
    try {
      const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
      if (diff < 60) return "Just now";
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    } catch (e) {
      return "";
    }
  }

  // Audio Notification Chime (Web Audio API) - Energetic 4-tone incoming alert
  function playOrderChime() {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const playTone = (freq, start, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.35, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.05);
      };
      const now = ctx.currentTime;
      playTone(523.25, now, 0.18);        // C5
      playTone(659.25, now + 0.15, 0.18); // E5
      playTone(783.99, now + 0.30, 0.25); // G5
      playTone(1046.50, now + 0.48, 0.55); // C6
    } catch (e) {
      console.warn("Chime failed:", e);
    }
  }

  // Document Title Flashing
  let titleFlashInterval = null;
  const originalDocTitle = document.title;
  function startTitleFlash(orderId) {
    if (titleFlashInterval) clearInterval(titleFlashInterval);
    let flag = false;
    titleFlashInterval = setInterval(() => {
      document.title = flag ? `🚨 NEW ORDER (${orderId})!` : originalDocTitle;
      flag = !flag;
    }, 850);
  }
  function stopTitleFlash() {
    if (titleFlashInterval) {
      clearInterval(titleFlashInterval);
      titleFlashInterval = null;
    }
    document.title = originalDocTitle;
  }
  window.addEventListener("focus", stopTitleFlash);
  document.addEventListener("click", stopTitleFlash);

  // Desktop Web Notification API
  function sendDesktopNotification(order) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      try {
        const itemsStr = (order.items || []).map((i) => `${i.qty}x ${i.en || i.name}`).join(", ");
        const n = new Notification(`🚨 New Order #${order.id}`, {
          body: `${order.customer?.name || "Customer"} (${money(order.totalAmount)})\n${itemsStr}`,
          icon: "assets/living-oils-logo.jpg",
          requireInteraction: true
        });
        n.onclick = () => {
          window.focus();
          openOrderDetails(order.id);
        };
      } catch (e) {
        console.warn("Desktop notification notice:", e);
      }
    }
  }

  function updateDesktopNotifUI() {
    const btn = document.querySelector("#desktopNotifBtn");
    const text = document.querySelector("#desktopNotifText");
    if (!btn || !text) return;
    if (!("Notification" in window)) {
      btn.style.display = "none";
      return;
    }
    if (Notification.permission === "granted") {
      text.textContent = "Alerts Active";
      btn.classList.add("btn-success");
      btn.title = "Desktop notifications are active";
    } else if (Notification.permission === "denied") {
      text.textContent = "Alerts Blocked";
      btn.title = "Desktop notifications blocked in browser settings";
    } else {
      text.textContent = "Enable Alerts";
      btn.title = "Click to enable OS desktop alerts on new orders";
    }
  }

  // Show Toast
  function showToast(message, type = "success") {
    const toast = document.querySelector("#adminToast");
    toast.textContent = message;
    toast.className = `admin-toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3500);
  }

  // Update Sound Button State
  function updateSoundUI() {
    soundIcon.textContent = soundEnabled ? "🔔" : "🔕";
    soundText.textContent = soundEnabled ? "Sound On" : "Sound Off";
    localStorage.setItem("living_oils_sound", soundEnabled ? "true" : "false");
  }

  // Update Connection Status UI
  function updateConnectionUI() {
    const config = getSavedFirebaseConfig();
    const hasConfig = config && config.apiKey && (config.databaseURL || config.projectId);
    if (hasConfig && isFirebaseReady) {
      connStatusBtn.className = "conn-status live";
      connStatusText.textContent = "Live Cloud Sync";
      connStatusBtn.title = "Connected to Firebase Realtime Database. Click to view settings.";
    } else {
      connStatusBtn.className = "conn-status local";
      connStatusText.textContent = "Local Storage Mode";
      connStatusBtn.title = "Operating in local browser storage. Click to connect Firebase for cross-device sync.";
    }
  }

  // Calculate Metrics & Tabs
  function updateMetrics() {
    const total = allOrders.length;
    const pending = allOrders.filter((o) => (o.status || "pending") === "pending").length;
    const confirmed = allOrders.filter((o) => o.status === "confirmed").length;
    const delivered = allOrders.filter((o) => o.status === "delivered").length;
    const cancelled = allOrders.filter((o) => o.status === "cancelled").length;

    // Today's Orders
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todayCount = allOrders.filter((o) => {
      if (!o.createdAt) return false;
      return new Date(o.createdAt) >= todayMidnight;
    }).length;

    // Revenue from valid orders (non-cancelled)
    const revenue = allOrders
      .filter((o) => o.status !== "cancelled")
      .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

    totalOrdersCount.textContent = total;
    pendingOrdersCount.textContent = pending;
    todayOrdersCount.textContent = todayCount;
    totalRevenueAmount.textContent = money(revenue);

    // Filter count badges
    countAll.textContent = total;
    countPending.textContent = pending;
    countConfirmed.textContent = confirmed;
    countDelivered.textContent = delivered;
    countCancelled.textContent = cancelled;
  }

  // Filter Orders based on Search, Status, and Date
  function getFilteredOrders() {
    return allOrders.filter((order) => {
      // 1. Status Filter
      const status = (order.status || "pending").toLowerCase();
      if (activeStatusFilter !== "all" && status !== activeStatusFilter) {
        return false;
      }

      // 2. Date Filter
      if (activeDateFilter !== "all" && order.createdAt) {
        const orderDate = new Date(order.createdAt);
        const now = new Date();
        if (activeDateFilter === "today") {
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (orderDate < startOfToday) return false;
        } else if (activeDateFilter === "week") {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (orderDate < sevenDaysAgo) return false;
        } else if (activeDateFilter === "month") {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          if (orderDate < startOfMonth) return false;
        }
      }

      // 3. Search Query
      if (activeSearchQuery) {
        const q = activeSearchQuery.toLowerCase();
        const idMatch = (order.id || "").toLowerCase().includes(q);
        const nameMatch = (order.customer?.name || "").toLowerCase().includes(q);
        const phoneMatch = (order.customer?.phone || "").toLowerCase().includes(q);
        const addressMatch = (order.customer?.address || "").toLowerCase().includes(q);
        const itemMatch = (order.items || []).some(
          (item) =>
            (item.name || "").toLowerCase().includes(q) ||
            (item.en || "").toLowerCase().includes(q)
        );

        if (!idMatch && !nameMatch && !phoneMatch && !addressMatch && !itemMatch) {
          return false;
        }
      }

      return true;
    });
  }

  // Render Table Rows
  function renderOrders() {
    updateMetrics();
    const filtered = getFilteredOrders();

    if (!filtered.length) {
      tableBody.innerHTML = "";
      emptyState.style.display = "block";
      return;
    }

    emptyState.style.display = "none";
    tableBody.innerHTML = filtered
      .map((order) => {
        const status = order.status || "pending";
        const customer = order.customer || {};
        const items = order.items || [];
        const cleanPhone = (customer.phone || "").replace(/\D/g, "");

        // Items Summary line
        const itemsSummary = items
          .map((it) => `${it.qty}x ${it.en || it.name} (${it.packLabel || ""})`)
          .join(", ") || "No items listed";

        return `
          <tr data-order-id="${order.id}">
            <td>
              <span class="order-id-badge">${order.id}</span>
            </td>
            <td class="order-date-col">
              <div>${formatDate(order.createdAt)}</div>
              <span class="rel-time">${timeAgo(order.createdAt)}</span>
            </td>
            <td>
              <span class="customer-name">${escapeHtml(customer.name || "Unknown")}</span>
              <div class="customer-links">
                ${
                  cleanPhone
                    ? `<a class="quick-link wa" href="https://wa.me/${cleanPhone}" target="_blank" title="Chat on WhatsApp">💬 WA</a>
                       <a class="quick-link" href="tel:${cleanPhone}" title="Call customer">📞 Call</a>`
                    : ""
                }
              </div>
            </td>
            <td>
              <div class="order-items-snippet" title="${escapeHtml(itemsSummary)}">
                ${escapeHtml(itemsSummary)}
              </div>
            </td>
            <td>
              <span class="order-total-col">${money(order.totalAmount)}</span>
            </td>
            <td>
              <select class="status-select" data-action="change-status" data-id="${order.id}">
                <option value="pending" ${status === "pending" ? "selected" : ""}>⏳ Pending</option>
                <option value="confirmed" ${status === "confirmed" ? "selected" : ""}>📦 Confirmed</option>
                <option value="delivered" ${status === "delivered" ? "selected" : ""}>✅ Delivered</option>
                <option value="cancelled" ${status === "cancelled" ? "selected" : ""}>❌ Cancelled</option>
              </select>
            </td>
            <td>
              <div class="action-cell">
                <button class="btn btn-sm" data-action="view-details" data-id="${order.id}" title="View order details">
                  👁️ Details
                </button>
                <button class="btn btn-sm btn-danger" data-action="delete-order" data-id="${order.id}" title="Delete order">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Show Order Details Modal
  function openOrderDetails(orderId) {
    const order = allOrders.find((o) => o.id === orderId);
    if (!order) return;
    activeOrderInModal = order;

    modalOrderIdTitle.textContent = `Order Details: ${order.id}`;

    const customer = order.customer || {};
    const items = order.items || [];
    const cleanPhone = (customer.phone || "").replace(/\D/g, "");

    const itemsHtml = items
      .map(
        (it) => `
        <tr>
          <td>
            <strong>${escapeHtml(it.name || "")}</strong><br>
            <small style="color:var(--muted);">${escapeHtml(it.en || "")}</small>
          </td>
          <td>${escapeHtml(it.packLabel || "")}</td>
          <td>${it.qty}</td>
          <td>${money(it.unitPrice)}</td>
          <td><strong>${money(it.lineTotal)}</strong></td>
        </tr>
      `
      )
      .join("");

    modalDetailsContent.innerHTML = `
      <div class="detail-block">
        <div class="detail-block-title">Customer Information</div>
        <p><strong>Name:</strong> ${escapeHtml(customer.name || "N/A")}</p>
        <p><strong>Phone:</strong> ${escapeHtml(customer.phone || "N/A")} 
          ${
            cleanPhone
              ? `<a class="quick-link wa" href="https://wa.me/${cleanPhone}" target="_blank" style="margin-left:6px;">💬 Chat on WhatsApp</a>
                 <a class="quick-link" href="tel:${cleanPhone}" style="margin-left:4px;">📞 Call</a>`
              : ""
          }
        </p>
        <p style="margin-top:4px;"><strong>Delivery Address:</strong><br>
          <span style="white-space: pre-wrap; color: #444;">${escapeHtml(customer.address || "N/A")}</span>
        </p>
      </div>

      <div class="detail-block">
        <div class="detail-block-title">Ordered Items</div>
        <table class="items-breakdown-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Pack</th>
              <th>Qty</th>
              <th>Unit Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml || '<tr><td colspan="5">No items</td></tr>'}
            <tr class="total-row">
              <td colspan="4" style="text-align: right;">Estimated Total:</td>
              <td>${money(order.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="detail-block">
        <div class="detail-block-title">Order Status &amp; Admin Notes</div>
        <div class="form-group">
          <label>Order Status</label>
          <select id="modalStatusSelect" class="form-group select">
            <option value="pending" ${order.status === "pending" ? "selected" : ""}>⏳ Pending (Awaiting confirmation)</option>
            <option value="confirmed" ${order.status === "confirmed" ? "selected" : ""}>📦 Confirmed / In Preparation</option>
            <option value="delivered" ${order.status === "delivered" ? "selected" : ""}>✅ Delivered &amp; Completed</option>
            <option value="cancelled" ${order.status === "cancelled" ? "selected" : ""}>❌ Cancelled</option>
          </select>
        </div>
        <div class="form-group">
          <label for="modalAdminNotes">Internal Admin Note</label>
          <textarea id="modalAdminNotes" rows="2" placeholder="e.g. UPI payment received, dispatching via Dunzo / auto">${escapeHtml(order.adminNote || "")}</textarea>
        </div>
        <button class="btn btn-sm btn-primary" id="saveOrderNotesBtn">Save Status &amp; Note</button>
      </div>
    `;

    orderDetailsModal.classList.add("open");
    orderDetailsModal.setAttribute("aria-hidden", "false");

    // Modal save handler
    document.querySelector("#saveOrderNotesBtn").addEventListener("click", async () => {
      const newStatus = document.querySelector("#modalStatusSelect").value;
      const note = document.querySelector("#modalAdminNotes").value.trim();
      await updateOrderStatusInSystem(order.id, newStatus, note);
      showToast("Order status and notes updated");
      closeOrderDetailsModal();
    });
  }

  function closeOrderDetailsModal() {
    orderDetailsModal.classList.remove("open");
    orderDetailsModal.setAttribute("aria-hidden", "true");
    activeOrderInModal = null;
  }

  // Firebase Settings Modal Handlers
  function openSettingsModal() {
    const config = getSavedFirebaseConfig();
    firebaseConfigInput.value = JSON.stringify(config, null, 2);
    settingsModal.classList.add("open");
    settingsModal.setAttribute("aria-hidden", "false");
  }

  function closeSettingsModal() {
    settingsModal.classList.remove("open");
    settingsModal.setAttribute("aria-hidden", "true");
  }

  // Parse input config leniently (supports JSON or JS object format)
  function parseConfigInput(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // Try evaluating safely if user pasted raw JS object
      try {
        const fn = new Function(`return (${trimmed});`);
        return fn();
      } catch (err) {
        throw new Error("Invalid format. Please paste valid JSON or JavaScript configuration object.");
      }
    }
  }

  // Event Listeners for Table Actions
  tableBody.addEventListener("click", async (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === "view-details") {
      openOrderDetails(id);
    } else if (action === "delete-order") {
      if (confirm(`Are you sure you want to delete order ${id}? This action cannot be undone.`)) {
        await deleteOrderFromSystem(id);
        showToast(`Order ${id} deleted`);
      }
    }
  });

  tableBody.addEventListener("change", async (e) => {
    if (e.target.dataset.action === "change-status") {
      const id = e.target.dataset.id;
      const newStatus = e.target.value;
      await updateOrderStatusInSystem(id, newStatus);
      showToast(`Order ${id} marked as ${newStatus}`);
    }
  });

  // Search & Filter Events
  searchInput.addEventListener("input", (e) => {
    activeSearchQuery = e.target.value.trim();
    renderOrders();
  });

  dateFilterSelect.addEventListener("change", (e) => {
    activeDateFilter = e.target.value;
    renderOrders();
  });

  statusFilterTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-status]");
    if (!btn) return;
    activeStatusFilter = btn.dataset.status;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderOrders();
  });

  // Sound Toggle
  soundToggleBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    updateSoundUI();
    if (soundEnabled) {
      playOrderChime();
      showToast("Audio chime enabled");
    } else {
      showToast("Audio chime disabled");
    }
  });

  // Settings Modal Buttons
  openSettingsBtn.addEventListener("click", openSettingsModal);
  connStatusBtn.addEventListener("click", openSettingsModal);
  closeSettingsModalBtn.addEventListener("click", closeSettingsModal);
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  // Details Modal Buttons
  closeDetailsModalBtn.addEventListener("click", closeOrderDetailsModal);
  closeDetailsDoneBtn.addEventListener("click", closeOrderDetailsModal);
  orderDetailsModal.addEventListener("click", (e) => {
    if (e.target === orderDetailsModal) closeOrderDetailsModal();
  });

  // Print Receipt
  printOrderBtn.addEventListener("click", () => {
    window.print();
  });

  // Save Firebase Config
  saveFirebaseBtn.addEventListener("click", () => {
    try {
      const config = parseConfigInput(firebaseConfigInput.value);
      if (!config) {
        alert("Please enter a Firebase configuration object.");
        return;
      }
      const success = saveFirebaseConfig(config);
      if (success) {
        updateConnectionUI();
        showToast("Firebase connected successfully!");
        closeSettingsModal();
      } else {
        alert("Could not initialize Firebase with these credentials. Please check your configuration.");
      }
    } catch (err) {
      alert(err.message);
    }
  });

  // Test Firebase Connection
  testFirebaseBtn.addEventListener("click", async () => {
    try {
      const config = parseConfigInput(firebaseConfigInput.value);
      if (!config || !config.apiKey) {
        alert("Please enter your Firebase configuration first.");
        return;
      }
      testFirebaseBtn.disabled = true;
      testFirebaseBtn.textContent = "Testing...";

      const tempApp = firebase.initializeApp(config, "testApp_" + Date.now());
      const tempDb = tempApp.database();
      await tempDb.ref(".info/connected").once("value");
      alert("✅ Success! Connected to Firebase Realtime Database.");
      await tempApp.delete();
    } catch (err) {
      alert("❌ Connection failed: " + (err.message || err));
    } finally {
      testFirebaseBtn.disabled = false;
      testFirebaseBtn.textContent = "Test Connection";
    }
  });

  // Disconnect Firebase
  clearFirebaseBtn.addEventListener("click", () => {
    if (confirm("Disconnect Firebase and switch back to Local Storage mode?")) {
      localStorage.removeItem("living_oils_firebase_config");
      location.reload();
    }
  });

  // Clear All Orders
  clearAllOrdersBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear ALL orders? This cannot be undone.")) {
      setLocalOrders([]);
      renderOrders();
      showToast("All orders cleared from local store");
      closeSettingsModal();
    }
  });

  // Export CSV
  exportCsvBtn.addEventListener("click", () => {
    const list = getFilteredOrders();
    if (!list.length) {
      alert("No orders to export.");
      return;
    }

    const headers = [
      "Order ID",
      "Date",
      "Status",
      "Customer Name",
      "Customer Phone",
      "Delivery Address",
      "Total Amount",
      "Items Summary",
      "Admin Note"
    ];

    const rows = list.map((o) => {
      const itemsText = (o.items || [])
        .map((it) => `${it.qty}x ${it.en || it.name} (${it.packLabel || ""})`)
        .join("; ");

      return [
        o.id,
        formatDate(o.createdAt),
        o.status || "pending",
        `"${(o.customer?.name || "").replace(/"/g, '""')}"`,
        `"${(o.customer?.phone || "").replace(/"/g, '""')}"`,
        `"${(o.customer?.address || "").replace(/"/g, '""')}"`,
        o.totalAmount || 0,
        `"${itemsText.replace(/"/g, '""')}"`,
        `"${(o.adminNote || "").replace(/"/g, '""')}"`
      ];
    });

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `living_oils_orders_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Orders exported to CSV");
  });

  // Add Sample Order helper
  function addSampleOrder() {
    const now = new Date();
    const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderId = `LO-${dateStr}-${randSuffix}`;

    const samples = [
      { name: "Suresh Kumar", phone: "9876543210", address: "H.No 12-4-50, Gandhi Road, Nellore - 524001" },
      { name: "Lakshmi Devi", phone: "9440123456", address: "Flat 202, Sri Sai Nilayam, Trunk Road, Nellore" },
      { name: "Venkat Rao", phone: "9988776655", address: "Plot 45, Dargamitta, Near Children's Park, Nellore" }
    ];

    const sampleCustomer = samples[Math.floor(Math.random() * samples.length)];

    const sampleOrder = {
      id: orderId,
      createdAt: now.toISOString(),
      status: "pending",
      customer: sampleCustomer,
      items: [
        {
          id: "coconut",
          name: "కొబ్బరి నూనె",
          en: "Coconut Oil",
          ml: 1000,
          packLabel: "1 litre",
          qty: 2,
          unitPrice: 500,
          lineTotal: 1000
        },
        {
          id: "groundnut",
          name: "వేరు శనగ నూనె (పల్లిలు)",
          en: "Groundnut Oil",
          ml: 500,
          packLabel: "500 ml",
          qty: 1,
          unitPrice: 180,
          lineTotal: 180
        }
      ],
      totalAmount: 1180,
      hasUnknownPrice: false,
      notes: ""
    };

    saveOrderToSystem(sampleOrder);
    showToast(`Test order ${orderId} created!`);
  }

  addSampleBtn.addEventListener("click", addSampleOrder);
  emptyAddTestBtn.addEventListener("click", addSampleOrder);
  refreshBtn.addEventListener("click", () => {
    renderOrders();
    showToast("Orders list refreshed");
  });

  // Alert Modal Elements
  const newOrderAlertModal = document.querySelector("#newOrderAlertModal");
  const alertModalContent = document.querySelector("#alertModalContent");
  const closeAlertModalBtn = document.querySelector("#closeAlertModalBtn");
  const dismissAlertBtn = document.querySelector("#dismissAlertBtn");
  const viewAlertOrderBtn = document.querySelector("#viewAlertOrderBtn");

  function showNewOrderAlert(order) {
    playOrderChime();
    startTitleFlash(order.id);
    sendDesktopNotification(order);
    showToast(`🚨 New Order Received: ${order.id}`, "new-order");

    if (!newOrderAlertModal || !alertModalContent) return;

    const items = (order.items || [])
      .map(
        (it) =>
          `• <strong>${it.qty}x</strong> ${escapeHtml(it.en || it.name)} (${escapeHtml(it.packLabel || "")}) — ${money(it.lineTotal)}`
      )
      .join("<br>");

    const cleanPhone = (order.customer?.phone || "").replace(/\D/g, "");

    alertModalContent.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <span style="font-family: ui-monospace, monospace; font-size: 15px; font-weight: 800; background: #e6f7ec; color: #08766c; padding: 4px 10px; border-radius: 6px;">${order.id}</span>
        <span style="font-weight: 800; font-size: 20px; color: #118c80;">${money(order.totalAmount)}</span>
      </div>
      <p style="margin-bottom: 6px;"><strong>Customer:</strong> ${escapeHtml(order.customer?.name || "Unknown")}</p>
      <p style="margin-bottom: 6px;">
        <strong>Phone:</strong> ${escapeHtml(order.customer?.phone || "N/A")}
        ${
          cleanPhone
            ? `<a class="quick-link wa" href="https://wa.me/${cleanPhone}" target="_blank" style="margin-left: 6px;">💬 WA</a> <a class="quick-link" href="tel:${cleanPhone}" style="margin-left: 4px;">📞 Call</a>`
            : ""
        }
      </p>
      <p style="margin-bottom: 12px;"><strong>Address:</strong> ${escapeHtml(order.customer?.address || "N/A")}</p>
      <div style="background: #f8faf9; border: 1px solid var(--line); border-radius: 8px; padding: 12px; font-size: 13px; line-height: 1.6;">
        <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--muted); margin-bottom: 4px;">Items Ordered</div>
        ${items || "No items"}
      </div>
    `;

    newOrderAlertModal.classList.add("open");
    newOrderAlertModal.setAttribute("aria-hidden", "false");

    if (viewAlertOrderBtn) {
      viewAlertOrderBtn.onclick = () => {
        closeAlertModal();
        openOrderDetails(order.id);
      };
    }
  }

  function closeAlertModal() {
    if (newOrderAlertModal) {
      newOrderAlertModal.classList.remove("open");
      newOrderAlertModal.setAttribute("aria-hidden", "true");
    }
    stopTitleFlash();
  }

  if (closeAlertModalBtn) closeAlertModalBtn.addEventListener("click", closeAlertModal);
  if (dismissAlertBtn) dismissAlertBtn.addEventListener("click", closeAlertModal);
  if (newOrderAlertModal) {
    newOrderAlertModal.addEventListener("click", (e) => {
      if (e.target === newOrderAlertModal) closeAlertModal();
    });
  }

  // Keyboard shortcut (Escape to close modals)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAlertModal();
      closeOrderDetailsModal();
      closeSettingsModal();
    }
  });

  const knownOrderIds = new Set();

  // Initialize and Subscribe
  window.addEventListener("DOMContentLoaded", () => {
    updateSoundUI();
    updateConnectionUI();
    updateDesktopNotifUI();

    const notifBtn = document.querySelector("#desktopNotifBtn");
    if (notifBtn) {
      notifBtn.addEventListener("click", async () => {
        if ("Notification" in window) {
          const perm = await Notification.requestPermission();
          updateDesktopNotifUI();
          if (perm === "granted") {
            showToast("Desktop notifications enabled!");
          }
        }
      });
    }

    // Subscribe to real-time order changes
    subscribeToOrders((orders) => {
      const incomingList = orders || [];

      if (isFirstLoad) {
        incomingList.forEach((o) => knownOrderIds.add(o.id));
        isFirstLoad = false;
        allOrders = incomingList;
        renderOrders();
        return;
      }

      // Detect new incoming orders
      const newOrders = incomingList.filter((o) => !knownOrderIds.has(o.id));
      allOrders = incomingList;

      if (newOrders.length > 0) {
        newOrders.forEach((o) => knownOrderIds.add(o.id));
        showNewOrderAlert(newOrders[0]);
      }

      renderOrders();
    });
  });
})();
