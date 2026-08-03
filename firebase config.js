// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCS8xDTdQU2aYytOihvjVc9G9LqZ1CC5M8",
  authDomain: "civalization-847a5.firebaseapp.com",
  projectId: "civalization-847a5",
  storageBucket: "civalization-847a5.firebasestorage.app",
  messagingSenderId: "1079160891199",
  appId: "1:1079160891199:web:e069e5b44404a9f0ac558a",
  measurementId: "G-5QFT2Q6Q8G"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
