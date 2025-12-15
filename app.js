// ===============================================
// OFA 配達アプリ V2（Firebase 完全接続 / A案）
// Auth / Firestore / Storage
// ===============================================

// Firebase SDK（CDN / ES Modules）
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
// Firebase 設定（Firebase Console → Config から）
// ===============================================
const firebaseConfig = {
  apiKey: "AIzaSyBv7MvCNx5ifQV6GBeBjWNIuvG-0JgKtwQ",
  authDomain: "haitatsu-app-27d69.firebaseapp.com",
  projectId: "haitatsu-app-27d69",
  storageBucket: "haitatsu-app-27d69.firebasestorage.app",
  messagingSenderId: "1074595379120",
  appId: "1:1074595379120:web:6b7cd4d8b4b79d9a5d0875"
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
// 認証（index.html から呼ばれる）
// ===============================================
export const authLogin = async (email, password) => {
  await signInWithEmailAndPassword(auth, email, password);
};

export const authSignup = async (email, password) => {
  await createUserWithEmailAndPassword(auth, email, password);
};

export const authLogout = async () => {
  await signOut(auth);
};

// ===============================================
// 配達データ保存（Firestore）
// ===============================================
export const saveDelivery = async (data) => {
  if (!auth.currentUser) throw new Error("未ログインです");

  await addDoc(collection(db, "deliveries"), {
    ...data,
    uid: auth.currentUser.uid,
    createdAt: serverTimestamp()
  });
};

// ===============================================
// 配達データ取得
// ===============================================
export const loadDeliveries = async () => {
  const snap = await getDocs(collection(db, "deliveries"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// ===============================================
// 画像アップロード（Storage）
// ===============================================
export const uploadImage = async (file) => {
  if (!file) throw new Error("ファイルがありません");

  const imageRef = ref(
    storage,
    `images/${Date.now()}_${file.name}`
  );

  await uploadBytes(imageRef, file);
  return await getDownloadURL(imageRef);
};
