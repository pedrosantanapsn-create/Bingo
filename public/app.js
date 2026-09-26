// Funções compartilhadas pelas páginas
window.Bingo = (() => {
  const $ = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      if (attrs[k] === null || attrs[k] === false || attrs[k] === undefined) continue;
      if (k === "class") el.className = attrs[k];
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), attrs[k]);
      else if (k === "hidden") el.hidden = !!attrs[k];
      else if (k === "value") el.value = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const toastEl = document.createElement("div");
  toastEl.className = "toast"; toastEl.hidden = true; document.body.append(toastEl);
  let tt;
  const toast = (msg) => { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(tt); tt = setTimeout(() => (toastEl.hidden = true), 2800); };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem("bingo:" + k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem("bingo:" + k, JSON.stringify(v)); } catch {} },
  };
  async function api(method, url, body, hostToken) {
    const r = await fetch(url, {
      method, headers: Object.assign({ "Content-Type": "application/json" }, hostToken ? { "x-host-token": hostToken } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Erro " + r.status);
    return data;
  }
  function fileToThumb(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 240, s = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas"); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url); resolve(cv.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Arquivo não é uma imagem válida.")); };
      img.src = url;
    });
  }
  function checkPattern(cells, grid, pattern, drawnSet) {
    const hit = cells.map((c) => c === null || drawnSet.has(c));
    if (pattern === "full") return hit.every(Boolean) ? "Cartela cheia" : null;
    for (let r = 0; r < grid; r++) if (hit.slice(r * grid, r * grid + grid).every(Boolean)) return "Linha " + (r + 1);
    for (let c = 0; c < grid; c++) { let ok = true; for (let r = 0; r < grid; r++) if (!hit[r * grid + c]) { ok = false; break; } if (ok) return "Coluna " + (c + 1); }
    let d1 = true, d2 = true;
    for (let i = 0; i < grid; i++) { if (!hit[i * grid + i]) d1 = false; if (!hit[i * grid + (grid - 1 - i)]) d2 = false; }
    return d1 || d2 ? "Diagonal" : null;
  }
  const hits = (cells, drawnSet) => cells.filter((c) => c === null || drawnSet.has(c)).length;
  function board(card, grid, byId, drawnSet) {
    const b = $("div", { class: "board", style: "grid-template-columns:repeat(" + grid + ",1fr)" });
    card.cells.forEach((cid) => {
      if (cid === null) { b.append($("div", { class: "cell free hit" }, "LIVRE")); return; }
      const it = byId[cid];
      const cell = $("div", { class: "cell" + (drawnSet.has(cid) ? " hit" : "") });
      if (it) cell.append($("img", { src: it.img, alt: it.name }), $("div", { class: "cap" }, it.name));
      b.append(cell);
    });
    return b;
  }
  function history(draws, byId) {
    return $("div", { class: "history" }, ...draws.slice().reverse().map((id) => (byId[id] ? $("img", { src: byId[id].img, alt: byId[id].name, title: byId[id].name }) : null)));
  }
  function stage(last, sub, extra) {
    return $("div", { class: "stage" },
      last && last.img ? $("img", { src: last.img, alt: last.name }) : $("div", { class: "empty" }, extra || "Nada sorteado"),
      $("div", { class: "name" }, last ? last.name : "—"),
      $("div", { class: "count" }, sub));
  }
  // acompanha o jogo em tempo real; carrega as imagens só quando mudam
  function watch(code, onState) {
    let itemsVersion = -1, images = {};
    const socket = io();
    const deliver = async (state) => {
      if (state.itemsVersion !== itemsVersion) {
        try { const r = await api("GET", "/api/games/" + code + "/items"); itemsVersion = r.itemsVersion; images = {}; for (const it of r.items) images[it.id] = it; } catch {}
      }
      onState(state, images);
    };
    socket.on("connect", () => socket.emit("watch", code));
    socket.on("state", deliver);
    socket.on("gone", () => onState(null, {}));
    return socket;
  }
  const fmt = (iso) => { try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  const statusLabel = (s) => (s === "playing" ? "Em andamento" : s === "setup" ? "Em preparação" : "Encerrado");
  return { $, toast, store, api, fileToThumb, checkPattern, hits, board, history, stage, watch, fmt, statusLabel };
})();
