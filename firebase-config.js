<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyCg0A0GTVjUAAaHMQtcq_0VquxlWzUEx6Y",
    authDomain: "uno-multiplayer-28c98.firebaseapp.com",
    projectId: "uno-multiplayer-28c98",
    storageBucket: "uno-multiplayer-28c98.firebasestorage.app",
    messagingSenderId: "551251573112",
    appId: "1:551251573112:web:374c3561eb102e302a708d",
    measurementId: "G-RGB2289VFV"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
