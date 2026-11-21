/* rmm-calibrate-card: stand on a spot, tap "I'm here", fit an LD2450's RMM layout.
 * MIT licence. https://github.com/baes-cloud/ha-rmm-calibrate
 * Config:
 *   type: custom:rmm-calibrate-card
 *   image: /local/images/floorplan.png      # same image your radar-map-card uses
 *   map_group: default
 *   radars:                                  # optional; omit to list every RMM radar
 *     - name: ld2450_tracker                 # RMM radar_name
 *       label: Bedroom
 *       presence_entity: binary_sensor.ld2450_tracker_presence   # optional, for the online check
 *       spots: [{x: 5.9, y: 86.2, t: "Window corner", d: "Half a metre out from both walls."}]
 *       monitor: [[0,47],[43,47],[43,97],[0,97]]   # optional "Limit to its rooms" polygon
 *       ceiling: false                       # true for a ceiling radar (draws the light, not a fan)
 *       light: [62.5, 23]                    # ceiling radar position, map %
 *       note: "Shown above the spot list"
 *       undo_layout: {origin_x: ..., ...}    # optional; otherwise the first layout the card saw
 * Spots: x/y in map % (0-100 of the floorplan image), t title, d description, check: true = not used in the fit.
 */
(() => {
const VERSION = "2.0.0";

// RMM transform, copied from fusion_engine._calculate_standard_coord (radar_type 2).
function project(layout, xmm, ymm) {
  let xm = xmm / 1000, ym = ymm / 1000;
  if (layout.mirror_x) xm = -xm;
  const b = ((+layout.rotation || 0) - 90) * Math.PI / 180;
  const yvx = Math.cos(b), yvy = Math.sin(b);
  const xvx = Math.cos(b + Math.PI / 2), xvy = Math.sin(b + Math.PI / 2);
  const sx = +layout.scale_x || 5, sy = +layout.scale_y || 5;
  return [(+layout.origin_x || 50) + xm * sx * xvx + ym * sy * yvx,
          (+layout.origin_y || 50) + xm * sx * xvy + ym * sy * yvy];
}

// Solve least squares A p = B (normal equations, Gaussian elimination).
function lsq(A, B) {
  const n = A[0].length, M = [];
  for (let i = 0; i < n; i++) {
    M.push(new Array(n + 1).fill(0));
    for (let k = 0; k < A.length; k++) {
      for (let j = 0; j < n; j++) M[i][j] += A[k][i] * A[k][j];
      M[i][n] += A[k][i] * B[k];
    }
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Fit origin, rotation, scale_x/y and mirror from spots {rx, ry (mm), mx, my (map %)}.
function fitLayout(points, mapSX, mapSY) {
  if (points.length < 3) return null;
  let best = null;
  const tryRot = (mir, r) => {
    const b = (r - 90) * Math.PI / 180;
    const yvx = Math.cos(b), yvy = Math.sin(b), xvx = Math.cos(b + Math.PI / 2), xvy = Math.sin(b + Math.PI / 2);
    const A = [], B = [];
    for (const p of points) {
      const xm = (mir ? -1 : 1) * p.rx / 1000, ym = p.ry / 1000;
      A.push([1, 0, xm * xvx, ym * yvx]); B.push(p.mx);
      A.push([0, 1, xm * xvy, ym * yvy]); B.push(p.my);
    }
    const s = lsq(A, B);
    if (!s) return;
    const [ox, oy, sx, sy] = s;
    if (!(sx > 0.5 && sy > 0.5)) return;
    const lay = { origin_x: ox, origin_y: oy, scale_x: sx, scale_y: sy, rotation: r, mirror_x: mir };
    let se = 0;
    const errs = points.map(p => {
      const [x, y] = project(lay, p.rx, p.ry);
      const e = Math.hypot((x - p.mx) / mapSX, (y - p.my) / mapSY);
      se += e * e; return e;
    });
    const rms = Math.sqrt(se / points.length);
    if (!best || rms < best.rms) best = { layout: lay, rms, errs };
  };
  for (const mir of [false, true]) for (let r = 0; r < 360; r += 1) tryRot(mir, r);
  if (!best) return null;
  const m = best.layout.mirror_x, r0 = best.layout.rotation;
  for (let r = r0 - 1; r <= r0 + 1.0001; r += 0.1) tryRot(m, (Math.round(r * 10) / 10 + 360) % 360);
  return best;
}

// Radars come from the card config (see README). Without config, every radar RMM knows is listed
// with no preset spots; tap anywhere on the plan to use your own spot.
const DAY = { bg: "#B3CCC2", surface: "#FFFFFF", raised: "#E3ECE8", line: "#9DB8AD", ink: "#121E24", mute: "#33444A",
  accent: "#1F4F48", onAccent: "#FFFFFF", rose: "#7A2E43", blush: "#E3ACA4", sea: "#5E948C", apple: "#D8DC8A", warn: "#574805", bad: "#8E1F31", harbour: "#2A4F5F" };
const NIGHT = { bg: "#1E2326", surface: "#293034", raised: "#333B40", line: "#3F494E", ink: "#EDF2EF", mute: "#A7B4B1",
  accent: "#8CBDB5", onAccent: "#12201E", rose: "#EAC3BD", blush: "#E6BCB6", sea: "#8CBDB5", apple: "#D3D69A", warn: "#F5D76E", bad: "#FF9AA5", harbour: "#8FB3C2" };

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

class RmmCalibrateCard extends HTMLElement {
  setConfig(c) {
    this.cfg = Object.assign({ image: "/local/images/floorplan_cropped.png", map_group: "default" }, c || {});
    this.radar = ls.get("rmmcal_radar", null);
    this.points = ls.get("rmmcal_points", {});
    this.R = {};
    for (const r of (this.cfg.radars || [])) {
      this.R[r.name] = Object.assign({ label: r.name, spots: [] }, r);
      this.R[r.name].spots = (r.spots || []).map((sp, i) => Object.assign({ n: i + 1 }, sp));
    }
    this.auto = !Object.keys(this.R).length;
    this.sel = null; this.fit = null; this.capture = null; this.msg = ""; this.rmm = null;
  }
  getCardSize() { return 14; }
  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) { this._build(); this._subscribe(); }
    const dark = !!(h.themes && h.themes.darkMode);
    if (dark !== this._dark) { this._dark = dark; this._theme(); }
  }
  disconnectedCallback() { if (this._unsub) { this._unsub.then(u => u && u()).catch(() => {}); this._unsub = null; } }
  connectedCallback() { if (this._hass && !this._unsub) this._subscribe(); }

  _subscribe() {
    this._unsub = this._hass.connection.subscribeMessage(ev => this._onStream(ev), { type: "rmm/stream" });
    this._unsub.catch(e => { this.msg = "Could not open rmm/stream: " + (e.message || e); this._render(); });
  }
  _onStream(ev) {
    const d = (ev && ev.data) ? ev.data : ev;
    if (!d || !d.radars) return;
    this.rmm = d;
    for (const [name, r] of Object.entries(d.radars)) {
      if (this.auto && !this.R[name]) this.R[name] = { name, label: name, spots: [] };
      if (r.layout && !ls.get("rmmcal_orig_" + name, null)) ls.set("rmmcal_orig_" + name, r.layout);
    }
    const now = Date.now();
    if (this.capture) {
      const r = d.radars[this.capture.radar];
      for (const t of (r && r.targets) || []) {
        if (t.is_1d || (Math.abs(t.x) < 100 && Math.abs(t.y) < 100)) continue;
        this.capture.samples.push({ i: t.i, x: t.x, y: t.y });
      }
      this.capture.frames++;
      if (now >= this.capture.until) this._finishCapture();
    }
    if (!this._last || now - this._last > 250) { this._last = now; this._render(); }
  }
  _undoLayout() {
    const R = this.R[this.radar] || {};
    return R.undo_layout || ls.get("rmmcal_orig_" + this.radar, null);
  }
  _mapScale() {
    const c = (((this.rmm || {}).maps || {})[this.cfg.map_group] || {}).config || {};
    return [+c.map_scale_x || 10.37, +c.map_scale_y || 12.0];
  }
  _layout() {
    const r = ((this.rmm || {}).radars || {})[this.radar];
    return r ? r.layout : null;
  }
  _liveTargets() {
    const r = ((this.rmm || {}).radars || {})[this.radar];
    return ((r && r.targets) || []).filter(t => !t.is_1d && !(Math.abs(t.x) < 100 && Math.abs(t.y) < 100));
  }

  _build() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
<style>
:host{display:block}
.card{background:var(--c-surface);color:var(--c-ink);border-radius:16px;padding:16px;font-family:Manrope,system-ui,sans-serif;font-size:15px;line-height:1.4}
h2{font-weight:800;letter-spacing:-.02em;margin:0 0 4px;font-size:22px}
.sub{color:var(--c-mute);font-size:13px;margin-bottom:12px}
.chips{display:flex;gap:8px;margin-bottom:10px}
.chip{flex:1;border:1.5px solid var(--c-line);background:var(--c-raised);color:var(--c-ink);border-radius:999px;padding:10px 0;font:700 15px Manrope,sans-serif;cursor:pointer}
.chip.on{background:var(--c-accent);color:var(--c-onAccent);border-color:var(--c-accent)}
.status{font-size:13px;color:var(--c-mute);margin:4px 0 10px;min-height:18px}
.status b{color:var(--c-ink)}
.map{position:relative;width:100%;aspect-ratio:1/1;border-radius:12px;overflow:hidden;background:var(--c-raised);touch-action:manipulation}
.map img{position:absolute;inset:0;width:100%;height:100%;opacity:.85}
.map svg{position:absolute;inset:0;width:100%;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--c-mute);margin:8px 0 12px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.spot{background:var(--c-raised);border-radius:12px;padding:12px;margin-bottom:10px}
.spot .t{font-weight:800}
.spot .d{color:var(--c-mute);font-size:13px}
button.big{width:100%;border:0;border-radius:12px;padding:16px;font:800 18px Manrope,sans-serif;background:var(--c-accent);color:var(--c-onAccent);cursor:pointer;margin-top:10px}
button.big:disabled{opacity:.45}
button.sec{border:1.5px solid var(--c-line);background:transparent;color:var(--c-ink);border-radius:10px;padding:10px 12px;font:700 14px Manrope,sans-serif;cursor:pointer}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.row>button{flex:1}
ol{padding-left:0;margin:6px 0;list-style:none}
li{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--c-line);font-size:14px}
li .n{width:24px;height:24px;border-radius:50%;background:var(--c-accent);color:var(--c-onAccent);display:grid;place-items:center;font-weight:800;font-size:12px;flex:none}
li .x{margin-left:auto;background:none;border:0;color:var(--c-mute);font-size:20px;cursor:pointer;padding:0 6px}
.res{background:var(--c-raised);border-radius:12px;padding:12px;margin-top:10px;font-size:14px}
.res .num{font-family:Syne,Manrope,sans-serif;font-size:30px;font-weight:700}
.ok{color:var(--c-accent)} .warn{color:var(--c-warn)} .bad{color:var(--c-bad)}
.msg{margin-top:10px;font-size:13px}
h3{font-size:16px;font-weight:800;margin:16px 0 4px}
.foot{font-size:12px;color:var(--c-mute);margin-top:14px}
</style>
<div class="card">
  <h2>Radar setup</h2>
  <div class="sub">Pick a radar, tap a numbered spot, stand there, tap <b>I'm here</b>. Four spots or more, then fit and apply.</div>
  <div class="chips" id="chips"></div>
  <div class="status" id="status"></div>
  <div class="map" id="map"><img id="img" alt="Floorplan"><svg id="svg" viewBox="0 0 100 100" preserveAspectRatio="none"></svg></div>
  <div class="legend">
    <span><i style="background:var(--c-mute)"></i>you, as RMM sees you now</span>
    <span><i style="background:var(--c-rose)"></i>you, with the new fit</span>
    <span><i style="border:2px solid var(--c-accent);box-sizing:border-box"></i>spot to stand on</span>
  </div>
  <div class="spot" id="spot"></div>
  <button class="big" id="here">I'm here</button>
  <h3>Captured spots</h3>
  <ol id="list"></ol>
  <div id="fit"></div>
  <h3 id="monh">Keep each radar to its rooms</h3>
  <div class="sub" id="monsub"></div>
  <div class="row"><button class="sec" id="mon">Limit to its rooms</button><button class="sec" id="monclr">Remove limit</button></div>
  <div class="msg" id="msg"></div>
  <div class="foot">rmm-calibrate-card ${VERSION}. Undo puts back the layout from before you calibrated. Take an RMM backup first anyway.</div>
</div>`;
    const $ = id => this.shadowRoot.getElementById(id);
    this.$ = $;
    $("img").src = this.cfg.image;
    $("svg").addEventListener("click", e => this._tapMap(e));
    $("here").addEventListener("click", () => this._startCapture());
    $("mon").addEventListener("click", () => this._monitor(true));
    $("monclr").addEventListener("click", () => this._monitor(false));
    this._theme();
    this._render();
  }
  _theme() {
    if (!this.shadowRoot) return;
    const p = this._dark ? NIGHT : DAY;
    const host = this.shadowRoot.host;
    for (const [k, v] of Object.entries(p)) host.style.setProperty("--c-" + k, v);
  }
  _save() { ls.set("rmmcal_points", this.points); ls.set("rmmcal_radar", this.radar); }

  _tapMap(e) {
    if (this.capture) return;
    const svg = this.$("svg"), r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
    const spots = this.R[this.radar].spots;
    let near = null, nd = 4;
    for (const s of spots) { const d = Math.hypot(s.x - x, s.y - y); if (d < nd) { nd = d; near = s; } }
    if (near && (!this.sel || this.sel.n !== near.n)) this.sel = Object.assign({}, near);
    else this.sel = Object.assign({}, this.sel || { n: 0, t: "Your own spot", d: "Stand exactly where you tapped." }, { x: +x.toFixed(2), y: +y.toFixed(2) });
    this._render();
  }
  _startCapture() {
    if (!this.sel || this.capture) return;
    if (!this._liveTargets().length) { this.msg = "The radar sees nobody right now. Check it is online and you are in front of it, then try again."; this._render(); return; }
    this.capture = { radar: this.radar, spot: Object.assign({}, this.sel), samples: [], frames: 0, until: Date.now() + 5000 };
    this.msg = "";
    this._tick = setInterval(() => { if (this.capture && Date.now() >= this.capture.until) this._finishCapture(); this._render(); }, 250);
    this._render();
  }
  _finishCapture() {
    const c = this.capture; this.capture = null; clearInterval(this._tick);
    if (!c) return;
    // cluster samples: pick the biggest group within 400 mm of its median
    const med = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    let best = [];
    for (const seed of c.samples) {
      const g = c.samples.filter(s => Math.hypot(s.x - seed.x, s.y - seed.y) < 400);
      if (g.length > best.length) best = g;
    }
    if (best.length < 4) { this.msg = `Only ${best.length} steady readings in 5 seconds. Sway gently on the spot (radars lose people who are dead still) and try again.`; this._render(); return; }
    const rx = med(best.map(s => s.x)), ry = med(best.map(s => s.y));
    const spread = Math.round(Math.sqrt(best.reduce((a, s) => a + (s.x - rx) ** 2 + (s.y - ry) ** 2, 0) / best.length));
    const others = c.samples.length - best.length;
    const list = this.points[c.radar] || (this.points[c.radar] = []);
    const i = list.findIndex(p => p.n && p.n === c.spot.n);
    const pt = { check: !!c.spot.check, n: c.spot.n, t: c.spot.t, mx: c.spot.x, my: c.spot.y, rx: Math.round(rx), ry: Math.round(ry), k: best.length, spread };
    if (i >= 0) list[i] = pt; else list.push(pt);
    this.msg = `Got it: ${best.length} readings, ±${spread} mm.` + (others > 3 ? ` (${others} readings from someone or something else; keep others out of view.)` : "");
    const nextSpot = this.R[c.radar].spots.find(s => !list.some(p => p.n === s.n));
    this.sel = nextSpot ? Object.assign({}, nextSpot) : null;
    this._save(); this._refit(); this._render();
  }
  _refit() {
    const [sx, sy] = this._mapScale();
    const pts = this.points[this.radar] || [];
    this.fit = fitLayout(pts.filter(p => !p.check), sx, sy);
  }
  async _apply() {
    if (!this.fit) return;
    const cur = this._layout() || this._undoLayout();
    const f = this.fit.layout, r2 = v => Math.round(v * 100) / 100;
    const layout = Object.assign({}, cur, {
      origin_x: r2(f.origin_x), origin_y: r2(f.origin_y), scale_x: r2(f.scale_x), scale_y: r2(f.scale_y),
      rotation: r2(f.rotation), mirror_x: !!f.mirror_x, radar_type: 2,
    });
    const h = parseFloat(this.$("height") && this.$("height").value);
    if (h > 0.5 && h < 3) layout.mount_height = h;
    try {
      await this._hass.callService("radar_map_manager", "update_radar_layout", { radar_name: this.radar, layout });
      this.msg = "Applied. Walk around: the grey dot (RMM) should now sit on top of the rose dot and follow you.";
    } catch (e) { this.msg = "Apply failed: " + (e.message || e); }
    this._render();
  }
  async _undo() {
    const undo = this._undoLayout();
    if (!undo) { this.msg = "No saved layout to go back to."; this._render(); return; }
    if (!confirm(`Put the ${this.R[this.radar].label} radar back to the layout it had before calibrating?`)) return;
    try {
      await this._hass.callService("radar_map_manager", "update_radar_layout", { radar_name: this.radar, layout: undo });
      this.msg = "Restored the before-move layout.";
    } catch (e) { this.msg = "Undo failed: " + (e.message || e); }
    this._render();
  }
  async _monitor(on) {
    const R = this.R[this.radar];
    if (!R.monitor && on) return;
    const zones = { monitor_zones: on ? [{ name: R.label + " only", points: R.monitor }] : [] };
    try {
      await this._hass.callService("radar_map_manager", "update_radar_layout", { radar_name: this.radar, layout: this._layout() || this._undoLayout(), zones });
      this.msg = on ? `${R.label} radar now only reports people inside its outlined rooms.` : `${R.label} radar limit removed.`;
    } catch (e) { this.msg = "Failed: " + (e.message || e); }
    this._render();
  }

  _render() {
    if (!this.shadowRoot || !this.$) return;
    if (!this.R[this.radar]) { const k = Object.keys(this.R)[0]; if (!k) { if (this.$) this.$("status").textContent = "Connecting to Radar Map Manager…"; return; } this.radar = k; }
    const $ = this.$, R = this.R[this.radar], lay = this._layout(), live = this._liveTargets();
    // chips
    $("chips").innerHTML = Object.entries(this.R).map(([k, v]) => `<button class="chip ${k === this.radar ? "on" : ""}" data-r="${k}">${v.label}</button>`).join("");
    $("chips").querySelectorAll("button").forEach(b => b.onclick = () => {
      if (this.capture) return;
      this.radar = b.dataset.r; this.sel = null; this.msg = ""; this._save(); this._refit(); this._render();
    });
    // status
    const st = this._hass && this._hass.states[R.presence_entity || `binary_sensor.${this.radar}_presence`];
    const online = st ? !["unavailable", "unknown"].includes(st.state) : !!(this.rmm && this.rmm.radars && this.rmm.radars[this.radar]);
    let s;
    if (!this.rmm) s = "Connecting to Radar Map Manager…";
    else if (!online) s = `<b class="bad">${R.label} radar is offline</b> ${R.ip ? `(${R.ip})` : ""}. Plug it in and wait for it to reconnect.`;
    else if (!live.length) s = `<b>${R.label} radar online</b>, sees nobody.`;
    else s = `<b>${R.label} radar online</b>, sees ${live.length}: ` + live.map(t => `${Math.round(t.x)}, ${Math.round(t.y)} mm`).join(" · ");
    if (this.capture) s = `<b>Hold still-ish…</b> ${Math.max(0, Math.ceil((this.capture.until - Date.now()) / 1000))} s, ${this.capture.samples.length} readings`;
    $("status").innerHTML = s;
    // svg
    const pts = this.points[this.radar] || [];
    const [msx, msy] = this._mapScale();
    let g = "";
    const zones = (((this.rmm || {}).maps || {})[this.cfg.map_group] || {}).zones || {};
    for (const z of zones.include_zones || []) g += `<polygon points="${z.points.map(p => p.join(",")).join(" ")}" fill="none" stroke="var(--c-harbour)" stroke-width=".25" stroke-dasharray="1 .8" opacity=".7"/>`;
    if (R.monitor) g += `<polygon points="${R.monitor.map(p => p.join(",")).join(" ")}" fill="var(--c-sea)" fill-opacity=".10" stroke="var(--c-sea)" stroke-width=".35"/>`;
    // radar position + fan (current layout, or fit if present)
    const fanLay = this.fit ? this.fit.layout : lay;
    if (R.ceiling) {
      g += `<circle cx="${R.light[0]}" cy="${R.light[1]}" r="2.2" fill="var(--c-accent)"/><circle cx="${R.light[0]}" cy="${R.light[1]}" r="4" fill="none" stroke="var(--c-accent)" stroke-width=".4"/>`;
    } else if (fanLay) {
      const o = project(fanLay, 0, 0), L = project(fanLay, -3464, 2000), Rr = project(fanLay, 3464, 2000), F = project(fanLay, 0, 4000);
      g += `<path d="M${o[0]},${o[1]} L${L[0]},${L[1]} Q${F[0]},${F[1]} ${Rr[0]},${Rr[1]} Z" fill="var(--c-accent)" fill-opacity=".07" stroke="var(--c-accent)" stroke-width=".3" stroke-opacity=".5"/>`;
      g += `<rect x="${o[0] - 1.3}" y="${o[1] - 1.3}" width="2.6" height="2.6" rx=".6" fill="var(--c-accent)"/>`;
    }
    // suggested spots
    for (const sp of R.spots) {
      const done = pts.some(p => p.n === sp.n), on = this.sel && this.sel.n === sp.n;
      const x = on ? this.sel.x : sp.x, y = on ? this.sel.y : sp.y;
      g += `<circle cx="${x}" cy="${y}" r="${on ? 3.4 : 2.6}" fill="${done ? "var(--c-accent)" : "var(--c-surface)"}" fill-opacity="${done ? 1 : .85}" stroke="var(--c-accent)" stroke-width="${on ? .9 : .5}"/>`;
      g += `<text x="${x}" y="${y + 1.1}" text-anchor="middle" font-size="3" font-weight="800" font-family="Manrope,sans-serif" fill="${done ? "var(--c-onAccent)" : "var(--c-accent)"}">${sp.n}</text>`;
    }
    if (this.sel && this.sel.n === 0) g += `<circle cx="${this.sel.x}" cy="${this.sel.y}" r="3" fill="none" stroke="var(--c-accent)" stroke-width=".9"/><path d="M${this.sel.x - 4},${this.sel.y}h8M${this.sel.x},${this.sel.y - 4}v8" stroke="var(--c-accent)" stroke-width=".4"/>`;
    // fit residuals
    const errLay = this.fit ? this.fit.layout : lay;
    if (errLay) pts.forEach(p => {
      const [x, y] = project(errLay, p.rx, p.ry);
      g += `<line x1="${p.mx}" y1="${p.my}" x2="${x}" y2="${y}" stroke="var(--c-rose)" stroke-width=".4"/><circle cx="${x}" cy="${y}" r=".8" fill="var(--c-rose)"/>`;
    });
    // live targets
    for (const t of live) {
      if (lay) { const [x, y] = project(lay, t.x, t.y); g += `<circle cx="${x}" cy="${y}" r="1.8" fill="var(--c-mute)" stroke="var(--c-surface)" stroke-width=".4"/>`; }
      if (this.fit) { const [x, y] = project(this.fit.layout, t.x, t.y); g += `<circle cx="${x}" cy="${y}" r="1.8" fill="var(--c-rose)" stroke="var(--c-surface)" stroke-width=".4"/>`; }
    }
    $("svg").innerHTML = g;
    // spot panel
    $("spot").innerHTML = (R.note ? `<div class="d" style="margin-bottom:6px">${R.note}</div>` : "") + (this.sel
      ? `<div class="t">${this.sel.n ? this.sel.n + ". " : ""}${this.sel.t}</div><div class="d">${this.sel.d} Tap elsewhere on the plan to move the spot if the plan is off.</div>`
      : (R.spots.length && pts.length >= R.spots.length ? `<div class="t">All spots captured</div><div class="d">Check the fit below. You can redo any spot by tapping its number.</div>` : `<div class="t">Tap a numbered spot on the plan</div><div class="d">Or tap anywhere to use your own spot. Only you in the room, please.</div>`));
    const here = $("here");
    here.disabled = !this.sel || !!this.capture || !online;
    here.textContent = this.capture ? "Listening…" : "I'm here";
    // list
    $("list").innerHTML = pts.length ? pts.map((p, i) => `<li><span class="n">${p.n || "•"}</span><span>${p.t}<br><small style="color:var(--c-mute)">${p.k} readings · ±${p.spread} mm${errLay ? ` · ${p.check ? "check: " : ""}off by ${(Math.hypot((project(errLay, p.rx, p.ry)[0] - p.mx) / msx, (project(errLay, p.rx, p.ry)[1] - p.my) / msy) * 100).toFixed(0)} cm` : ""}</small></span><button class="x" data-i="${i}" aria-label="Remove">×</button></li>`).join("") : `<li style="color:var(--c-mute)">None yet.</li>`;
    $("list").querySelectorAll("button.x").forEach(b => b.onclick = () => { pts.splice(+b.dataset.i, 1); this._save(); this._refit(); this._render(); });
    // fit panel
    let fh = "";
    if (this.fit) {
      const f = this.fit.layout, cm = this.fit.rms * 100;
      const cls = cm < 25 ? "ok" : cm < 50 ? "warn" : "bad";
      const ratio = Math.max(f.scale_x, f.scale_y) / Math.min(f.scale_x, f.scale_y);
      const keepH = this.$("height") ? this.$("height").value : ((lay && lay.mount_height) || 1.5);
      fh = `<div class="res"><div>Average miss</div><div class="num ${cls}">${cm.toFixed(0)} cm</div>
        <div style="color:var(--c-mute)">${cm < 25 ? "Good. Apply it." : cm < 50 ? "OK. A redo of the worst spot may help." : "Poor. Remove the worst spot or recapture it."}${pts.length < 4 ? " Add one more spot for a safer fit." : ""}${ratio > 1.8 ? ' <span class="warn">Scales differ a lot: check the board is upright, not sideways.</span>' : ""}</div>
        <div style="margin-top:8px;font-size:13px">rotation ${f.rotation.toFixed(1)}° · scale ${f.scale_x.toFixed(2)} / ${f.scale_y.toFixed(2)} · origin ${f.origin_x.toFixed(1)}, ${f.origin_y.toFixed(1)}${f.mirror_x ? " · mirrored" : ""}</div>
        <div style="font-size:13px;color:var(--c-mute)">now: ${lay ? `rotation ${(+lay.rotation).toFixed(1)}° · scale ${(+lay.scale_x).toFixed(2)} / ${(+lay.scale_y).toFixed(2)} · origin ${(+lay.origin_x).toFixed(1)}, ${(+lay.origin_y).toFixed(1)}${lay.mirror_x ? " · mirrored" : ""}` : "?"}</div>
        <label style="display:block;margin-top:8px;font-size:13px">Board height (m) <input id="height" type="number" step="0.05" min="0.5" max="3" value="${keepH}" style="width:70px;font:inherit"></label>
        <div class="row"><button class="big" id="apply" style="margin-top:6px">Apply to RMM</button></div>
        <div class="row"><button class="sec" id="undo">Undo</button><button class="sec" id="clear">Clear spots</button></div></div>`;
    } else if (pts.length) {
      fh = `<div class="res" style="color:var(--c-mute)">${pts.length < 3 ? `Need ${3 - pts.length} more spot${3 - pts.length > 1 ? "s" : ""} to fit.` : "No sensible fit yet: recapture the spot that looks off."}<div class="row"><button class="sec" id="undo">Undo</button><button class="sec" id="clear">Clear spots</button></div></div>`;
    }
    if (this._fitHtml !== fh) {
      $("fit").innerHTML = fh; this._fitHtml = fh;
      const a = $("apply"); if (a) a.onclick = () => this._apply();
      const u = $("undo"); if (u) u.onclick = () => this._undo();
      const c = $("clear"); if (c) c.onclick = () => { if (confirm("Clear captured spots for this radar?")) { this.points[this.radar] = []; this.fit = null; this._save(); this._render(); } };
    }
    $("mon").parentElement.hidden = !R.monitor; $("monsub").hidden = !R.monitor; this.shadowRoot.getElementById("monh").hidden = !R.monitor;
    const monOn = ((((this.rmm || {}).radars || {})[this.radar] || {}).monitor_zones || []).length > 0;
    $("monsub").textContent = `${R.label} radar: green outline. Stops it double-counting people the other radar owns.` + (monOn ? " Limit is ON." : " Limit is off.");
    $("msg").textContent = this.msg;
  }
}
if (!customElements.get("rmm-calibrate-card")) customElements.define("rmm-calibrate-card", RmmCalibrateCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "rmm-calibrate-card", name: "RMM radar calibration", description: "Stand on spots, tap I'm here, fit an LD2450 layout." });
window.__rmmCal = { project, fitLayout, lsq };
})();
