
/* ========= 状態 ========= */
let items = [];
let stream = null;

/* ========= ログイン ========= */
document.getElementById("loginBtn").onclick = () => {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("mainHeader").classList.remove("hidden");
  document.getElementById("tabs").classList.remove("hidden");
  openTab("scan");
  initGPS();
};

/* ========= タブ ========= */
document.querySelectorAll("nav button").forEach(btn => {
  btn.onclick = () => openTab(btn.dataset.tab);
});

function openTab(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

/* ========= GPS ========= */
function initGPS() {
  navigator.geolocation.watchPosition(
    pos => {
      document.getElementById("gpsStatus").textContent = "GPS OK";
      document.getElementById("gpsStatus").className = "";
    },
    err => {
      alert("GPSをONにしてください");
    },
    { enableHighAccuracy: true }
  );
}

/* ========= カメラ ========= */
document.getElementById("startScan").onclick = async () => {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  });
  document.getElementById("camera").srcObject = stream;
  document.getElementById("camera").play();
};

document.getElementById("stopScan").onclick = () => {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
};

/* ========= リスト追加 ========= */
document.getElementById("addItem").onclick = () => {
  const data = {
    name: name.value,
    zip: zip.value,
    address: address.value,
    tel: tel.value,
    waybill: waybill.value
  };

  if (items.some(i => i.waybill === data.waybill)) {
    alert("⚠ 重複しています");
    navigator.vibrate(200);
    return;
  }

  items.push(data);
  renderList();
  beep();
  openTab("list");
};

function renderList() {
  const ul = document.getElementById("listArea");
  ul.innerHTML = "";
  items.forEach((i, idx) => {
    const li = document.createElement("li");
    li.textContent = `${idx + 1}. ${i.name} / ${i.address}`;
    ul.appendChild(li);
  });
  document.getElementById("pinCount").textContent = "PIN " + items.length;
}

/* ========= 音 ========= */
function beep() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = 880;
  osc.connect(ctx.destination);
  osc.start();
  setTimeout(() => osc.stop(), 120);
}
let map;
let markers = [];
let followMe = true;

function loadGoogleMap() {
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}`;
  script.async = true;
  script.onload = initMap;
  document.body.appendChild(script);
}
