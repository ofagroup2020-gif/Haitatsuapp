/* OFA Delivery Pro (Amazon級思想) v1
 * - iPhone対応連続スキャン（ZXing）
 * - 未配達/不在/完了 + 再配達
 * - 誤配防止：完了前に再スキャン一致必須（設定可）
 * - 置き配：メモ/受渡方法
 * - 並び替え：指定順（ドラッグ）/登録順/近い順/再配達優先
 * - 住所→座標（Nominatim：軽量・制限あり）※大量はGoogle移行推奨
 */

const STORE_KEY = "ofa_delivery_pro_v1";
const state = {
  items: load(),
  gps: null,
  scanning: false,
  stream: null,
  track: null,
  torch: false,
  kind: "宅配",
  sortMode: "custom",
  filterStatus: "todo",
};

const $ = (id) => document.getElementById(id);

/* ---------- Tabs ---------- */
document.querySelectorAll(".tab").forEach(btn => {
  const t = btn.getAttribute("data-tab");
  if(!t) return;
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    ["scan","list","report"].forEach(k=>{
      const el = $("tab-"+k);
      if(el) el.style.display = (k===t) ? "block" : "none";
    });
    if(t==="list") renderList();
    if(t==="report") renderReport();
  });
});

/* ---------- UI Bind ---------- */
$("btnGps").onclick = getGPS;
$("btnStart").onclick = startScan;
$("btnStop").onclick = stopScan;
$("btnTorch").onclick = toggleTorch;
$("btnTemp").onclick = () => addItem({ code: nextTempCode(), kind: state.kind });
$("btnManual").onclick = manualAdd;
$("btnBulkOut").onclick = bulkOut;
$("btnExportCsv").onclick = exportCSV;
$("btnPrint").onclick = () => window.print();
$("btnClearDone").onclick = clearDone;
$("btnRefreshGeo").onclick = batchGeocode;

$("filterStatus").onchange = (e)=>{ state.filterStatus = e.target.value; renderList(); };
$("sortMode").onchange = (e)=>{ state.sortMode = e.target.value; renderList(); };

document.querySelectorAll(".seg__btn").forEach(b=>{
  b.onclick = ()=>{
    document.querySelectorAll(".seg__btn").forEach(x=>x.classList.remove("seg__btn--on"));
    b.classList.add("seg__btn--on");
    state.kind = b.dataset.kind;
  };
});

/* ---------- Modal ---------- */
$("modalBg").onclick = closeModal;
$("modalClose").onclick = closeModal;

function openModal(title, bodyHTML, footerButtons=[]) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHTML;
  const ft = $("modalFoot");
  ft.innerHTML = "";
  footerButtons.forEach(btn=>{
    const el = document.createElement("button");
    el.className = "btn " + (btn.className || "btn--ghost");
    el.textContent = btn.text;
    el.onclick = btn.onClick;
    ft.appendChild(el);
  });
  $("modal").setAttribute("aria-hidden","false");
}
function closeModal(){
  $("modal").setAttribute("aria-hidden","true");
  $("modalBody").innerHTML = "";
  $("modalFoot").innerHTML = "";
}

/* ---------- Data ---------- */
function load(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); }
  catch { return []; }
}
function save(){
  localStorage.setItem(STORE_KEY, JSON.stringify(state.items));
}
function nowStr(){ return new Date().toLocaleString(); }

function nextTempCode(){
  const n = state.items.filter(x=>String(x.code||"").startsWith("TEMP-")).length + 1;
  return `TEMP-${String(n).padStart(4,"0")}`;
}

function addItem(partial){
  const item = {
    id: String(Date.now()+Math.random()),
    code: partial.code || nextTempCode(),
    kind: partial.kind || "宅配",
    name: partial.name || "",
    address: partial.address || "",
    phone: partial.phone || "",
    status: partial.status || "todo", // todo | absent | done
    createdAt: nowStr(),
    updatedAt: nowStr(),
    // 配達情報
    deliveryMethod: partial.deliveryMethod || "", // 置き配/手渡し 等
    memo: partial.memo || "",
    attempts: partial.attempts || [], // 履歴
    redeliveryAt: partial.redeliveryAt || "", // 再配達予定
    // map
    lat: partial.lat ?? null,
    lng: partial.lng ?? null,
    // 並び順（指定順）
    order: partial.order ?? nextOrder(),
  };
  state.items.push(item);
  save();
  setChip("chipScan", "SCAN: 登録", true);
  renderList();
}
function nextOrder(){
  const max = state.items.reduce((m,x)=>Math.max(m, Number.isFinite(x.order)?x.order:0), 0);
  return max + 1;
}
function updateItem(id, patch){
  const it = state.items.find(x=>x.id===id);
  if(!it) return;
  Object.assign(it, patch);
  it.updatedAt = nowStr();
  save();
}

/* ---------- GPS ---------- */
function getGPS(){
  navigator.geolocation.getCurrentPosition(
    p=>{
      state.gps = {lat:p.coords.latitude, lng:p.coords.longitude};
      setChip("chipGps","GPS: OK", true);
      renderList();
    },
    ()=>alert("GPS取得できません（iPhone設定→位置情報→Safariを許可）")
  );
}

/* ---------- Scanner (iPhone stable) ---------- */
const { BrowserMultiFormatReader, NotFoundException, BarcodeFormat, DecodeHintType } = ZXing;
const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.ITF,
  BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417
]);
hints.set(DecodeHintType.TRY_HARDER, true);
const codeReader = new BrowserMultiFormatReader(hints, 200);

let lastCode="", lastAt=0;

async function startScan(){
  if(state.scanning) return;
  state.scanning = true;
  $("videoWrap").style.display = "block";
  setChip("chipScan","SCAN: 起動中", true);
  $("scanHint").textContent = "カメラ起動中…（許可が出たらOK）";

  try{
    state.stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
    state.track = state.stream.getVideoTracks()[0];
    const video = $("video");
    video.srcObject = state.stream;
    await video.play();

    $("scanHint").textContent = "スキャン中：バーコード/QRを枠内に入れてください。";

    codeReader.decodeFromVideoDevice(null, "video", (result, err) => {
      if(!state.scanning) return;
      if(result){
        const code = result.getText();
        const now = Date.now();
        if(code===lastCode && (now-lastAt)<1200) return;
        lastCode = code; lastAt = now;

        // 重複は未配達内で防止
        const exists = state.items.some(x=>x.status!=="done" && x.code===code);
        if(!exists){
          addItem({code, kind: state.kind, status:"todo"});
          ping();
          $("scanHint").textContent = `読み取りOK：${code}`;
        }else{
          ping(0.02);
          $("scanHint").textContent = `既に登録済：${code}`;
        }
      }else if(err && !(err instanceof NotFoundException)){
        $("scanHint").textContent = "読み取りが不安定：距離/角度/明るさを調整してください。";
      }
    });

    setChip("chipScan","SCAN: 稼働", true);
  }catch(e){
    state.scanning=false;
    setChip("chipScan","SCAN: 失敗", false);
    alert("カメラ起動に失敗。設定→Safari→カメラ許可、またはサイト設定でカメラ許可してください。");
  }
}

function stopScan(){
  state.scanning=false;
  try{ codeReader.reset(); }catch{}
  if(state.stream){
    state.stream.getTracks().forEach(t=>t.stop());
  }
  state.stream=null; state.track=null; state.torch=false;
  $("videoWrap").style.display = "none";
  setChip("chipScan","SCAN: 停止", false);
  $("scanHint").textContent = "停止しました。";
}

async function toggleTorch(){
  if(!state.track) return alert("先に連続スキャンでカメラを起動してください。");
  const cap = state.track.getCapabilities ? state.track.getCapabilities() : {};
  if(!cap.torch) return alert("この端末/ブラウザはライト制御に非対応です。");
  state.torch = !state.torch;
  try{
    await state.track.applyConstraints({ advanced: [{ torch: state.torch }] });
  }catch{ alert("ライト切替に失敗しました。"); }
}

function ping(gain=0.05){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value=880;
    g.gain.value=gain;
    o.start();
    setTimeout(()=>{o.stop(); ctx.close();}, 80);
  }catch{}
  if(navigator.vibrate) navigator.vibrate(40);
}

/* ---------- Manual / Bulk ---------- */
function manualAdd(){
  openModal("手動登録", `
    <div class="field"><label>荷物番号（空なら仮登録）</label><input id="m_code" placeholder="例）9501-xxxx"></div>
    <div class="field"><label>宛名（配達前までに必須）</label><input id="m_name" placeholder="例）山田 太郎"></div>
    <div class="field"><label>住所（配達前までに必須）</label><input id="m_addr" placeholder="例）大阪市…"></div>
    <div class="field"><label>種別</label>
      <select id="m_kind">
        ${["宅配","手紙","ポスト投函","冷蔵・冷凍","代引","大物","壊れ物","書類","医療品","建材"].map(k=>`<option ${k===state.kind?"selected":""}>${k}</option>`).join("")}
      </select>
    </div>
  `,[
    {text:"登録", className:"btn--yellow", onClick:()=>{
      const code = $("m_code").value.trim() || nextTempCode();
      addItem({code, name:$("m_name").value.trim(), address:$("m_addr").value.trim(), kind:$("m_kind").value});
      closeModal();
    }},
    {text:"キャンセル", className:"btn--ghost", onClick:closeModal}
  ]);
}

function bulkOut(){
  // “持出”はステータスではなく履歴で管理（Amazon系思想）
  const targets = state.items.filter(x=>x.status==="todo");
  targets.forEach(it=>{
    it.attempts.push({at:nowStr(), type:"持出", note:"一括"});
    it.updatedAt = nowStr();
  });
  save();
  alert(`持出記録：${targets.length}件`);
  renderList();
}

/* ---------- List Render + Swipe + Drag ---------- */
function renderList(){
  const box = $("listBox");
  box.innerHTML = "";

  const todo = state.items.filter(x=>x.status==="todo").length;
  const absent = state.items.filter(x=>x.status==="absent").length;
  const done = state.items.filter(x=>x.status==="done").length;
  const redel = state.items.filter(x=>x.status==="absent" && x.redeliveryAt).length;

  $("kTodo").textContent = todo;
  $("kAbsent").textContent = absent;
  $("kDone").textContent = done;
  $("kRedeliver").textContent = redel;

  const items = getVisibleSortedItems();
  items.forEach(it=>{
    const need = (!it.name || !it.address);
    const badge = it.status==="todo" ? "badge--todo" : it.status==="absent" ? "badge--absent" : "badge--done";
    const stLabel = it.status==="todo" ? "未配達" : it.status==="absent" ? "不在" : "完了";
    const warn = need ? `<span class="warn">⚠ 宛名/住所 未入力</span>` : "";
    const redelTxt = (it.status==="absent" && it.redeliveryAt) ? ` / 再配達：<b>${esc(it.redeliveryAt)}</b>` : "";
    const pinTxt = (Number.isFinite(it.lat) && Number.isFinite(it.lng)) ? "" : " / 📍未ピン";

    const el = document.createElement("div");
    el.className = "item";
    el.draggable = (state.sortMode==="custom");
    el.dataset.id = it.id;

    el.innerHTML = `
      <div class="item__head">
        <div>
          <b>${esc(it.code)}</b>
          <div class="small">${esc(it.name||"（宛名未入力）")} / ${esc(it.address||"（住所未入力）")}</div>
        </div>
        <span class="badge ${badge}">${esc(it.kind)} / ${stLabel}</span>
      </div>
      <div class="small">${esc(it.createdAt)}${redelTxt}${pinTxt} ${warn}</div>

      <div class="actions">
        <button class="btn btn--ghost" data-act="edit">編集</button>
        <button class="btn btn--ghost" data-act="nav">ナビ</button>
        <button class="btn btn--yellow" data-act="done">${(it.kind==="手紙"||it.kind==="ポスト投函")?"投函完了":"配達完了"}</button>
        <button class="btn btn--danger" data-act="absent">不在</button>
        <button class="btn btn--ghost" data-act="scanok">誤配防止スキャン</button>
      </div>
      <div class="swipeHint">←不在 / 完了→</div>
    `;

    // Actions
    el.querySelectorAll("button[data-act]").forEach(b=>{
      b.onclick = (e)=>{
        e.stopPropagation();
        const act = b.dataset.act;
        if(act==="edit") openEdit(it.id);
        if(act==="nav") openNav(it.id);
        if(act==="absent") markAbsent(it.id);
        if(act==="done") markDoneWithScan(it.id); // 完了はスキャン一致必須
        if(act==="scanok") scanToMatch(it.id);
      };
    });

    // Tap -> quick focus (map)
    el.addEventListener("click", ()=>{
      // map.html に引き継ぎ（現在のidを保存）
      localStorage.setItem("ofa_focus_id", it.id);
      // 地図タブへ誘導したい場合はここで遷移も可
    });

    // Swipe
    attachSwipe(el, it.id);

    // Drag reorder
    attachDrag(el);

    box.appendChild(el);
  });
}

function getVisibleSortedItems(){
  let arr = [...state.items];

  // Filter
  if(state.filterStatus !== "all"){
    arr = arr.filter(x=>x.status===state.filterStatus);
  }

  // Sort
  const mode = state.sortMode;

  if(mode==="created"){
    arr.sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
    return arr;
  }

  if(mode==="redelivery"){
    arr.sort((a,b)=>{
      const ap = (a.status==="absent" && a.redeliveryAt) ? 0 : (a.status==="absent"?1:2);
      const bp = (b.status==="absent" && b.redeliveryAt) ? 0 : (b.status==="absent"?1:2);
      if(ap!==bp) return ap-bp;
      return (a.order||0)-(b.order||0);
    });
    return arr;
  }

  if(mode==="nearest"){
    if(!state.gps){
      alert("近い順はGPSが必要です（上のGPSボタン）");
      state.sortMode = "custom";
      $("sortMode").value = "custom";
      return getVisibleSortedItems();
    }
    // lat/lng無いものは後ろ
    arr.sort((a,b)=>{
      const da = (Number.isFinite(a.lat)&&Number.isFinite(a.lng)) ? dist(state.gps, a) : Infinity;
      const db = (Number.isFinite(b.lat)&&Number.isFinite(b.lng)) ? dist(state.gps, b) : Infinity;
      return da-db;
    });
    return arr;
  }

  // custom default
  arr.sort((a,b)=>(a.order||0)-(b.order||0));
  return arr;
}

function dist(p, it){
  const R=6371000;
  const toRad=(d)=>d*Math.PI/180;
  const dLat=toRad(it.lat-p.lat), dLng=toRad(it.lng-p.lng);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(p.lat))*Math.cos(toRad(it.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function attachSwipe(el, id){
  let startX=0, startY=0, dragging=false;
  el.addEventListener("pointerdown", (e)=>{
    startX = e.clientX; startY = e.clientY; dragging=false;
  });
  el.addEventListener("pointermove", (e)=>{
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if(Math.abs(dx)>25 && Math.abs(dx)>Math.abs(dy)){
      dragging=true;
      el.style.transform = `translateX(${Math.max(-80, Math.min(80, dx))}px)`;
    }
  });
  el.addEventListener("pointerup", (e)=>{
    const dx = e.clientX - startX;
    el.style.transform = "";
    if(!dragging) return;
    if(dx > 55) markDoneWithScan(id);      // 右→完了（スキャン一致）
    if(dx < -55) markAbsent(id);           // 左→不在
  });
}

function attachDrag(el){
  el.addEventListener("dragstart", ()=>{
    el.classList.add("dragging");
  });
  el.addEventListener("dragend", ()=>{
    el.classList.remove("dragging");
    // drag後にorderを再計算
    const ids = [...document.querySelectorAll(".item")].map(x=>x.dataset.id);
    ids.forEach((id, idx)=>{
      const it = state.items.find(x=>x.id===id);
      if(it) it.order = idx+1;
    });
    save();
    renderList();
  });

  el.addEventListener("dragover", (e)=>{
    e.preventDefault();
    const dragging = document.querySelector(".item.dragging");
    if(!dragging || dragging===el) return;
    const box = $("listBox");
    const items = [...box.querySelectorAll(".item:not(.dragging)")];
    const next = items.find(sib => e.clientY <= sib.getBoundingClientRect().top + sib.offsetHeight/2);
    if(next) box.insertBefore(dragging, next);
    else box.appendChild(dragging);
  });
}

/* ---------- Edit / Status ---------- */
function openEdit(id){
  const it = state.items.find(x=>x.id===id); if(!it) return;
  openModal("荷物編集", `
    <div class="field"><label>荷物番号</label><input id="e_code" value="${escAttr(it.code)}"></div>
    <div class="field"><label>種別</label>
      <select id="e_kind">
        ${["宅配","手紙","ポスト投函","冷蔵・冷凍","代引","大物","壊れ物","書類","医療品","建材"].map(k=>`<option ${k===it.kind?"selected":""}>${k}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>宛名（配達前までに必須）</label><input id="e_name" value="${escAttr(it.name)}"></div>
    <div class="field"><label>住所（配達前までに必須）</label><input id="e_addr" value="${escAttr(it.address)}"></div>
    <div class="field"><label>電話（任意）</label><input id="e_phone" value="${escAttr(it.phone||"")}"></div>
    <div class="field"><label>受渡方法（置き配/手渡し/宅配BOXなど）</label><input id="e_method" value="${escAttr(it.deliveryMethod||"")}"></div>
    <div class="field"><label>メモ（共有）</label><textarea id="e_memo">${esc(it.memo||"")}</textarea></div>
    <div class="field"><label>再配達予定（不在時）</label><input id="e_redel" value="${escAttr(it.redeliveryAt||"")}" placeholder="例）本日 18-20 / 12/18 14:00"></div>
  `,[
    {text:"保存", className:"btn--yellow", onClick:()=>{
      updateItem(id,{
        code:$("e_code").value.trim()||it.code,
        kind:$("e_kind").value,
        name:$("e_name").value.trim(),
        address:$("e_addr").value.trim(),
        phone:$("e_phone").value.trim(),
        deliveryMethod:$("e_method").value.trim(),
        memo:$("e_memo").value.trim(),
        redeliveryAt:$("e_redel").value.trim(),
      });
      // 住所変更ならピン再作成
      geocodeOne(id, true);
      closeModal();
      renderList();
    }},
    {text:"削除", className:"btn--danger", onClick:()=>{
      if(!confirm("削除しますか？")) return;
      state.items = state.items.filter(x=>x.id!==id);
      save(); closeModal(); renderList();
    }},
    {text:"閉じる", className:"btn--ghost", onClick:closeModal},
  ]);
}

function openNav(id){
  const it = state.items.find(x=>x.id===id); if(!it) return;
  if(!it.address){
    alert("住所が未入力です。編集で入れてください。");
    return;
  }
  const url = state.gps
    ? `https://www.google.com/maps/dir/?api=1&origin=${state.gps.lat},${state.gps.lng}&destination=${encodeURIComponent(it.address)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.address)}`;
  window.open(url, "_blank");
}

function markAbsent(id){
  const it = state.items.find(x=>x.id===id); if(!it) return;
  if(!it.name || !it.address){
    alert("配達前までに「宛名・住所」は必須です。編集で入力してください。");
    return;
  }
  openModal("不在登録", `
    <div class="field"><label>再配達予定（任意）</label><input id="a_redel" value="${escAttr(it.redeliveryAt||"")}" placeholder="例）本日 18-20 / 12/18 14:00"></div>
    <div class="field"><label>不在メモ（任意）</label><textarea id="a_note" placeholder="例）インターホン反応なし、置き配不可">${esc(it.memo||"")}</textarea></div>
  `,[
    {text:"不在にする", className:"btn--danger", onClick:()=>{
      it.status="absent";
      it.redeliveryAt = $("a_redel").value.trim();
      it.memo = $("a_note").value.trim();
      it.attempts.push({at:nowStr(), type:"不在", note:it.redeliveryAt||""});
      it.updatedAt = nowStr();
      save(); closeModal(); renderList();
    }},
    {text:"キャンセル", className:"btn--ghost", onClick:closeModal}
  ]);
}

/* ---------- 誤配防止：完了前に一致スキャン ---------- */
async function markDoneWithScan(id){
  // Amazon思想：完了は「確実性」優先
  await scanToMatch(id, true);
}

async function scanToMatch(id, afterMatchMarkDone=false){
  const it = state.items.find(x=>x.id===id); if(!it) return;
  if(!it.name || !it.address){
    alert("配達前までに「宛名・住所」は必須です。編集で入力してください。");
    return;
  }

  openModal("誤配防止スキャン", `
    <div class="hint">完了前に荷物を再スキャンして一致確認します（誤配防止）。</div>
    <div class="videoWrap" id="v2Wrap" style="margin-top:10px">
      <video id="v2" playsinline muted></video>
    </div>
    <div class="small mt8">期待コード：<b>${esc(it.code)}</b></div>
    <div class="small" id="scanOkMsg" style="margin-top:6px">スキャン待ち…</div>
  `,[
    {text:"キャンセル", className:"btn--ghost", onClick:()=>{ stopTempScan(); closeModal(); }},
  ]);

  let tempStream=null;
  let tempTrack=null;
  let ok=false;

  const tempReader = new BrowserMultiFormatReader(hints, 200);

  async function stopTempScan(){
    try{ tempReader.reset(); }catch{}
    if(tempStream) tempStream.getTracks().forEach(t=>t.stop());
    tempStream=null; tempTrack=null;
  }

  try{
    tempStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
    tempTrack = tempStream.getVideoTracks()[0];
    const v = document.getElementById("v2");
    v.srcObject = tempStream;
    await v.play();

    tempReader.decodeFromVideoDevice(null, "v2", (result, err)=>{
      if(result){
        const code = result.getText();
        if(code === it.code){
          ok=true;
          document.getElementById("scanOkMsg").innerHTML = `<span style="color:#16a34a;font-weight:900">一致OK ✅</span>`;
          ping();
          // 完了処理へ
          if(afterMatchMarkDone){
            stopTempScan();
            closeModal();
            finalizeDone(it);
          }
        }else{
          document.getElementById("scanOkMsg").innerHTML = `<span style="color:#ef4444;font-weight:900">不一致 ❌</span> 読んだ：${esc(code)}`;
          ping(0.02);
        }
      }else if(err && !(err instanceof NotFoundException)){
        document.getElementById("scanOkMsg").textContent = "読み取りが不安定：距離/角度/明るさ調整";
      }
    });

  }catch{
    alert("カメラ起動に失敗。Safariのカメラ許可を確認してください。");
  }

  // 置き配/手渡し選択（完了時）
  if(afterMatchMarkDone){
    // finalizeDone内で聞く
  }
}

function finalizeDone(it){
  openModal("完了登録", `
    <div class="field"><label>受渡方法（必須推奨）</label>
      <select id="d_method">
        <option value="">未選択</option>
        <option ${it.deliveryMethod==="手渡し"?"selected":""}>手渡し</option>
        <option ${it.deliveryMethod==="置き配"?"selected":""}>置き配</option>
        <option ${it.deliveryMethod==="宅配BOX"?"selected":""}>宅配BOX</option>
        <option ${it.deliveryMethod==="玄関前"?"selected":""}>玄関前</option>
        <option ${it.deliveryMethod==="管理人預け"?"selected":""}>管理人預け</option>
      </select>
    </div>
    <div class="field"><label>完了メモ（任意）</label><textarea id="d_note" placeholder="例）玄関前に置き配、写真撮影済み">${esc(it.memo||"")}</textarea></div>
  `,[
    {text:"完了にする", className:"btn--yellow", onClick:()=>{
      it.status="done";
      it.deliveryMethod = $("d_method").value || it.deliveryMethod;
      it.memo = $("d_note").value.trim();
      it.attempts.push({at:nowStr(), type:"完了", note:it.deliveryMethod||""});
      it.updatedAt = nowStr();
      save(); closeModal(); renderList();
    }},
    {text:"キャンセル", className:"btn--ghost", onClick:closeModal}
  ]);
}

/* ---------- Geocode (address -> lat/lng) ---------- */
async function geocodeOne(id, auto=false){
  const it = state.items.find(x=>x.id===id); if(!it || !it.address) return;
  try{
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(it.address)}`;
    const res = await fetch(url, {headers:{Accept:"application/json"}});
    const js = await res.json();
    if(!js || !js[0]) return;
    it.lat = parseFloat(js[0].lat);
    it.lng = parseFloat(js[0].lon);
    it.updatedAt = nowStr();
    save();
    if(auto) renderList();
  }catch{}
}

async function batchGeocode(){
  const targets = state.items
    .filter(x=>x.address && !(Number.isFinite(x.lat)&&Number.isFinite(x.lng)))
    .slice(0, 12);
  if(!targets.length){
    alert("未ピンの住所がありません。");
    return;
  }
  alert(`ピン化します：${targets.length}件（順に処理）`);
  for(const it of targets){
    await geocodeOne(it.id, false);
    await sleep(900); // 連投しない（重要）
  }
  renderList();
}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

/* ---------- Report ---------- */
function renderReport(){
  const done = state.items.filter(x=>x.status==="done");
  const absent = state.items.filter(x=>x.status==="absent");
  const todo = state.items.filter(x=>x.status==="todo");

  const total = state.items.length;
  const html = `
    <div class="hint">
      本日実績（ローカル集計）：
      総数 <b>${total}</b> / 完了 <b>${done.length}</b> / 不在 <b>${absent.length}</b> / 未配達 <b>${todo.length}</b>
    </div>

    <div class="report">
      <table>
        <thead><tr>
          <th>ステータス</th><th>荷物番号</th><th>種別</th><th>宛名</th><th>住所</th><th>受渡</th><th>再配達</th><th>更新</th>
        </tr></thead>
        <tbody>
          ${state.items.map(x=>`
            <tr>
              <td>${x.status}</td>
              <td>${esc(x.code)}</td>
              <td>${esc(x.kind)}</td>
              <td>${esc(x.name)}</td>
              <td>${esc(x.address)}</td>
              <td>${esc(x.deliveryMethod||"")}</td>
              <td>${esc(x.redeliveryAt||"")}</td>
              <td>${esc(x.updatedAt||"")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  $("reportBox").innerHTML = html;
}

function exportCSV(){
  const header = ["id","code","kind","name","address","phone","status","deliveryMethod","redeliveryAt","memo","lat","lng","createdAt","updatedAt"];
  const rows = state.items.map(x=>[
    x.id,x.code,x.kind,x.name,x.address,x.phone||"",x.status,
    x.deliveryMethod||"",x.redeliveryAt||"",x.memo||"",
    Number.isFinite(x.lat)?x.lat:"",Number.isFinite(x.lng)?x.lng:"",
    x.createdAt||"",x.updatedAt||""
  ]);
  const csv = [header,...rows].map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ofa_delivery_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function clearDone(){
  if(!confirm("完了を削除します（未配達/不在は残る）")) return;
  state.items = state.items.filter(x=>x.status!=="done");
  save();
  renderList();
  renderReport();
}

/* ---------- UI helpers ---------- */
function setChip(id, text, ok){
  const el = $(id);
  el.textContent = text;
  el.style.color = ok ? "#0f172a" : "#64748b";
}
function esc(s){
  return String(s??"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function escAttr(s){ return esc(s); }

/* ---------- Init ---------- */
renderList();

/* leave page -> stop scan */
window.addEventListener("beforeunload", stopScan);
