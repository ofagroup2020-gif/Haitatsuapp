/* =====================================================
   OFA 配達アプリ app.js（完全版）
   GitHub Pages / iPhone Safari 対応
===================================================== */

/* ========= グローバル状態 ========= */
let items = [];          // 配達リスト
let stream = null;       // カメラ
let map = null;          // Google Map
let markers = [];        // ピン
let followMe = true;     // GPS追従
let myPosition = null;   // 自分の位置

/* ========= ローカル保存 ========= */
const STORAGE_KEY = "ofa_haitatsu_items";

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function loadItems() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (data) items = JSON.parse(data);
}

/* ========= ログイン（簡易） ========= */
document.getElementById("loginBtn").onclick = () => {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("mainHeader").classList.remove("hidden");
  document.getElementById("tabs").classList.remove("hidden");
  openTab("scan");
  initGPS();
};

/* ========= タブ切替 ========= */
document.querySelectorAll("nav button").forEach(btn => {
  btn.onclick = () => openTab(btn.dataset.tab);
});

function openTab(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");

  if (id === "map" && !map) {
    loadGoogleMap();
  }
}

/* ========= GPS（強制ON） ========= */
function initGPS() {
  if (!navigator.geolocation) {
    alert("GPS非対応端末です");
    return;
  }

  navigator.geolocation.watchPosition(
    pos => {
      myPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        heading: pos.coords.heading || 0
      };
      document.getElementById("gpsStatus").textContent = "GPS OK";
      document.getElementById("gpsStatus").className = "ok";

      if (map && followMe) {
        map.setCenter(myPosition);
        map.setHeading(myPosition.heading);
      }
    },
    err => {
      document.getElementById("gpsStatus").textContent = "GPS NG";
      document.getElementById("gpsStatus").className = "ng";
      alert("GPSをONにしてください");
    },
    { enableHighAccuracy: true }
  );
}

/* ========= カメラ ========= */
document.getElementById("startScan").onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });
    const video = document.getElementById("camera");
    video.srcObject = stream;
    video.play();
  } catch (e) {
    alert("カメラ起動失敗");
  }
};

document.getElementById("stopScan").onclick = () => {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
};

/* ========= ビープ音 ========= */
function beep() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  osc.frequency.value = 880;
  osc.connect(ctx.destination);
  osc.start();
  setTimeout(() => {
    osc.stop();
    ctx.close();
  }, 120);
}

/* ========= 郵便番号 → 住所 ========= */
async function zipToAddress(zip) {
  zip = zip.replace(/[^0-9]/g, "");
  if (zip.length !== 7) return;

  const res = await fetch(
    `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`
  );
  const data = await res.json();
  if (data.results && data.results[0]) {
    const r = data.results[0];
    document.getElementById("address").value =
      r.address1 + r.address2 + r.address3;
  } else {
    alert("住所が取得できません");
  }
}

document.getElementById("zip").addEventListener("change", e => {
  zipToAddress(e.target.value);
});

/* ========= 住所 → 緯度経度 ========= */
async function geocodeAddress(address) {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${GOOGLE_MAPS_API_KEY}`
  );
  const data = await res.json();
  if (data.status !== "OK") return null;
  return data.results[0].geometry.location;
}

/* ========= リスト追加 ========= */
document.getElementById("addItem").onclick = async () => {
  const item = {
    id: Date.now(),
    name: name.value.trim(),
    zip: zip.value.trim(),
    address: address.value.trim(),
    tel: tel.value.trim(),
    waybill: waybill.value.trim(),
    status: "todo",
    lat: null,
    lng: null
  };

  if (!item.name || !item.zip || !item.address || !item.tel) {
    alert("必須項目が未入力です");
    return;
  }

  if (items.some(i => i.waybill && i.waybill === item.waybill)) {
    alert("⚠ 伝票番号が重複しています");
    navigator.vibrate(200);
    return;
  }

  const loc = await geocodeAddress(item.address);
  if (loc) {
    item.lat = loc.lat;
    item.lng = loc.lng;
  } else {
    alert("住所を地図で特定できません。後でピン修正してください");
  }

  items.push(item);
  saveItems();
  renderList();
  renderPins();
  beep();
  openTab("list");
};

/* ========= リスト描画 ========= */
function renderList() {
  const ul = document.getElementById("listArea");
  ul.innerHTML = "";

  items.forEach((i, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <b>${idx + 1}. ${i.name}</b><br>
      ${i.address}<br>
      <button onclick="setStatus(${i.id}, 'done')">完了</button>
      <button onclick="setStatus(${i.id}, 'absent')">不在</button>
    `;
    ul.appendChild(li);
  });

  document.getElementById("pinCount").textContent = "PIN " + items.length;
}

function setStatus(id, status) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  item.status = status;
  saveItems();
  beep();
}

/* ========= Google Map ========= */
function loadGoogleMap() {
  const s = document.createElement("script");
  s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
  s.onload = initMap;
  document.body.appendChild(s);
}

function initMap() {
  map = new google.maps.Map(document.getElementById("mapArea"), {
    center: myPosition || { lat: 31.5966, lng: 130.5571 },
    zoom: 15,
    tilt: 45,
    heading: 0,
    gestureHandling: "greedy",
    rotateControl: true,
    streetViewControl: false
  });

  renderPins();
}

/* ========= ピン描画（修正可） ========= */
function renderPins() {
  markers.forEach(m => m.setMap(null));
  markers = [];

  items.forEach(item => {
    if (!item.lat) return;

    const marker = new google.maps.Marker({
      position: { lat: item.lat, lng: item.lng },
      map,
      draggable: true,
      title: item.name
    });

    marker.addListener("dragend", e => {
      item.lat = e.latLng.lat();
      item.lng = e.latLng.lng();
      saveItems();
      alert("ピンを修正しました");
    });

    markers.push(marker);
  });
}

/* ========= 初期化 ========= */
loadItems();
renderList();
