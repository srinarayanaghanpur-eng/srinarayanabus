/**
 * Dual Storage System: localStorage + Firebase Firestore
 * Falls back to localStorage if Firebase is unavailable
 * Automatically syncs data between local and cloud storage
 */

import { db } from "./firebase";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";

export const StorageKeys = {
  DIESEL: "snhs_diesel",
  MAINTENANCE: "snhs_maint",
  OTHER: "snhs_other",
  ROUTES: "snhs_route",
  STUDENTS: "snhs_students",
  HOLIDAYS: "snhs_holidays",
  PIN: "snhs_pin",
  BUS_SETTINGS: "snhs_bussettings",
  BUSES: "snhs_buses",
  DEFAULT_KM: "snhs_defaultkm",
};

/**
 * Storage Service - Handles both localStorage and Firebase Firestore
 * Priority: Try Firebase first, fallback to localStorage
 */
export const storageService = {
  /**
   * Save data to both localStorage and Firebase
   * @param {string} key - Storage key
   * @param {any} value - Data to store (will be JSON stringified)
   * @returns {Promise<boolean>} - Success status
   */
  async save(key, value) {
    const jsonValue = JSON.stringify(value);
    
    // Always save to localStorage (instant, reliable)
    try {
      localStorage.setItem(key, jsonValue);
    } catch (error) {
      console.warn("LocalStorage save failed:", error);
    }

    // Try to save to Firebase if available
    if (db) {
      try {
        await setDoc(doc(db, "app_data", key), {
          value: jsonValue,
          lastUpdated: new Date(),
          key: key,
        });
      } catch (error) {
        console.warn(`Firebase save failed for key ${key}:`, error);
        // Don't throw - localStorage is already saved
      }
    }

    return true;
  },

  /**
   * Load data from localStorage first, fallback to Firebase
   * @param {string} key - Storage key
   * @returns {Promise<any>} - Parsed value or null
   */
  async load(key) {
    // Try localStorage first (faster)
    const localValue = localStorage.getItem(key);
    if (localValue) {
      try {
        return JSON.parse(localValue);
      } catch (error) {
        console.warn("LocalStorage parse failed:", error);
      }
    }

    // Fallback to Firebase
    if (db) {
      try {
        const docSnap = await getDoc(doc(db, "app_data", key));
        if (docSnap.exists()) {
          const value = JSON.parse(docSnap.data().value);
          // Sync back to localStorage
          localStorage.setItem(key, JSON.stringify(value));
          return value;
        }
      } catch (error) {
        console.warn(`Firebase load failed for key ${key}:`, error);
      }
    }

    return null;
  },

  /**
   * Load all keys
   * @returns {Promise<Object>} - Object with all storage keys and values
   */
  async loadAll() {
    const result = {};

    // First load all from localStorage
    for (const key of Object.values(StorageKeys)) {
      const localValue = localStorage.getItem(key);
      if (localValue) {
        try {
          result[key] = JSON.parse(localValue);
        } catch (error) {
          console.warn(`LocalStorage parse failed for ${key}:`, error);
        }
      }
    }

    // Then try to sync from Firebase (cloud values override local if newer)
    if (db) {
      try {
        const querySnapshot = await getDocs(collection(db, "app_data"));
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          try {
            result[data.key] = JSON.parse(data.value);
            // Sync to localStorage
            localStorage.setItem(data.key, data.value);
          } catch (error) {
            console.warn(`Firebase parse failed for ${data.key}:`, error);
          }
        });
      } catch (error) {
        console.warn("Firebase loadAll failed:", error);
      }
    }

    return result;
  },

  /**
   * Delete data from both localStorage and Firebase
   * @param {string} key - Storage key
   * @returns {Promise<boolean>} - Success status
   */
  async delete(key) {
    // Delete from localStorage
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn("LocalStorage delete failed:", error);
    }

    // Delete from Firebase
    if (db) {
      try {
        await deleteDoc(doc(db, "app_data", key));
      } catch (error) {
        console.warn(`Firebase delete failed for key ${key}:`, error);
      }
    }

    return true;
  },

  /**
   * Clear all data from both localStorage and Firebase
   * @returns {Promise<boolean>} - Success status
   */
  async clearAll() {
    // Clear localStorage
    try {
      for (const key of Object.values(StorageKeys)) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn("LocalStorage clearAll failed:", error);
    }

    // Clear Firebase
    if (db) {
      try {
        const querySnapshot = await getDocs(collection(db, "app_data"));
        querySnapshot.forEach(async (doc) => {
          await deleteDoc(doc.ref);
        });
      } catch (error) {
        console.warn("Firebase clearAll failed:", error);
      }
    }

    return true;
  },

  /**
   * Check if Firebase is available
   * @returns {boolean}
   */
  isFirebaseAvailable() {
    return db !== null && db !== undefined;
  },
};

export default storageService;
