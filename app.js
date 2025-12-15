// ===============================================
// OFA 配達アプリ V2（Firebase 完全接続）
// Auth / Firestore / Storage
// ===============================================

// Firebase SDK (CDN / ES Modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";


// ===============================================
// Firebase 設定（←あなたの実データに置換）
// ※ Firebaseコンソールの Webアプリ設定の値をそのまま入れてOK
// ※ storageBucket は「xxxx.firebasestorage.app」になってるはず
// ===============================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "haitatsu-app-27d69.firebaseapp.com",
  projectId: "haitatsu-app-27d69",
  storageBucket: "haitatsu-app-27d69.firebasestorage.app",
  messagingSenderId: "1074595379120",
  appId: "YOUR_APP_ID",
  // measurementId は必須じゃないので、無くてもOK
  // measurementId: "YOUR_MEASUREMENT_ID"
};


// ===============================================
// Firebase 初期化
// ===============================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);


// ===============================================
// 認証状態監視（ログイン状態でCSS切替）
// body.logged-in が付く/外れる
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
    console.error(e);
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
    console.error(e);
    alert(e.message);
  }
};


// ===============================================
// ログアウト
// ===============================================
window.logout = async () => {
  try {
    await signOut(auth);
    alert("ログアウトしました");
  } catch (e) {
    console.error(e);
    alert(e.message);
  }
};


// ===============================================
// 配達データ保存（Firestore）
// deliveries コレクションに保存
// ===============================================
window.saveDelivery = async (data) => {
  try {
    const uid = auth.currentUser?.uid || null;

    await addDoc(collection(db, "deliveries"), {
      ...data,
      createdAt: serverTimestamp(),
      uid
    });

    return true;
  } catch (e) {
    console.error(e);
    alert(e.message);
    return false;
  }
};


// ===============================================
// 配達データ取得（Firestore）
// ===============================================
window.loadDeliveries = async () => {
  try {
    const snap = await getDocs(collection(db, "deliveries"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error(e);
    alert(e.message);
    return [];
  }
};


// ===============================================
// 画像アップロード（Storage）
// images/ に保存してURLを返す
// ===============================================
window.uploadImage = async (file) => {
  try {
    if (!file) throw new Error("ファイルが選択されていません");

    const safeName = String(file.name || "image").replace(/[^\w.\-]+/g, "_");
    const imageRef = ref(storage, `images/${Date.now()}_${safeName}`);

    await uploadBytes(imageRef, file);
    const url = await getDownloadURL(imageRef);
    return url;
  } catch (e) {
    console.error(e);
    alert(e.message);
    return null;
  }
};
