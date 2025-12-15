// ===============================================
// OFA 配達アプリ V2（Firebase 完全接続）
// Auth / Firestore / Storage
// ===============================================

// Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";


// ===============================================
// Firebase 設定（←あなたの実データ）
// ===============================================
const firebaseConfig = {
  apiKey: "AIzaSyBv7MvCNx5ifQVG6GBeBjWNluvG-0XXXX",
  authDomain: "haitatsu-app-27d69.firebaseapp.com",
  projectId: "haitatsu-app-27d69",
  storageBucket: "haitatsu-app-27d69.appspot.com",
  messagingSenderId: "1074595379120",
  appId: "1:1074595379120:web:6b7cd4d8b4b79dXXXX",
};

// ===============================================
// Firebase 初期化
// ===============================================
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);


// ===============================================
// 認証状態監視
// ===============================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("ログイン中:", user.email);
    document.body.classList.add("logged-in");
  } else {
    console.log("未ログイン");
    document.body.classList.remove("logged-in");
  }
});


// ===============================================
// ログイン
// ===============================================
window.login = async (email, password) => {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("ログイン成功");
  } catch (e) {
    alert(e.message);
  }
};


// ===============================================
// 新規ユーザー作成
// ===============================================
window.register = async (email, password) => {
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("ユーザー作成完了");
  } catch (e) {
    alert(e.message);
  }
};


// ===============================================
// ログアウト
// ===============================================
window.logout = async () => {
  await signOut(auth);
  alert("ログアウトしました");
};


// ===============================================
// 配達データ保存（Firestore）
// ===============================================
window.saveDelivery = async (data) => {
  await addDoc(collection(db, "deliveries"), {
    ...data,
    createdAt: serverTimestamp(),
    uid: auth.currentUser?.uid || null
  });
};


// ===============================================
// 配達データ取得
// ===============================================
window.loadDeliveries = async () => {
  const snap = await getDocs(collection(db, "deliveries"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};


// ===============================================
// 画像アップロード（Storage）
// ===============================================
window.uploadImage = async (file) => {
  const imageRef = ref(
    storage,
    `images/${Date.now()}_${file.name}`
  );

  await uploadBytes(imageRef, file);
  return await getDownloadURL(imageRef);
};
