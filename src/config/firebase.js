import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBoTWsotufygMzVq_GFi1kT01zjb66q3pE",
  authDomain: "srinarayanabus.firebaseapp.com",
  projectId: "srinarayanabus",
  storageBucket: "srinarayanabus.firebasestorage.app",
  messagingSenderId: "795635149696",
  appId: "1:795635149696:web:ef29c8064b27e447a0af65"
};

// Initialize Firebase
let app;
let db;
let auth;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  console.log("Firebase initialized successfully");
} catch (error) {
  console.warn("Firebase initialization failed. Using localStorage only.", error);
  db = null;
  auth = null;
}

export { app, db, auth };
