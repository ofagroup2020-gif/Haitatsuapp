// ===============================================
// OFA 配達アプリ V2（Firebase 完全接続）
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
  serverTimestamp,
  query,
  orderBy,
  limit,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";


// ===============================================
// Firebase 設定（あなたの実データ）
// ※ measurementId はAnalytics用。今回なくても動く（入れててもOK）
// ===============================================
const firebaseConfig = {
  apiKey: "AIzaSyBv7MvCNx5ifQV6GBeBjWNIuvG-0JgKtwQ",
  authDomain: "haitatsu-app-27d69.firebaseapp.com",
  projectId: "haitatsu-app-27d69",
  storageBucket: "haitatsu-app-27d69.firebasestorage.app",
  messagingSenderId: "1074595379120",
  appId: "1:1074595379120:web:6b7cd4d8b4b79d9a5d0875",
  measurementId: "G-BZ8E7FGGYV"
};


// ===============================================
// Firebase 初期化
// ===============================================
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);


// ===============================================
// 便利：現在ユーザー取得
// ===============================================
const getUid = () => auth.currentUser?.uid || null;
const getEmail = () => auth.currentUser?.email || null;


// ===============================================
// 認証状態監視（UI切替用 class）
// ===============================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("ログイン中:", user.email);
    document.body.classList.add("logged-in");
    document.body.classList.remove("logged-out");
  } else {
    console.log("未ログイン");
    document.body.classList.remove("logged-in");
    document.body.classList.add("logged-out");
  }
});


// ===============================================
// ログイン / 新規登録 / ログアウト（HTMLから呼ぶ用）
// ===============================================
window.login = async (email, password) => {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("ログイン成功");
    return true;
  } catch (e) {
    console.error(e);
    alert(e.message);
    return false;
  }
};

window.register = async (email, password) => {
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("ユーザー作成完了");
    return true;
  } catch (e) {
    console.error(e);
    alert(e.message);
    return false;
  }
};

window.logout = async () => {
  try {
    await signOut(auth);
    alert("ログアウトしました");
    return true;
  } catch (e) {
    console.error(e);
    alert(e.message);
    return false;
  }
};


// ===============================================
// 配達データ保存（Firestore）
// - data はオブジェクトを想定（例：日付/エリア/売上/メモなど）
// ===============================================
window.saveDelivery = async (data) => {
  // 未ログイン時は弾く（セキュリティ的に安全）
  if (!getUid()) throw new Error("未ログインです。ログインしてください。");

  const payload = {
    ...data,
    createdAt: serverTimestamp(),
    uid: getUid(),
    email: getEmail()
  };

  const docRef = await addDoc(collection(db, "deliveries"), payload);
  return { id: docRef.id, ...payload };
};


// ===============================================
// 配達データ取得（Firestore）
// - まずは全件（簡易）
// ===============================================
window.loadDeliveries = async () => {
  const snap = await getDocs(collection(db, "deliveries"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};


// ===============================================
// 自分の配達データだけ取得（おすすめ）
// - Firestoreルールで「自分だけ」にするなら、これ使う
// ===============================================
window.loadMyDeliveries = async (max = 200) => {
  if (!getUid()) throw new Error("未ログインです。ログインしてください。");

  const qy = query(
    collection(db, "deliveries"),
    where("uid", "==", getUid()),
    orderBy("createdAt", "desc"),
    limit(max)
  );

  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};


// ===============================================
// 画像アップロード（Storage）
// - file: input[type=file] の File
// - 戻り値: 公開URL（getDownloadURL）
// ===============================================
window.uploadImage = async (file) => {
  if (!getUid()) throw new Error("未ログインです。ログインしてください。");
  if (!file) throw new Error("ファイルがありません");

  const safeName = String(file.name || "image").replace(/[^\w.\-]/g, "_");
  const path = `images/${getUid()}/${Date.now()}_${safeName}`;

  const imageRef = ref(storage, path);
  await uploadBytes(imageRef, file);

  const url = await getDownloadURL(imageRef);
  return { url, path };
};


// ===============================================
// 動作確認用（ブラウザConsoleで使える）
// ===============================================
window.__firebaseInfo = () => ({
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  uid: getUid(),
  email: getEmail()
});
