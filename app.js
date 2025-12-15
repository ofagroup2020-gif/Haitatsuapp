// ============================
//  OFA Delivery V2 (Full)
//  - Firebase(Auth/Firestore/Storage)
//  - Google Maps + Geocoding
//  - OCR(Tesseract.js) + manual fix
//  - List + Map both operable
// ============================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, getDocs, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";

// ① Firebase設定（あなたのFirebaseコンソールから貼る）
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "XXXX",
  appId: "XXXX"
};

// ② Google Maps APIは driver.html の script key を貼る（YOUR_GOOGLE_MAPS_API_KEY）
const GEO_API = "https://maps.googleapis.com/maps/api/geocode/json";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ---------- 共通 ----------
const $ = (id)=>document.getElementById(id);
const todayKey = ()=> new Date().toISOString().slice(0,10); // YYYY-MM-DD

function beep(){
  // iOSで確実じゃないので、振動＋簡易音（許可される範囲）
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.start();
    setTimeout(()=>{ o.stop(); ctx.close(); }, 120);
  }catch{}
  if(navigator.vibrate) navigator.vibrate([60,40,60]);
}

function statusLabel(s){
  switch(s){
    case "OUT": return ["持出", "yellow"];
    case "DONE": return ["完了", "green"];
    case "ABSENT": return ["不在", "red"];
    case "HOLD": return ["保管", "blue"];
    case "RETURN": return ["返却", ""];
    case "HANDOVER": return ["引継", ""];
    default: return [s||"未", ""];
  }
}

function last4(x){
  const t = (x||"").replace(/\D/g,"");
  return t.length>=4 ? t.slice(-4) : t;
}

async function getMyPos(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error("GPS未対応"));
    navigator.geolocation.getCurrentPosition(
      p=> resolve({lat:p.coords.latitude, lng:p.coords.longitude}),
      e=> reject(e),
      { enableHighAccuracy:true, timeout:8000, maximumAge:10000 }
    );
  });
}

// ---------- Auth ----------
export async function authLogin(email, pass){
  if(!email || !pass) throw new Error("Email/Pass必須");
  await signInWithEmailAndPassword(auth, email, pass);
}
export async function authSignup(email, pass){
  if(!email || !pass) throw new Error("Email/Pass必須");
  await createUserWithEmailAndPassword(auth, email, pass);
}
async function authLogout(){
  await signOut(auth);
}

// ---------- Firestore model ----------
// collection: shipments
// doc fields:
//  dateKey, driverUid, tracking, ptype, name, zip, tel, addr, memo
//  status: OUT/DONE/ABSENT/HOLD/RETURN/HANDOVER
//  lat,lng, pinFixed(bool)
//  createdAt, updatedAt
//  history: array is heavy -> we store event subcollection optionally later
//
// collection: tenko
//  dateKey, driverUid, health, al, checks[], note, createdAt

async function addShipment(data){
  const col = collection(db, "shipments");
  const now = serverTimestamp();
  return await addDoc(col, {
    ...data,
    createdAt: now,
    updatedAt: now
  });
}

async function updateShipment(id, patch){
  const d = doc(db, "shipments", id);
  await updateDoc(d, { ...patch, updatedAt: serverTimestamp() });
}

async function listShipments(dateKey){
  const col = collection(db, "shipments");
  const qy = query(col, where("dateKey","==",dateKey), orderBy("createdAt","desc"));
  const snap = await getDocs(qy);
  return snap.docs.map(x=>({id:x.id, ...x.data()}));
}

async function listAllShipments(){
  const col = collection(db, "shipments");
  const qy = query(col, orderBy("createdAt","desc"));
  const snap = await getDocs(qy);
  return snap.docs.map(x=>({id:x.id, ...x.data()}));
}

async function saveTenko(data){
  const col = collection(db, "tenko");
  await addDoc(col, { ...data, createdAt: serverTimestamp() });
}

// ---------- Geocoding ----------
async function geocodeAddress(addr){
  const url = `${GEO_API}?address=${encodeURIComponent(addr)}&key=${encodeURIComponent("YOUR_GOOGLE_MAPS_API_KEY")}`;
  // ※この "YOUR_GOOGLE_MAPS_API_KEY" も同じキーを入れてOK（Geocoding有効化必須）
  const res = await fetch(url);
  const js = await res.json();
  if(js.status !== "OK") throw new Error(`Geocode失敗: ${js.status}`);
  const r = js.results[0];
  const loc = r.geometry.location;
  // 郵便番号を拾えることもある
  let zip = "";
  const comp = r.address_components || [];
  const z = comp.find(c=> (c.types||[]).includes("postal_code"));
  if(z) zip = z.long_name.replace("-","");
  return { lat: loc.lat, lng: loc.lng, zipGuess: zip, formatted: r.formatted_address };
}

// ---------- OCR (Tesseract.js) ----------
async function ocrImage(file){
  // ブラウザOCRは重い → “撮影→必要部だけ抽出→修正”が現実解
  // ここはまず「全文テキストを取る」→住所/郵便/名前の候補抽出
  const { createWorker } = await import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js");
  const worker = await createWorker("jpn");
  const { data } = await worker.recognize(file);
  await worker.terminate();
  const text = (data.text || "").replace(/\s+/g," ").trim();
  return text;
}

function extractCandidates(text){
  // 超実務寄り： “郵便番号/電話/住所っぽい/名前っぽい/伝票っぽい” を拾う
  const zip = (text.match(/(\d{3})\s*[- ]?\s*(\d{4})/)||[]).slice(1).join("") || "";
  const tel = (text.match(/(0\d{1,4}[- ]?\d{1,4}[- ]?\d{3,4})/)||[])[1] || "";
  const tracking = (text.match(/(\d{10,14})/)||[])[1] || "";

  // 住所：都道府県～番地までをざっくり（日本語住所の完全抽出は難しいので候補）
  const addr = (text.match(/(東京都|北海道|(?:京都|大阪)府|.{2,3}県).{5,60}/)||[])[0] || "";

  // 名前：漢字2-6 + 空白 + 漢字2-6 を候補（会社名が混ざるので手直し前提）
  const name = (text.match(/([一-龠]{2,6}\s?[一-龠]{2,6})/ )||[])[1] || "";

  return { zip, tel, addr, name, tracking };
}

// ---------- CSV ----------
function toCSV(rows){
  const esc = (s)=> `"${String(s??"").replaceAll('"','""')}"`;
  const head = ["date","status","ptype","tracking","name","zip","addr","tel","memo","lat","lng"];
  const lines = [head.map(esc).join(",")];
  for(const r of rows){
    lines.push([
      r.dateKey, r.status, r.ptype, r.tracking, r.name, r.zip, r.addr, r.tel, r.memo, r.lat, r.lng
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
function download(name, text, type="text/csv"){
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Driver Page ----------
let gMap=null;
let gMarkers=new Map();
let pinFixMode=false;

function setKPI(rows){
  const c = (s)=> rows.filter(r=>r.status===s).length;
  if($("k_out")) $("k_out").textContent = c("OUT");
  if($("k_done")) $("k_done").textContent = c("DONE");
  if($("k_abs")) $("k_abs").textContent = c("ABSENT");
  if($("k_hold")) $("k_hold").textContent = c("HOLD");
}

function setUserText(u){
  if($("who")) $("who").textContent = u ? `ログイン：${u.email}` : "未ログイン";
  if($("adminWho")) $("adminWho").textContent = u ? `ログイン：${u.email}` : "未ログイン";
}

function initTabs(){
  const btns=[...document.querySelectorAll(".tabBtn")];
  btns.forEach(b=>{
    b.addEventListener("click", ()=>{
      btns.forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      const t=b.dataset.tab;
      document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
      const panel = document.getElementById(t);
      if(panel) panel.classList.add("active");
      if(t==="t4") setTimeout(()=>{ if(gMap) google.maps.event.trigger(gMap,"resize"); }, 200);
    });
  });
}

async function ensureMap(){
  if(!window.google || !google.maps) return;
  if(gMap) return;

  const center = await getMyPos().catch(()=>({lat:31.59,lng:130.56})); // 鹿児島 fallback
  gMap = new google.maps.Map($("map"), {
    center,
    zoom: 14,
    mapTypeControl:false,
    streetViewControl:false,
    fullscreenControl:false,
    gestureHandling:"greedy"
  });

  gMap.addListener("click", async (e)=>{
    if(!pinFixMode) return;
    const targetId = window.__pinFixTargetId;
    if(!targetId) return;
    const pos = {lat:e.latLng.lat(), lng:e.latLng.lng()};
    await updateShipment(targetId, { lat:pos.lat, lng:pos.lng, pinFixed:true });
    pinFixMode=false;
    window.__pinFixTargetId=null;
    alert("ピン位置を修正しました");
    await refreshAll();
  });
}

function clearMarkers(){
  for(const m of gMarkers.values()) m.setMap(null);
  gMarkers.clear();
}

function addMarkerFor(row){
  if(!gMap || row.lat==null || row.lng==null) return;
  const pos = {lat:row.lat, lng:row.lng};
  const [lab, cls] = statusLabel(row.status);
  const color = cls==="green" ? "#22c55e" : cls==="red" ? "#ff2d55" : cls==="blue" ? "#1f7aff" : "#ffd60a";

  const marker = new google.maps.Marker({
    position:pos,
    map:gMap,
    label: { text:last4(row.tracking)||"•", color:"#111", fontWeight:"900" },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: color,
      fillOpacity: 0.95,
      strokeColor: "rgba(255,255,255,.85)",
      strokeWeight: 2,
      scale: 10
    }
  });

  const inf = new google.maps.InfoWindow({
    content: `
      <div style="font-family:system-ui;max-width:260px">
        <div style="font-weight:900">${row.name || "(名前未)"}</div>
        <div style="font-size:12px;color:#555;margin-top:6px">${row.addr || ""}</div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button data-act="DONE" style="padding:8px 10px;border:0;border-radius:10px;background:#22c55e;color:#061;font-weight:900;cursor:pointer">完了</button>
          <button data-act="ABSENT" style="padding:8px 10px;border:0;border-radius:10px;background:#ff2d55;color:#fff;font-weight:900;cursor:pointer">不在</button>
          <button data-act="HOLD" style="padding:8px 10px;border:0;border-radius:10px;background:#1f7aff;color:#fff;font-weight:900;cursor:pointer">保管</button>
          <button data-act="PIN" style="padding:8px 10px;border:1px solid #ccc;border-radius:10px;background:#fff;color:#111;font-weight:900;cursor:pointer">ピン修正</button>
        </div>
      </div>
    `
  });

  marker.addListener("click", ()=>{
    inf.open({anchor:marker, map:gMap});
    setTimeout(()=>{
      const box = document.querySelector(".gm-style-iw");
      if(!box) return;
      box.querySelectorAll("button[data-act]").forEach(btn=>{
        btn.onclick = async ()=>{
          const act = btn.dataset.act;
          if(act==="PIN"){
            pinFixMode=true;
            window.__pinFixTargetId = row.id;
            alert("地図をタップしてピン位置を修正してください");
            return;
          }
          await updateShipment(row.id, { status: act });
          beep();
          await refreshAll();
        };
      });
    }, 150);
  });

  gMarkers.set(row.id, marker);
}

function renderList(rows){
  const q = ($("q")?.value||"").trim();
  const sort = $("sort")?.value || "near";

  let filtered = rows;
  if(q){
    filtered = rows.filter(r=>{
      const s = `${r.name||""} ${r.addr||""} ${r.tracking||""} ${last4(r.tracking)||""}`.toLowerCase();
      return s.includes(q.toLowerCase());
    });
  }

  // sort
  if(sort==="addr"){
    filtered.sort((a,b)=> (a.addr||"").localeCompare(b.addr||""));
  }else if(sort==="near"){
    // near sort needs my pos (cached)
    // we'll fill later in refreshAll
  }else if(sort==="manual"){
    filtered.sort((a,b)=> (a.manualOrder??999999) - (b.manualOrder??999999));
  }

  const root = $("list");
  if(!root) return;
  root.innerHTML = "";

  for(const r of filtered){
    const [lab, cls] = statusLabel(r.status);
    const el = document.createElement("div");
    el.className="item";
    el.draggable = true;

    el.innerHTML = `
      <div class="itemHead">
        <div>
          <strong>${r.name||"(名前未)"} <span style="opacity:.8">#${last4(r.tracking)||"----"}</span></strong>
          <div class="itemMeta">${r.addr||""}</div>
          <div class="itemMeta">${r.tel?("☎ "+r.tel):""}</div>
        </div>
        <div class="pills">
          <span class="pill ${cls}">${lab}</span>
          <span class="pill">${r.ptype||"—"}</span>
        </div>
      </div>

      <div class="btnRow" style="margin-top:10px">
        <button class="btn small green" data-s="DONE">完了</button>
        <button class="btn small danger" data-s="ABSENT">不在</button>
        <button class="btn small primary" data-s="HOLD">保管</button>
        <button class="btn small" data-s="RETURN">返却</button>
        <button class="btn small" data-s="HANDOVER">引継</button>
        <button class="btn small yellow" data-act="NAV">ナビ</button>
      </div>
    `;

    el.querySelectorAll("button[data-s]").forEach(b=>{
      b.onclick = async ()=>{
        await updateShipment(r.id, { status:b.dataset.s });
        beep();
        await refreshAll();
      };
    });

    el.querySelector('button[data-act="NAV"]').onclick = ()=>{
      // Google Maps 外部ナビ
      const u = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.addr||"")}`;
      window.open(u, "_blank");
    };

    // drag reorder (manual)
    el.addEventListener("dragstart", (e)=>{
      e.dataTransfer.setData("text/plain", r.id);
    });
    el.addEventListener("dragover", (e)=>e.preventDefault());
    el.addEventListener("drop", async (e)=>{
      e.preventDefault();
      const fromId = e.dataTransfer.getData("text/plain");
      const toId = r.id;
      if(fromId===toId) return;
      await swapManualOrder(fromId, toId, rows);
      $("sort").value="manual";
      await refreshAll();
    });

    root.appendChild(el);
  }
}

async function swapManualOrder(fromId, toId, rows){
  const a = rows.find(x=>x.id===fromId);
  const b = rows.find(x=>x.id===toId);
  if(!a || !b) return;
  const ao = a.manualOrder ?? 999999;
  const bo = b.manualOrder ?? 999999;
  await updateShipment(a.id, { manualOrder: bo });
  await updateShipment(b.id, { manualOrder: ao });
}

function renderReport(rows){
  const root = $("report");
  if(!root) return;
  const c = (s)=> rows.filter(r=>r.status===s).length;
  root.innerHTML = `
    <div class="kpis" style="margin:10px 0">
      <div class="kpi"><span class="dot yellow"></span>持出 ${c("OUT")}</div>
      <div class="kpi"><span class="dot green"></span>完了 ${c("DONE")}</div>
      <div class="kpi"><span class="dot red"></span>不在 ${c("ABSENT")}</div>
      <div class="kpi"><span class="dot blue"></span>保管 ${c("HOLD")}</div>
    </div>
    <div class="note">日付：${todayKey()} / 合計：${rows.length}件</div>
  `;
}

async function refreshAll(){
  const rows = await listShipments(todayKey());
  setKPI(rows);
  renderReport(rows);

  // near sort
  const sort = $("sort")?.value;
  if(sort==="near"){
    const me = await getMyPos().catch(()=>null);
    if(me){
      rows.forEach(r=>{
        r.__dist = (r.lat!=null && r.lng!=null) ? distKm(me.lat,me.lng,r.lat,r.lng) : 999999;
      });
      rows.sort((a,b)=> (a.__dist??999999)-(b.__dist??999999));
    }
  }

  renderList(rows);

  await ensureMap();
  if(gMap){
    clearMarkers();
    // map center to my pos
    const me = await getMyPos().catch(()=>null);
    if(me) gMap.setCenter(me);
    for(const r of rows) addMarkerFor(r);
  }
}

function distKm(a,b,c,d){
  const R=6371;
  const toRad=(x)=>x*Math.PI/180;
  const dLat=toRad(c-a), dLng=toRad(d-b);
  const sa=Math.sin(dLat/2)**2 + Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(sa));
}

async function initDriverPage(user){
  initTabs();
  setUserText(user);

  // buttons
  $("btnTenkoSave")?.addEventListener("click", async ()=>{
    const checks=[...document.querySelectorAll(".chk:checked")].map(x=>x.value);
    await saveTenko({
      dateKey: todayKey(),
      driverUid: user?.uid || "unknown",
      health: $("health")?.value || "",
      al: $("al")?.value || "",
      checks,
      note: $("tenkoNote")?.value || ""
    });
    $("tenkoBadge").textContent="済";
    beep();
    alert("点呼を保存しました");
  });

  $("btnGotoPickup")?.addEventListener("click", ()=>{
    document.querySelector('[data-tab="t2"]').click();
  });

  $("btnCapture")?.addEventListener("click", ()=> $("cam").click());

  $("cam")?.addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    // OCR
    $("geoStatus").style.display="block";
    $("geoStatus").textContent="OCR中…（少し待ってください）";
    try{
      const text = await ocrImage(file);
      const cand = extractCandidates(text);
      if(cand.tracking) $("tracking").value = cand.tracking;
      if(cand.name) $("name").value = cand.name;
      if(cand.zip) $("zip").value = cand.zip;
      if(cand.tel) $("tel").value = cand.tel;
      if(cand.addr) $("addr").value = cand.addr;

      beep();
      $("geoStatus").textContent="読み取り完了。間違いを直して「持出登録」してください。";
    }catch(err){
      $("geoStatus").textContent="OCR失敗：手入力で登録してください。";
    }
  });

  $("btnClear")?.addEventListener("click", ()=>{
    ["tracking","name","zip","tel","addr","memo"].forEach(id=>{ if($(id)) $(id).value=""; });
  });

  $("btnRegisterOut")?.addEventListener("click", async ()=>{
    const name = $("name").value.trim();
    const addr = $("addr").value.trim();
    if(!name || !addr){
      alert("必須：お客様名・住所");
      return;
    }

    $("geoStatus").style.display="block";
    $("geoStatus").textContent="住所からピン作成中（ジオコーディング）…";

    let lat=null,lng=null, zipGuess="";
    try{
      const geo = await geocodeAddress(addr);
      lat=geo.lat; lng=geo.lng; zipGuess=geo.zipGuess||"";
      if(!$("zip").value && zipGuess) $("zip").value = zipGuess;
      $("geoStatus").textContent="ピンOK。登録します…";
    }catch(err){
      $("geoStatus").textContent="ピン自動失敗。登録はできます（後でピン修正）";
    }

    const data = {
      dateKey: todayKey(),
      driverUid: user?.uid || "unknown",
      tracking: $("tracking").value.trim(),
      ptype: $("ptype").value,
      name,
      zip: $("zip").value.trim(),
      tel: $("tel").value.trim(),
      addr,
      memo: $("memo").value.trim(),
      status: "OUT",
      lat, lng,
      pinFixed: false
    };

    await addShipment(data);
    beep();
    $("geoStatus").textContent="登録完了！";
    ["tracking","name","zip","tel","addr","memo"].forEach(id=>{ if($(id)) $(id).value=""; });

    document.querySelector('[data-tab="t3"]').click();
    await refreshAll();
  });

  $("btnRefresh")?.addEventListener("click", refreshAll);

  $("btnExportCSV")?.addEventListener("click", async ()=>{
    const rows = await listShipments(todayKey());
    download(`ofa_shipments_${todayKey()}.csv`, toCSV(rows));
  });

  $("btnReportCSV")?.addEventListener("click", async ()=>{
    const rows = await listShipments(todayKey());
    download(`ofa_report_${todayKey()}.csv`, toCSV(rows));
  });

  $("btnMyPos")?.addEventListener("click", async ()=>{
    await ensureMap();
    const me = await getMyPos().catch(()=>null);
    if(me && gMap) gMap.setCenter(me);
  });

  $("btnPinFix")?.addEventListener("click", ()=>{
    pinFixMode = !pinFixMode;
    alert(pinFixMode ? "ピン修正モードON：修正したいピンを開いて「ピン修正」→地図タップ" : "ピン修正モードOFF");
  });

  $("btnTorch")?.addEventListener("click", ()=>{
    // iOS Safariのtorchは制限が強いので“対応端末のみ”扱い
    alert("ライトは端末・ブラウザ依存です。iPhone Safariは制限されることがあります。");
  });

  $("btnLogout")?.addEventListener("click", async ()=>{
    await authLogout();
    location.href="index.htm";
  });

  await refreshAll();
}

// ---------- Admin ----------
export async function initAdminPage(){
  onAuthStateChanged(auth, async (user)=>{
    setUserText(user);
    const rows = await listAllShipments();
    const root = $("alist");
    const render = ()=>{
      const q = ($("aq")?.value||"").trim().toLowerCase();
      const f = $("af")?.value || "all";
      let data = rows;

      if(f!=="all") data = data.filter(r=>r.status===f);
      if(q){
        data = data.filter(r=>{
          const s = `${r.name||""} ${r.addr||""} ${r.tracking||""}`.toLowerCase();
          return s.includes(q);
        });
      }

      // KPI
      const c = (s)=> rows.filter(r=>r.status===s).length;
      $("a_out").textContent = c("OUT");
      $("a_done").textContent = c("DONE");
      $("a_abs").textContent = c("ABSENT");
      $("a_hold").textContent = c("HOLD");

      root.innerHTML="";
      for(const r of data.slice(0,400)){
        const [lab, cls] = statusLabel(r.status);
        const el = document.createElement("div");
        el.className="item";
        el.innerHTML=`
          <div class="itemHead">
            <div>
              <strong>${r.name||"(名前未)"} <span style="opacity:.8">#${last4(r.tracking)||"----"}</span></strong>
              <div class="itemMeta">${r.addr||""}</div>
              <div class="itemMeta">${r.dateKey||""} / ${r.ptype||""} / ${r.driverUid||""}</div>
            </div>
            <div class="pills">
              <span class="pill ${cls}">${lab}</span>
            </div>
          </div>
        `;
        root.appendChild(el);
      }
    };

    $("aRefresh")?.addEventListener("click", ()=>location.reload());
    $("aCSV")?.addEventListener("click", ()=>{
      download(`ofa_admin_all.csv`, toCSV(rows));
    });
    $("aq")?.addEventListener("input", render);
    $("af")?.addEventListener("change", render);

    render();
  });
}

// ---------- boot ----------
onAuthStateChanged(auth, async (user)=>{
  setUserText(user);

  // driver.htmlのみ初期化
  if(location.pathname.endsWith("/driver.html") || location.pathname.endsWith("driver.html")){
    await initDriverPage(user);
  }
});
