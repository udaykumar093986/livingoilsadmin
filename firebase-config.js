/**
 * Living Oils - Firebase & Orders Storage Bridge
 * Handles real-time synchronization between the storefront and admin dashboard.
 * Supports Firebase Realtime Database with automatic fallback to localStorage and BroadcastChannel.
 */

const STORAGE_ORDERS_KEY = "living_oils_orders";
const STORAGE_CONFIG_KEY = "living_oils_firebase_config";

// Broadcast channel for instantaneous cross-tab syncing in local/demo mode
const ordersChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("living_oils_orders_channel") : null;

// Default Firebase Configuration (can be overridden via Admin Dashboard Settings)
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBqQgTq-nkQ5Od7vpPfJEjOw4cmpv8sm2A",
  authDomain: "livingoils-5799f.firebaseapp.com",
  databaseURL: "https://livingoils-5799f-default-rtdb.firebaseio.com",
  projectId: "livingoils-5799f",
  storageBucket: "livingoils-5799f.firebasestorage.app",
  messagingSenderId: "585898734327",
  appId: "1:585898734327:web:693c88573a101df05ed9f2"
};

let firebaseApp = null;
let firebaseDb = null;
let isFirebaseReady = false;

/**
 * Retrieves the saved Firebase configuration from localStorage or uses default
 */
function getSavedFirebaseConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not read Firebase config from localStorage", e);
  }
  return DEFAULT_FIREBASE_CONFIG;
}

/**
 * Initializes Firebase if credentials exist
 */
function initFirebase(customConfig = null) {
  const config = customConfig || getSavedFirebaseConfig();
  
  // Basic validation - check if apiKey and (databaseURL or projectId) are provided
  if (!config || !config.apiKey || (!config.databaseURL && !config.projectId)) {
    isFirebaseReady = false;
    return false;
  }

  try {
    if (typeof firebase !== "undefined") {
      if (!firebase.apps || firebase.apps.length === 0) {
        firebaseApp = firebase.initializeApp(config);
      } else {
        firebaseApp = firebase.apps[0];
      }
      firebaseDb = firebase.database();
      isFirebaseReady = true;
      console.log("Firebase Realtime Database initialized successfully.");
      return true;
    } else {
      console.warn("Firebase SDK not loaded on this page.");
      isFirebaseReady = false;
      return false;
    }
  } catch (err) {
    console.error("Failed to initialize Firebase:", err);
    isFirebaseReady = false;
    return false;
  }
}

/**
 * Save Firebase configuration to localStorage and re-initialize
 */
function saveFirebaseConfig(config) {
  try {
    localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
    return initFirebase(config);
  } catch (e) {
    console.error("Failed to save Firebase config", e);
    return false;
  }
}

/**
 * Get all orders from local storage
 */
function getLocalOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_ORDERS_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (e) {
    console.error("Error reading local orders:", e);
  }
  return [];
}

/**
 * Save orders array to local storage
 */
function setLocalOrders(orders) {
  try {
    localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
  } catch (e) {
    console.error("Error saving local orders:", e);
  }
}

const localSubscribers = new Set();

function notifyLocalSubscribers() {
  const currentOrders = getLocalOrders();
  localSubscribers.forEach(cb => {
    try {
      cb(currentOrders);
    } catch (e) {
      console.error("Subscriber notification error:", e);
    }
  });
}

/**
 * Saves a new order both to Firebase (if ready) and to local storage.
 * Resolves with true once successfully saved.
 */
async function saveOrderToSystem(order) {
  if (!order || !order.id) {
    throw new Error("Invalid order data");
  }

  // 1. Save locally first as a guaranteed baseline
  const localOrders = getLocalOrders();
  const existingIndex = localOrders.findIndex(o => o.id === order.id);
  if (existingIndex >= 0) {
    localOrders[existingIndex] = order;
  } else {
    localOrders.unshift(order);
  }
  setLocalOrders(localOrders);
  notifyLocalSubscribers();

  // Broadcast to other open tabs on this browser
  if (ordersChannel) {
    try {
      ordersChannel.postMessage({ type: "NEW_ORDER", order: order });
    } catch (e) {
      // ignore
    }
  }

  // 2. Save to Firebase Realtime Database if connected
  if (isFirebaseReady && firebaseDb) {
    try {
      await firebaseDb.ref("orders/" + order.id).set(order);
      console.log("Order saved to Firebase Realtime Database:", order.id);
    } catch (err) {
      console.error("Firebase save failed, stored locally instead:", err);
    }
  }

  return true;
}

/**
 * Subscribes to real-time order updates.
 * Invokes callback(ordersArray) whenever changes occur.
 */
function subscribeToOrders(callback) {
  if (typeof callback !== "function") return () => {};

  localSubscribers.add(callback);

  // Initial load from local
  let currentOrders = getLocalOrders();
  callback(currentOrders);

  // If Firebase is available, listen to Realtime Database
  if (isFirebaseReady && firebaseDb) {
    const ordersRef = firebaseDb.ref("orders");
    const onValueChange = (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Convert object map to sorted array by createdAt desc
        const list = Object.values(data);
        list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        currentOrders = list;
        setLocalOrders(list);
        callback(list);
      } else {
        // Empty in Firebase
        callback([]);
      }
    };

    ordersRef.on("value", onValueChange);

    // Return unsubscribe function
    return () => {
      localSubscribers.delete(callback);
      ordersRef.off("value", onValueChange);
    };
  }

  // Fallback: Listen to BroadcastChannel and window storage events
  const onBroadcast = (event) => {
    if (event.data && (event.data.type === "NEW_ORDER" || event.data.type === "UPDATE_ORDER" || event.data.type === "ORDERS_CHANGED")) {
      notifyLocalSubscribers();
    }
  };

  const onStorage = (e) => {
    if (e.key === STORAGE_ORDERS_KEY) {
      notifyLocalSubscribers();
    }
  };

  if (ordersChannel) {
    ordersChannel.addEventListener("message", onBroadcast);
  }
  window.addEventListener("storage", onStorage);

  return () => {
    localSubscribers.delete(callback);
    if (ordersChannel) ordersChannel.removeEventListener("message", onBroadcast);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Updates an order's status and optional note
 */
async function updateOrderStatusInSystem(orderId, newStatus, note = null) {
  // Update local
  const localOrders = getLocalOrders();
  const order = localOrders.find(o => o.id === orderId);
  if (order) {
    order.status = newStatus;
    if (note !== null) order.adminNote = note;
    order.updatedAt = new Date().toISOString();
    setLocalOrders(localOrders);
    notifyLocalSubscribers();

    if (ordersChannel) {
      ordersChannel.postMessage({ type: "UPDATE_ORDER", orderId: orderId, status: newStatus });
    }
  }

  // Update Firebase if ready
  if (isFirebaseReady && firebaseDb) {
    try {
      const updates = {
        status: newStatus,
        updatedAt: new Date().toISOString()
      };
      if (note !== null) updates.adminNote = note;
      await firebaseDb.ref("orders/" + orderId).update(updates);
    } catch (err) {
      console.error("Failed to update status in Firebase:", err);
    }
  }

  return true;
}

/**
 * Deletes an order
 */
async function deleteOrderFromSystem(orderId) {
  // Remove local
  let localOrders = getLocalOrders();
  localOrders = localOrders.filter(o => o.id !== orderId);
  setLocalOrders(localOrders);
  notifyLocalSubscribers();

  if (ordersChannel) {
    ordersChannel.postMessage({ type: "ORDERS_CHANGED" });
  }

  // Remove from Firebase
  if (isFirebaseReady && firebaseDb) {
    try {
      await firebaseDb.ref("orders/" + orderId).remove();
    } catch (err) {
      console.error("Failed to delete order from Firebase:", err);
    }
  }

  return true;
}

// Auto-initialize if SDK is present
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    initFirebase();
  });
}
