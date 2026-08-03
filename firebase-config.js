// ============================================================
// firebase-config.js
// Firebase 콘솔(https://console.firebase.google.com)에서
// 프로젝트를 만들고 "웹 앱 추가" 후 나오는 설정값을 아래에 붙여넣으세요.
// Firestore Database 를 "테스트 모드"(또는 아래 README의 보안 규칙)로 생성해야 합니다.
// ============================================================
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCS8xDTdQU2aYytOihvjVc9G9LqZ1CC5M8",
  authDomain: "civalization-847a5.firebaseapp.com",
  projectId: "civalization-847a5",
  storageBucket: "civalization-847a5.firebasestorage.app",
  messagingSenderId: "1079160891199",
  appId: "1:1079160891199:web:e069e5b44404a9f0ac558a",
};

// 값을 채워 넣기 전까지는 로컬(오프라인) 모드로만 동작합니다.
export const FIREBASE_ENABLED = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
