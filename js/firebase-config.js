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

// Cloud Functions(functions/ 폴더)를 `firebase deploy --only functions`로
// 배포하기 전까지는 반드시 false로 두세요. false인 동안은 Firestore/인증
// 콘솔 설정을 먼저 켜두어도 게임은 안전하게 "로컬 모드"로 계속 동작합니다.
// (Functions가 없는 상태에서 서버 요청을 보내면 전부 실패하기 때문)
// Cloud Functions 배포는 컴퓨터 없이도 https://shell.cloud.google.com
// (브라우저 터미널, Google Cloud Shell)에서 `firebase deploy`를 실행하면
// 태블릿/폰만으로도 가능합니다.
export const FUNCTIONS_DEPLOYED = false;
