import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAd48m-Xg1E1Y7EY73xLkVPqs4uhGm9-hg",
    authDomain: "k-os-36d06.firebaseapp.com",
    projectId: "k-os-36d06",
    storageBucket: "k-os-36d06.firebasestorage.app",
    messagingSenderId: "780326437033",
    appId: "1:780326437033:web:cc35923088f46bbe7729b8"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
