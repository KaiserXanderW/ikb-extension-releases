// ==UserScript==
// @name         Workflow Knowledge Base
// @namespace    https://github.com/KaiserXanderW/ikb-extension-releases
// @version      0.6.0
// @description  Workflow and location lookup on the pages you switch it on for, and the workflow canvas. The data is imported or fetched from your data URL and stays in this browser.
// @match        http://*/*
// @match        https://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      gist.githubusercontent.com
// @connect      raw.githubusercontent.com
// @connect      *
// @updateURL    https://raw.githubusercontent.com/KaiserXanderW/ikb-extension-releases/main/userscript/ikb.user.js
// @downloadURL  https://raw.githubusercontent.com/KaiserXanderW/ikb-extension-releases/main/userscript/ikb.user.js
// ==/UserScript==

"use strict";
(() => {
  // src/theme.ts
  var DEFAULT_THEME = "flat";
  function parseTheme(value) {
    return value === "organic" ? "organic" : DEFAULT_THEME;
  }
  var FLAT_TOKENS = {
    accent: "#007BFF",
    accentHover: "#0056b3",
    panelBg: "#222",
    panelBorder: "#444",
    rowBg: "#333",
    rowBorder: "#555",
    text: "#fff",
    textSecondary: "#aaa",
    noResultsBg: "#3d0000",
    noResultsText: "#ff6b6b",
    font: "Arial, sans-serif"
  }, NODE_PALETTE = {
    organic: {
      main: { fill: "#1a1228", stroke: "#7F77DD", text: "#ffffff" },
      sub: { fill: "#0a1e18", stroke: "#1D9E75", text: "#ffffff" },
      diamond: { fill: "#1e1a0a", stroke: "#EF9F27", text: "#ffffff" },
      exc: { fill: "#1e1010", stroke: "#E24B4A", text: "#ffffff" },
      start: { fill: "#111120", stroke: "#7F77DD", text: "#ffffff" },
      end: { fill: "#111120", stroke: "#888780", text: "#ffffff" }
    },
    flat: {
      main: { fill: FLAT_TOKENS.rowBg, stroke: FLAT_TOKENS.accent, text: FLAT_TOKENS.text },
      sub: { fill: FLAT_TOKENS.rowBg, stroke: "#28a745", text: FLAT_TOKENS.text },
      diamond: { fill: FLAT_TOKENS.rowBg, stroke: "#ffc107", text: FLAT_TOKENS.text },
      exc: { fill: FLAT_TOKENS.rowBg, stroke: FLAT_TOKENS.noResultsText, text: FLAT_TOKENS.text },
      start: { fill: FLAT_TOKENS.rowBg, stroke: FLAT_TOKENS.accent, text: FLAT_TOKENS.text },
      end: { fill: FLAT_TOKENS.rowBg, stroke: FLAT_TOKENS.textSecondary, text: FLAT_TOKENS.text }
    }
  };
  function nodeColors(theme, type) {
    return NODE_PALETTE[theme][type] ?? NODE_PALETTE[theme].main;
  }
  function applyThemeToDocument(theme, target = document) {
    let el = "documentElement" in target ? target.documentElement : target;
    el.dataset.theme = theme;
  }

  // src/sites.ts
  var SITES_KEY = "ikb.sites", LAUNCHER_POS_KEY = "ikb.launcherPos";
  var DEFAULT_POS = { right: 20, bottom: 110 }, WILDCARD_LABEL = "ikb-wildcard-label";
  function normalizeSite(input) {
    let raw = input.trim();
    if (!raw) return null;
    /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || (raw = "https://" + raw);
    let wild = /^([a-z][a-z0-9+.-]*:\/\/)\*\./i.exec(raw);
    wild && (raw = wild[1] + WILDCARD_LABEL + "." + raw.slice(wild[0].length));
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:" || !url.hostname || url.hostname.includes("*")) return null;
    let host = url.hostname;
    if (wild) {
      if (!host.startsWith(WILDCARD_LABEL + ".")) return null;
      let base = host.slice(WILDCARD_LABEL.length + 1);
      if (base.split(".").filter(Boolean).length < 2) return null;
      host = "*." + base;
    }
    let key = `${url.protocol}//${host}`;
    return { key, pattern: `${key}/*` };
  }
  function siteCovers(siteKey, pageKey) {
    if (siteKey === pageKey) return !0;
    let m = /^(https?:\/\/)\*\.(.+)$/.exec(siteKey);
    if (!m || !pageKey.startsWith(m[1])) return !1;
    let host = pageKey.slice(m[1].length);
    return host === m[2] || host.endsWith("." + m[2]);
  }
  function findSiteForUrl(href, sites) {
    let pageKey = siteKeyForUrl(href);
    if (!pageKey) return null;
    let exact = `${pageKey}/*`;
    return sites.includes(exact) ? exact : sites.find((p) => siteCovers(siteKeyFromPattern(p), pageKey)) ?? null;
  }
  function siteKeyFromPattern(pattern) {
    return pattern.replace(/\/\*$/, "");
  }
  function siteKeyForUrl(href) {
    try {
      let u = new URL(href);
      return u.protocol !== "https:" && u.protocol !== "http:" ? null : `${u.protocol}//${u.hostname}`;
    } catch {
      return null;
    }
  }
  async function loadSites(storage) {
    let raw = (await storage.get(SITES_KEY))[SITES_KEY];
    return Array.isArray(raw) ? raw.filter((p) => typeof p == "string") : [];
  }
  async function loadPositions(storage) {
    let raw = (await storage.get(LAUNCHER_POS_KEY))[LAUNCHER_POS_KEY];
    return raw && typeof raw == "object" ? { ...raw } : {};
  }
  async function savePosition(storage, key, pos) {
    let all = await loadPositions(storage);
    all[key] = { right: Math.round(pos.right), bottom: Math.round(pos.bottom) }, await storage.set({ [LAUNCHER_POS_KEY]: all });
  }
  async function resetPosition(storage, key) {
    let all = await loadPositions(storage);
    key in all && (delete all[key], await storage.set({ [LAUNCHER_POS_KEY]: all }));
  }
  function isValidPos(p) {
    let v = p;
    return !!v && Number.isFinite(v.right) && Number.isFinite(v.bottom);
  }
  function clampPos(pos, vw, vh) {
    let maxR = Math.max(0, vw - 70), maxB = Math.max(0, vh - 70);
    return {
      right: Math.min(Math.max(0, pos.right), maxR),
      bottom: Math.min(Math.max(0, pos.bottom), maxB)
    };
  }
  var GAP = 10, MARGIN = 8, MIN_PANEL_H = 200;
  function panelRect(pos, vw, vh, want) {
    let width = Math.max(0, Math.min(want.width, vw - 2 * MARGIN)), lTop = vh - pos.bottom - 70, lBottom = vh - pos.bottom, lRight = vw - pos.right, left = Math.min(Math.max(MARGIN, lRight - width), Math.max(MARGIN, vw - MARGIN - width)), above = lTop - GAP - MARGIN, below = vh - lBottom - GAP - MARGIN;
    if (above >= want.height) return { left, top: lTop - GAP - want.height, width, height: want.height };
    if (below >= want.height) return { left, top: lBottom + GAP, width, height: want.height };
    if (above >= below) {
      let height2 = Math.max(Math.min(MIN_PANEL_H, vh - 2 * MARGIN), above);
      return { left, top: Math.max(MARGIN, lTop - GAP - height2), width, height: height2 };
    }
    let height = Math.max(Math.min(MIN_PANEL_H, vh - 2 * MARGIN), below);
    return { left, top: Math.min(lBottom + GAP, vh - MARGIN - height), width, height };
  }

  // src/messages.ts
  var PAGE_SEARCH_CLOSE = "ikb.pageSearch.close", PAGE_SEARCH_OPENED = "ikb.pageSearch.opened";

  // src/launcher.ts
  var DRAG_THRESHOLD = 4, PANEL_SIZE = { width: 380, height: 560 }, T = {
    // 0.5.0: workflows AND locations now, so not "Workflow Search" any more.
    line1: { en: "Quick", de: "Nach-" },
    line2: { en: "Lookup", de: "schlagen" },
    tip: { en: "Workflows & locations \u2014 drag to move", de: "Workflows & Standorte \u2014 zum Verschieben ziehen" },
    reset: { en: "Reset position", de: "Position zur\xFCcksetzen" },
    close: { en: "Close", de: "Schlie\xDFen" },
    frame: { en: "Workflows & locations", de: "Workflows & Standorte" }
  };
  function viewportEl(doc) {
    return doc.compatMode === "BackCompat" && doc.body || doc.documentElement;
  }
  function setStyle(el, props) {
    for (let [k, v] of Object.entries(props)) el.style.setProperty(k, v, "important");
  }
  function mountLauncher(deps) {
    let doc = deps.doc ?? document, win = doc.defaultView ?? window, lang = deps.settings?.lang === "de" ? "de" : "en", theme = parseTheme(deps.settings?.theme), pos = isValidPos(deps.position) ? { ...deps.position } : { ...DEFAULT_POS }, open = !1, frame = null, frameReady = !1, launcher = doc.createElement("ikb-launcher");
    launcher.id = "ikb-launcher", launcher.setAttribute("role", "button"), launcher.tabIndex = 0;
    let line1 = doc.createElement("ikb-line"), line2 = doc.createElement("ikb-line");
    launcher.append(line1, line2);
    let panel = doc.createElement("ikb-panel");
    panel.id = "ikb-panel";
    let slot = doc.createElement("ikb-frame-slot"), bar = doc.createElement("ikb-bar"), resetBtn = doc.createElement("button");
    resetBtn.type = "button", resetBtn.className = "ikb-bar-btn";
    let closeBtn = doc.createElement("button");
    closeBtn.type = "button", closeBtn.className = "ikb-bar-btn ikb-bar-close", closeBtn.textContent = "\xD7";
    let extra = (deps.buttons ?? []).map((b) => {
      let btn = doc.createElement("button");
      return btn.type = "button", btn.className = "ikb-bar-btn", btn.addEventListener("click", () => b.onClick()), { btn, label: b.label };
    });
    if (extra.length) {
      let group = doc.createElement("ikb-bar-group");
      group.append(resetBtn, ...extra.map((x) => x.btn)), bar.append(group, closeBtn);
    } else
      bar.append(resetBtn, closeBtn);
    panel.append(slot, bar);
    let renderText = () => {
      line1.textContent = T.line1[lang], line2.textContent = T.line2[lang], launcher.title = T.tip[lang], launcher.setAttribute("aria-label", T.frame[lang]), launcher.setAttribute("aria-expanded", String(open)), resetBtn.textContent = T.reset[lang];
      for (let x of extra) x.btn.textContent = x.label[lang];
      closeBtn.title = T.close[lang], closeBtn.setAttribute("aria-label", T.close[lang]), frame && (frame.title = T.frame[lang]), launcher.dataset.theme = theme, panel.dataset.theme = theme;
    }, vw = () => viewportEl(doc).clientWidth || win.innerWidth, vh = () => viewportEl(doc).clientHeight || win.innerHeight, place = () => {
      let drawn = clampPos(pos, vw(), vh());
      if (setStyle(launcher, { right: `${drawn.right}px`, bottom: `${drawn.bottom}px` }), !open) return;
      let r = panelRect(drawn, vw(), vh(), PANEL_SIZE);
      setStyle(panel, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`
      });
    }, post = (type) => {
      frame?.contentWindow && frameReady && deps.extOrigin && frame.contentWindow.postMessage({ type }, deps.extOrigin);
    }, embedded = !1, doOpen = () => {
      if (!open) {
        if (open = !0, deps.embed) {
          embedded || (embedded = !0, deps.embed.mount(slot)), panel.dataset.open = "true", renderText(), place(), deps.embed.opened();
          return;
        }
        !frame && deps.frameUrl && (frame = doc.createElement("iframe"), frame.className = "ikb-frame", frame.src = deps.frameUrl, frame.addEventListener("load", () => {
          frameReady = !0, open && (frame?.focus(), post(PAGE_SEARCH_OPENED));
        }), slot.appendChild(frame)), panel.dataset.open = "true", renderText(), place(), frame?.focus(), post(PAGE_SEARCH_OPENED);
      }
    }, doClose = (refocus = !1) => {
      open && (open = !1, panel.dataset.open = "false", renderText(), refocus && launcher.focus({ preventScroll: !0 }));
    }, toggle = () => open ? doClose() : doOpen(), press = null, dragged = !1, suppressClick = !1;
    launcher.addEventListener("pointerdown", (e) => {
      e.button === 0 && (press = { x: e.clientX, y: e.clientY, start: clampPos(pos, vw(), vh()), id: e.pointerId }, dragged = !1, launcher.setPointerCapture?.(e.pointerId), e.preventDefault());
    }), launcher.addEventListener("pointermove", (e) => {
      if (!press) return;
      let dx = e.clientX - press.x, dy = e.clientY - press.y;
      !dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD || (dragged = !0, launcher.dataset.dragging = "true", pos = clampPos({ right: press.start.right - dx, bottom: press.start.bottom - dy }, vw(), vh()), place());
    });
    let endPress = (e) => {
      press && (launcher.releasePointerCapture?.(press.id), press = null, delete launcher.dataset.dragging, dragged && e.type === "pointerup" && (suppressClick = !0, win.setTimeout(() => {
        suppressClick = !1;
      }, 0), savePosition(deps.storage, deps.siteKey, pos).catch(() => {
      })));
    };
    launcher.addEventListener("pointerup", endPress), launcher.addEventListener("pointercancel", endPress), launcher.addEventListener("click", (e) => {
      if (e.preventDefault(), suppressClick || dragged) {
        suppressClick = !1, dragged = !1;
        return;
      }
      toggle();
    }), launcher.addEventListener("keydown", (e) => {
      (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle());
    }), resetBtn.addEventListener("click", () => {
      handle.resetPosition();
    }), closeBtn.addEventListener("click", () => doClose(!0));
    let onKey = (e) => {
      open && e.key === "Escape" && doClose(!0);
    }, onMessage = (e) => {
      if (!deps.extOrigin || e.origin !== deps.extOrigin) return;
      e.data?.type === PAGE_SEARCH_CLOSE && doClose(!0);
    }, onResize = () => place();
    doc.addEventListener("keydown", onKey, !0), win.addEventListener("message", onMessage), win.addEventListener("resize", onResize), panel.dataset.open = "false", renderText(), place(), doc.documentElement.append(panel, launcher);
    let handle = {
      launcher,
      panel,
      isOpen: () => open,
      open: doOpen,
      close: (refocus = !1) => doClose(refocus),
      toggle,
      async resetPosition() {
        pos = { ...DEFAULT_POS }, place(), await resetPosition(deps.storage, deps.siteKey);
      },
      applySettings(s) {
        lang = s?.lang === "de" ? "de" : "en", theme = parseTheme(s?.theme), renderText();
      },
      applyPositions(all) {
        if (press) return;
        let p = all[deps.siteKey];
        pos = isValidPos(p) ? { ...p } : { ...DEFAULT_POS }, place();
      },
      destroy() {
        doc.removeEventListener("keydown", onKey, !0), win.removeEventListener("message", onMessage), win.removeEventListener("resize", onResize), launcher.remove(), panel.remove();
      }
    };
    return handle;
  }

  // src/search.ts
  var DASHES = /[-‐-―−]/g;
  function normalizeTerm(s) {
    return s.toLowerCase().replace(DASHES, "");
  }
  function normTerms(terms) {
    return terms.map(normalizeTerm).filter(Boolean);
  }
  function matchWorkflows(workflows, terms, lang) {
    let ts = normTerms(terms);
    return ts.length ? workflows.filter((w) => {
      let keys = (w.keywords[lang] ?? []).map(normalizeTerm);
      return ts.every((t) => keys.some((k) => k.includes(t) || t.includes(k)));
    }) : [];
  }
  function rankWorkflows(matched, terms, lang) {
    let ts = normTerms(terms), score = (w) => {
      let exact = /* @__PURE__ */ new Set([normalizeTerm(w.id), ...(w.keywords[lang] ?? []).map(normalizeTerm)]);
      return ts.filter((t) => exact.has(t)).length;
    };
    return matched.map((w, i) => ({ w, i, s: score(w) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.w);
  }
  function termsFromLines(raw) {
    return raw.split(`
`).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  function termsFromLine(raw) {
    return raw.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  // src/flow.ts
  function isDeadEnd(wf, node) {
    if (wf.edges.some((e) => e.from === node.id)) return !1;
    let incoming = wf.edges.filter((e) => e.to === node.id);
    return node.type === "exc" || incoming.length > 0 && incoming.every((e) => e.exception);
  }
  function flowOrder(wf) {
    let byId = new Map(wf.nodes.map((n) => [n.id, n])), parents = /* @__PURE__ */ new Map();
    for (let n of wf.nodes) parents.set(n.id, /* @__PURE__ */ new Set());
    for (let e of wf.edges)
      byId.has(e.from) && byId.has(e.to) && e.from !== e.to && parents.get(e.to).add(e.from);
    let order = [], done = /* @__PURE__ */ new Set(), emit = (id) => {
      done.add(id), order.push(byId.get(id));
    }, ready = (id) => [...parents.get(id)].every((p) => done.has(p)), visit = (id) => {
      if (done.has(id)) return;
      emit(id);
      let out = wf.edges.filter((e) => e.from === id && byId.has(e.to) && !done.has(e.to));
      out.sort((a, b) => Number(a.exception) - Number(b.exception));
      let kids = [...new Set(out.map((e) => e.to))];
      for (let k of kids) isDeadEnd(wf, byId.get(k)) && emit(k);
      for (let k of kids) !done.has(k) && ready(k) && visit(k);
    }, start = wf.nodes.find((n) => parents.get(n.id).size === 0) ?? wf.nodes[0];
    start && visit(start.id);
    for (let n of wf.nodes) !done.has(n.id) && parents.get(n.id).size === 0 && visit(n.id);
    for (let n of wf.nodes) done.has(n.id) || visit(n.id);
    return order;
  }

  // src/dom-shim.ts
  function applyInfo(el, info) {
    if (info) {
      if (info.cls && (el.className = info.cls), info.text !== void 0 && (el.textContent = info.text), info.attr)
        for (let [key, value] of Object.entries(info.attr))
          el.setAttribute(key, value);
      info.type !== void 0 && el.setAttribute("type", info.type);
    }
  }
  function installDomShim() {
    HTMLElement.prototype.createEl || (HTMLElement.prototype.createEl = function(tag, info) {
      let el = document.createElement(tag);
      return applyInfo(el, info), this.appendChild(el), el;
    }, HTMLElement.prototype.createDiv = function(info) {
      return this.createEl("div", info);
    }, HTMLElement.prototype.createSpan = function(info) {
      return this.createEl("span", info);
    }, HTMLElement.prototype.empty = function() {
      for (; this.firstChild; ) this.removeChild(this.firstChild);
    }, HTMLElement.prototype.addClass = function(...cls) {
      this.classList.add(...cls);
    }, HTMLElement.prototype.removeClass = function(...cls) {
      this.classList.remove(...cls);
    }, HTMLElement.prototype.toggleClass = function(cls, force) {
      this.classList.toggle(cls, force);
    });
  }

  // src/locations.ts
  var LOCATIONS_KIND = "ikb-locations", LOCATIONS_SCHEMA_VERSION = 1, YES = /* @__PURE__ */ new Set(["yes", "y", "ja", "j", "true", "x", "\u2713", "\u2714"]), NO = /* @__PURE__ */ new Set(["no", "n", "nein", "false", "-", "\u2013", "\u2717", "\u2718"]), UNKNOWN = /* @__PURE__ */ new Set(["", "?", "unknown", "unbekannt", "n/a", "na"]), isObj = (v) => !!v && typeof v == "object" && !Array.isArray(v), str = (v) => typeof v == "string" && v.trim() ? v.trim() : void 0, strList = (v) => {
    if (!Array.isArray(v)) return;
    let out = v.map(str).filter((s) => !!s);
    return out.length ? out : void 0;
  };
  function bilingual(v) {
    if (typeof v == "string" && v.trim()) return { en: v.trim(), de: v.trim() };
    if (!isObj(v)) return;
    let en = str(v.en) ?? str(v.de);
    if (en)
      return { en, de: str(v.de) ?? en };
  }
  function coerce(field, raw) {
    if (raw == null) return { value: null, odd: !1 };
    if (field.type === "yesno") {
      if (typeof raw == "boolean") return { value: raw, odd: !1 };
      if (typeof raw == "string") {
        let s = raw.trim().toLowerCase();
        return YES.has(s) ? { value: !0, odd: !1 } : NO.has(s) ? { value: !1, odd: !1 } : UNKNOWN.has(s) ? { value: null, odd: !1 } : { value: raw.trim(), odd: !0 };
      }
      if (raw === 1 || raw === 0) return { value: raw === 1, odd: !1 };
    }
    return typeof raw == "string" ? { value: UNKNOWN.has(raw.trim().toLowerCase()) ? null : raw.trim(), odd: !1 } : typeof raw == "number" || typeof raw == "boolean" ? { value: raw, odd: !1 } : { value: JSON.stringify(raw), odd: !0 };
  }
  function parseLocations(raw) {
    let v = raw;
    if (typeof raw == "string")
      try {
        v = JSON.parse(raw);
      } catch (e) {
        return { ok: !1, error: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
      }
    if (!isObj(v)) return { ok: !1, error: "expected a JSON object" };
    if (v.kind !== LOCATIONS_KIND)
      return { ok: !1, error: `"kind" must be "${LOCATIONS_KIND}" \u2014 is this a workflow file? Import those above.` };
    if (v.schemaVersion !== LOCATIONS_SCHEMA_VERSION)
      return { ok: !1, error: `"schemaVersion" must be ${LOCATIONS_SCHEMA_VERSION}` };
    if (!Array.isArray(v.fields) || !Array.isArray(v.locations))
      return { ok: !1, error: '"fields" and "locations" must both be arrays' };
    let warnings = [], fields = [], seen = /* @__PURE__ */ new Set();
    if (v.fields.forEach((f, i) => {
      let key = isObj(f) ? str(f.key) : void 0, label = isObj(f) ? bilingual(f.label) : void 0;
      if (!isObj(f) || !key || !label) {
        warnings.push(`field #${i + 1} skipped: needs "key" and "label"`);
        return;
      }
      if (seen.has(key)) {
        warnings.push(`field "${key}" listed twice; kept the first`);
        return;
      }
      seen.add(key);
      let type = f.type === "text" || f.type === "number" ? f.type : "yesno";
      f.type !== void 0 && f.type !== type && warnings.push(`field "${key}": unknown type "${String(f.type)}", treated as yesno`), fields.push({ key, label, type, aliases: strList(f.aliases), group: bilingual(f.group) });
    }), !fields.length) return { ok: !1, error: "no usable fields" };
    let byKey = new Map(fields.map((f) => [f.key, f])), locations = [], unknownKeys = /* @__PURE__ */ new Set(), oddValues = [];
    return v.locations.forEach((l, i) => {
      let code = isObj(l) ? str(l.code) : void 0, name = isObj(l) ? str(l.name) : void 0;
      if (!isObj(l) || !code && !name) {
        warnings.push(`location #${i + 1} skipped: needs "code" or "name"`);
        return;
      }
      let values = {};
      for (let [k, rawVal] of Object.entries(isObj(l.values) ? l.values : {})) {
        let field = byKey.get(k);
        if (!field) {
          unknownKeys.add(k);
          continue;
        }
        let { value, odd } = coerce(field, rawVal);
        values[k] = value, odd && oddValues.push(`${code ?? name}.${k}`);
      }
      let notes = {};
      for (let [k, n] of Object.entries(isObj(l.notes) ? l.notes : {})) {
        let s = str(n);
        s && byKey.has(k) && (notes[k] = s);
      }
      locations.push({
        code: code ?? "",
        name: name ?? code ?? "",
        city: str(l.city),
        country: str(l.country),
        address: str(l.address),
        aliases: strList(l.aliases),
        values,
        ...Object.keys(notes).length ? { notes } : {}
      });
    }), locations.length ? (unknownKeys.size && warnings.push(`values for fields not in "fields" ignored: ${[...unknownKeys].join(", ")}`), oddValues.length && warnings.push(`${oddValues.length} yes/no value(s) weren't yes/no and are shown as text: ${oddValues.slice(0, 5).join(", ")}${oddValues.length > 5 ? ", \u2026" : ""}`), {
      ok: !0,
      warnings,
      data: {
        kind: LOCATIONS_KIND,
        schemaVersion: LOCATIONS_SCHEMA_VERSION,
        generatedAt: str(v.generatedAt),
        source: str(v.source),
        fields,
        locations
      }
    }) : { ok: !1, error: "no usable locations" };
  }
  function norm(s) {
    return normalizeTerm(s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss"));
  }
  var words = (s) => s.split(/[\s,/()·.:;]+/).map(norm).filter(Boolean);
  function fieldNames(f) {
    return [f.key.replace(/_/g, " "), f.label.en, f.label.de, ...f.aliases ?? []];
  }
  function locationHaystack(l) {
    return norm([l.code, l.name, l.city, l.country, l.address, ...l.aliases ?? []].filter(Boolean).join(" | "));
  }
  function classifyQuery(data, terms) {
    let fieldTerms = [], locationTerms = [], hit = /* @__PURE__ */ new Set(), exactLoc = new Set(data.locations.flatMap((l) => [l.code, l.city ?? ""].map(norm)).filter(Boolean));
    for (let raw of terms) {
      let t = norm(raw);
      if (!t) continue;
      let exact = data.fields.filter((f) => fieldNames(f).some((n) => norm(n) === t)), prefix = t.length >= 3 && !exactLoc.has(t) ? data.fields.filter((f) => fieldNames(f).some((n) => words(n).some((w) => w.startsWith(t)) || t.length >= 4 && norm(n).includes(t))) : [], matched = exact.length ? exact : prefix;
      if (matched.length) {
        fieldTerms.push(t);
        for (let f of matched) hit.add(f.key);
      } else
        locationTerms.push(t);
    }
    return { fieldTerms, locationTerms, fields: data.fields.filter((f) => hit.has(f.key)) };
  }
  function matchLocations(data, locationTerms) {
    return locationTerms.length ? data.locations.map((l, i) => ({ l, i, hay: locationHaystack(l) })).filter((x) => locationTerms.every((t) => x.hay.includes(t))).map((x) => {
      let code = norm(x.l.code), exact = /* @__PURE__ */ new Set([norm(x.l.city ?? ""), norm(x.l.name)]), s = locationTerms.reduce((acc, t) => acc + (t === code ? 10 : exact.has(t) ? 2 : 0), 0);
      return { ...x, s };
    }).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.l) : data.locations;
  }
  var YES_NO = {
    yes: { en: "Yes", de: "Ja" },
    no: { en: "No", de: "Nein" },
    unknown: { en: "\u2014", de: "\u2014" }
  };
  function displayValue(value, lang) {
    return value === !0 ? { text: YES_NO.yes[lang], kind: "yes" } : value === !1 ? { text: YES_NO.no[lang], kind: "no" } : value == null || value === "" ? { text: YES_NO.unknown[lang], kind: "unknown" } : { text: String(value), kind: "text" };
  }
  function locationTitle(l) {
    return l.code && l.code !== l.name ? `${l.code} \xB7 ${l.name}` : l.name;
  }

  // src/store.ts
  var SCHEMA_VERSION = 1, SETTINGS_KEY = "ikb.settings", EDITS_KEY = "ikb.edits", IMPORTED_KEY = "ikb.imported", LOCATIONS_KEY = "ikb.locations", FETCH_TIMEOUT_MS = 5e3;
  function isValidStore(value) {
    if (!value || typeof value != "object") return !1;
    let v = value;
    return v.schemaVersion === SCHEMA_VERSION && Array.isArray(v.workflows);
  }
  function overlayKey(wfId, nodeId) {
    return `${wfId}/${nodeId}`;
  }
  function applyOverlay(data, overlay) {
    return !overlay || Object.keys(overlay).length === 0 ? data : {
      ...data,
      workflows: data.workflows.map((wf) => ({
        ...wf,
        nodes: wf.nodes.map((node) => {
          let edit = overlay[overlayKey(wf.id, node.id)];
          if (!edit) return node;
          let next = {
            ...node,
            ...edit.label !== void 0 ? { label: edit.label } : {},
            ...edit.type !== void 0 ? { type: edit.type } : {},
            ...edit.responsible !== void 0 ? { responsible: edit.responsible } : {},
            ...edit.sla !== void 0 ? { sla: edit.sla } : {}
          };
          return next.responsible === "" && delete next.responsible, next.sla === "" && delete next.sla, next;
        })
      }))
    };
  }
  async function fetchRemoteData(url, fetchImpl, timeoutMs) {
    let controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) return { error: `data URL returned HTTP ${res.status}` };
      let parsed = await res.json();
      return isValidStore(parsed) ? { data: parsed } : { error: "data URL response failed schema validation (schemaVersion/workflows)" };
    } catch (e) {
      return { error: `data URL fetch failed: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      clearTimeout(timer);
    }
  }
  function emptyStore() {
    return { schemaVersion: SCHEMA_VERSION, workflows: [], telemetryLog: [], updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  var ExtensionStore = class {
    constructor(storage, opts = {}) {
      this.overlay = {};
      this.locationsData = null;
      this.storage = storage, this.fetchImpl = opts.fetchImpl ?? fetch, this.fetchTimeoutMs = opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS, this.data = emptyStore();
    }
    get workflows() {
      return this.data.workflows;
    }
    get locations() {
      return this.locationsData;
    }
    async load() {
      let settings = (await this.storage.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {}, editsRaw = await this.storage.get(EDITS_KEY);
      this.overlay = editsRaw[EDITS_KEY] ?? {};
      let urlError, result = null;
      if (settings.dataUrl) {
        let fetched = await fetchRemoteData(settings.dataUrl, this.fetchImpl, this.fetchTimeoutMs);
        "error" in fetched ? urlError = fetched.error : result = { data: fetched.data, source: "url" };
      }
      if (!result) {
        let importedRaw = (await this.storage.get(IMPORTED_KEY))[IMPORTED_KEY];
        result = isValidStore(importedRaw) ? { data: importedRaw, source: "imported" } : { data: emptyStore(), source: "none" }, urlError && (result.error = urlError);
      }
      return this.data = applyOverlay(result.data, this.overlay), await this.loadLocations(), { ...result, data: this.data };
    }
    // Options page "Import JSON file". Validates like a data-URL response, then
    // persists it as the local source and makes it the current data — unless a
    // data URL is set, which still wins on the next load().
    async importData(raw) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return { ok: !1, error: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
      }
      return isValidStore(parsed) ? (await this.storage.set({ [IMPORTED_KEY]: parsed }), this.data = applyOverlay(parsed, this.overlay), { ok: !0, workflows: parsed.workflows.length }) : { ok: !1, error: "file failed schema validation (schemaVersion must be 1, workflows an array)" };
    }
    // Stored as imported (already validated); re-parsed on load so a file saved
    // by an older version still gets today's checks.
    async loadLocations() {
      let raw = (await this.storage.get(LOCATIONS_KEY))[LOCATIONS_KEY], parsed = raw ? parseLocations(raw) : null;
      return this.locationsData = parsed?.ok ? parsed.data : null, this.locationsData;
    }
    async importLocations(raw) {
      let parsed = parseLocations(raw);
      return parsed.ok ? (await this.storage.set({ [LOCATIONS_KEY]: parsed.data }), this.locationsData = parsed.data, { ok: !0, locations: parsed.data.locations.length, fields: parsed.data.fields.length, warnings: parsed.warnings }) : parsed;
    }
    async clearLocations() {
      await this.storage.set({ [LOCATIONS_KEY]: null }), this.locationsData = null;
    }
    async setNodeEdit(wfId, nodeId, edit) {
      this.overlay = { ...this.overlay, [overlayKey(wfId, nodeId)]: edit }, await this.storage.set({ [EDITS_KEY]: this.overlay }), this.data = applyOverlay(this.data, { [overlayKey(wfId, nodeId)]: edit });
    }
    async resetEdits() {
      this.overlay = {}, await this.storage.set({ [EDITS_KEY]: {} });
    }
    // Pure, testable core of "Export JSON" — the DOM download trigger is a thin
    // wrapper around this in the UI layer (E4/E5), since jsdom has no
    // URL.createObjectURL to exercise there.
    buildExportData() {
      return { ...this.data, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
  };

  // src/search-box.ts
  var CLEAR = { en: "Clear search", de: "Suche leeren" };
  function createSearchBox(parent, cls, lang, onClear) {
    installDomShim();
    let wrap = parent.createDiv({ cls: "wkb-sb-inputwrap" }), input = wrap.createEl("input", { cls, type: "search" }), btn = wrap.createEl("button", { cls: "wkb-sb-clear", text: "\xD7" });
    btn.type = "button", btn.tabIndex = -1;
    let current = lang, sync = (l = current) => {
      current = l, btn.hidden = !input.value, btn.title = CLEAR[l], btn.setAttribute("aria-label", CLEAR[l]);
    };
    return input.addEventListener("input", () => sync()), btn.addEventListener("click", () => {
      input.value = "", sync(), onClear(), input.focus();
    }), sync(lang), { input, sync };
  }

  // src/locations-view.ts
  var T2 = {
    title: { en: "Locations", de: "Standorte" },
    placeholder: { en: "e.g. berlin kitchen", de: "z. B. berlin k\xFCche" },
    all: { en: "All locations", de: "Alle Standorte" },
    hits: { en: "locations", de: "Standorte" },
    none: { en: "No matching location", de: "Kein passender Standort" },
    noData: {
      en: "No locations table loaded \u2014 import one on the options page.",
      de: "Keine Standorttabelle geladen \u2014 auf der Optionsseite importieren."
    },
    options: { en: "Open options", de: "Optionen \xF6ffnen" },
    other: { en: "Other", de: "Sonstiges" },
    more: { en: "more \u2014 keep typing to narrow it down", de: "weitere \u2014 weitertippen zum Eingrenzen" }
  }, MAX_ROWS = 60, rowId = (l, i) => `${l.code}#${i}`;
  function mountLocations(container, deps) {
    let lang = deps.lang, userOpen = /* @__PURE__ */ new Map(), active = null, shownIds = [], header = container.createDiv({ cls: "wkb-sb-header" }), titleEl = header.createDiv({ cls: "wkb-sb-title" }), box = createSearchBox(header, "wkb-sb-input wkb-loc-input", lang, () => {
      userOpen.clear(), active = null, render();
    }), input = box.input;
    input.setAttribute("aria-label", T2.title.en);
    let countEl = header.createDiv({ cls: "wkb-sb-count" }), list = container.createDiv({ cls: "wkb-sb-list" }), renderValue = (parent, field, l) => {
      let row = parent.createDiv({ cls: "wkb-loc-field" });
      row.dataset.field = field.key, row.createDiv({ cls: "wkb-loc-field-label", text: field.label[lang] });
      let v = displayValue(l.values[field.key], lang), val = row.createDiv({ cls: `wkb-loc-value wkb-loc-value--${v.kind}`, text: v.text });
      val.dataset.kind = v.kind;
      let note = l.notes?.[field.key];
      note && row.createDiv({ cls: "wkb-loc-note", text: note });
    }, render = () => {
      titleEl.textContent = T2.title[lang], input.placeholder = T2.placeholder[lang], box.sync(lang), list.empty(), shownIds = [];
      let data = deps.getData();
      if (!data) {
        countEl.textContent = "", list.createDiv({ cls: "wkb-sb-empty", text: (deps.noDataText ?? T2.noData)[lang] }), deps.openOptions && list.createEl("button", { cls: "wkb-sb-btn", text: (deps.optionsLabel ?? T2.options)[lang] }).addEventListener("click", () => deps.openOptions());
        return;
      }
      let terms = termsFromLine(input.value), q = classifyQuery(data, terms), matched = matchLocations(data, q.locationTerms), shown = matched.slice(0, MAX_ROWS), fieldNote = q.fields.length ? ` \xB7 ${q.fields.map((f) => f.label[lang]).join(", ")}` : "";
      if (countEl.textContent = terms.length ? `${matched.length} ${T2.hits[lang]}${fieldNote}` : T2.all[lang], shownIds = shown.map((l) => rowId(l, data.locations.indexOf(l))), active && !shownIds.includes(active) && (active = null), !active && terms.length && shown.length && (active = shownIds[0]), !shown.length) {
        list.createDiv({ cls: "wkb-sb-empty wkb-sb-none", text: T2.none[lang] });
        return;
      }
      let autoOpen = q.locationTerms.length > 0 && shown.length === 1;
      shown.forEach((l, i) => renderCard(data, l, shownIds[i], q.fields, userOpen.get(shownIds[i]) ?? autoOpen)), matched.length > shown.length && list.createDiv({ cls: "wkb-sb-empty", text: `+${matched.length - shown.length} ${T2.more[lang]}` });
    }, renderCard = (data, l, id, picked, open) => {
      let isActive = id === active, card = list.createDiv({ cls: "wkb-sb-card wkb-loc-card" + (isActive ? " wkb-sb-card--active" : "") });
      card.dataset.code = l.code, card.setAttribute("aria-selected", String(isActive));
      let head = card.createDiv({ cls: "wkb-sb-card-head" });
      head.setAttribute("role", "button"), head.tabIndex = 0, head.createDiv({ cls: "wkb-sb-card-title", text: locationTitle(l) });
      let meta = [l.city, l.address].filter(Boolean).join(" \xB7 ");
      meta && head.createDiv({ cls: "wkb-sb-card-meta", text: meta }), head.setAttribute("aria-expanded", String(open || picked.length > 0));
      let toggle = () => {
        userOpen.set(id, !open), active = id, render();
      };
      if (head.addEventListener("click", toggle), head.addEventListener("keydown", (e) => {
        (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle());
      }), picked.length) {
        let body2 = card.createDiv({ cls: "wkb-loc-fields wkb-loc-fields--picked" });
        for (let f of picked) renderValue(body2, f, l);
      }
      if (!open) return;
      let groups = /* @__PURE__ */ new Map();
      for (let f of data.fields) {
        if (picked.includes(f)) continue;
        let title = f.group?.[lang] ?? T2.other[lang], key = f.group?.en ?? "";
        groups.has(key) || groups.set(key, { title, fields: [] }), groups.get(key).fields.push(f);
      }
      let body = card.createDiv({ cls: "wkb-loc-fields" }), showHeadings = groups.size > 1;
      for (let g of groups.values()) {
        showHeadings && body.createDiv({ cls: "wkb-loc-group", text: g.title });
        for (let f of g.fields) renderValue(body, f, l);
      }
    }, move = (step) => {
      if (!shownIds.length) return;
      let i = active ? shownIds.indexOf(active) : -1, next = i < 0 ? step === 1 ? 0 : shownIds.length - 1 : (i + step + shownIds.length) % shownIds.length;
      active = shownIds[next], render();
      let el = list.querySelector(".wkb-sb-card--active");
      el && typeof el.scrollIntoView == "function" && el.scrollIntoView({ block: "nearest" });
    }, t = 0;
    return input.addEventListener("input", () => {
      userOpen.clear(), active = null, clearTimeout(t), t = window.setTimeout(render, 80);
    }), input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp")
        e.preventDefault(), clearTimeout(t), render(), move(e.key === "ArrowDown" ? 1 : -1);
      else if (e.key === "Enter") {
        if (e.preventDefault(), clearTimeout(t), render(), active) {
          let autoOpen = shownIds.length === 1;
          userOpen.set(active, !(userOpen.get(active) ?? autoOpen)), render();
        }
      } else e.key === "Escape" && (e.preventDefault(), clearTimeout(t), input.value = "", userOpen.clear(), active = null, render(), deps.onEscape?.());
    }), render(), {
      setQuery(raw) {
        input.value = raw, userOpen.clear(), active = null, render();
      },
      refresh(next = {}) {
        next.lang && (lang = next.lang), render();
      },
      focusInput() {
        input.focus(), input.select();
      }
    };
  }

  // src/sidebar.ts
  var SIDEBAR_TAB_KEY = "ikb.sidebarTab", TYPE_LABEL = {
    main: { en: "Step", de: "Schritt" },
    sub: { en: "Sub-step", de: "Teilschritt" },
    diamond: { en: "Decision", de: "Entscheidung" },
    exc: { en: "Exception", de: "Ausnahme" },
    start: { en: "Start", de: "Start" },
    end: { en: "End", de: "Ende" }
  }, T3 = {
    title: { en: "Workflow search", de: "Workflow-Suche" },
    placeholder: { en: "e.g. refund 2e", de: "z. B. erstattung 2e" },
    all: { en: "All workflows", de: "Alle Workflows" },
    none: { en: "No matches", de: "Keine \xDCbereinstimmung" },
    noData: {
      en: "No workflow data loaded \u2014 set it up in the extension options.",
      de: "Keine Workflow-Daten geladen \u2014 in den Erweiterungsoptionen einrichten."
    },
    options: { en: "Open options", de: "Optionen \xF6ffnen" },
    open: { en: "Open in canvas", de: "Im Canvas \xF6ffnen" },
    responsible: { en: "Responsible", de: "Zust\xE4ndig" },
    hits: { en: "matches", de: "Treffer" },
    tabWf: { en: "Workflows", de: "Workflows" },
    tabLoc: { en: "Locations", de: "Standorte" }
  };
  function mount(container, deps) {
    installDomShim(), container.empty(), container.addClass("wkb-sb");
    let lang = deps.lang, theme = deps.theme ?? parseTheme(void 0), userOpen = /* @__PURE__ */ new Map(), active = null, shownIds = [], tabsOn = !!deps.locations, tab = tabsOn && deps.initialTab === "locations" ? "locations" : "workflows", wfPane = container.createDiv({ cls: "wkb-sb-pane wkb-sb-pane--workflows" }), locPane = tabsOn ? container.createDiv({ cls: "wkb-sb-pane wkb-sb-pane--locations" }) : null, locHandle = null, tabbar = tabsOn ? container.createDiv({ cls: "wkb-sb-tabbar" }) : null;
    tabsOn && container.addClass("wkb-sb--tabs");
    let renderTabbar = () => {
      if (tabbar) {
        tabbar.empty();
        for (let [id, label] of [["workflows", T3.tabWf], ["locations", T3.tabLoc]]) {
          let b = tabbar.createEl("button", { cls: "wkb-sb-tab" + (id === tab ? " wkb-sb-tab--active" : ""), text: label[lang] });
          b.dataset.tab = id, b.tabIndex = -1, b.setAttribute("aria-pressed", String(id === tab)), b.addEventListener("click", () => setTab(id));
        }
      }
    };
    tabsOn && container.addEventListener("keydown", (e) => {
      e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey || !(e.target instanceof HTMLElement) || !e.target.classList.contains("wkb-sb-input") || (e.preventDefault(), setTab(tab === "workflows" ? "locations" : "workflows"));
    });
    let header = wfPane.createDiv({ cls: "wkb-sb-header" }), titleEl = header.createDiv({ cls: "wkb-sb-title" }), box = createSearchBox(header, "wkb-sb-input", lang, () => {
      userOpen.clear(), active = null, render();
    }), input = box.input;
    input.setAttribute("aria-label", T3.title.en), input.autofocus = !0;
    let countEl = header.createDiv({ cls: "wkb-sb-count" }), list = wfPane.createDiv({ cls: "wkb-sb-list" }), render = () => {
      titleEl.textContent = T3.title[lang], input.placeholder = T3.placeholder[lang], box.sync(lang), list.empty();
      let all = deps.store.workflows;
      if (shownIds = [], !all.length) {
        let empty = deps.emptyWorkflows;
        list.createDiv({ cls: "wkb-sb-empty", text: (empty?.text ?? T3.noData)[lang] });
        let run = empty?.run ?? deps.openOptions;
        run && list.createEl("button", { cls: "wkb-sb-btn", text: (empty?.label ?? T3.options)[lang] }).addEventListener("click", () => run()), countEl.textContent = "";
        return;
      }
      let terms = termsFromLine(input.value), shown = terms.length ? rankWorkflows(matchWorkflows(all, terms, lang), terms, lang) : all;
      if (countEl.textContent = terms.length ? `${shown.length} ${T3.hits[lang]}` : T3.all[lang], shownIds = shown.map((w) => w.id), active && !shownIds.includes(active) && (active = null), !active && terms.length && shown.length && (active = shown[0].id), !shown.length) {
        list.createDiv({ cls: "wkb-sb-empty wkb-sb-none", text: T3.none[lang] });
        return;
      }
      let autoOpen = terms.length > 0 && shown.length === 1;
      shown.forEach((wf) => renderCard(wf, userOpen.get(wf.id) ?? autoOpen));
    }, renderCard = (wf, open) => {
      let isActive = wf.id === active, card = list.createDiv({ cls: "wkb-sb-card" + (isActive ? " wkb-sb-card--active" : "") });
      card.style.borderLeftColor = wf.color, card.dataset.wfId = wf.id, card.setAttribute("aria-selected", String(isActive));
      let head = card.createDiv({ cls: "wkb-sb-card-head" });
      head.setAttribute("role", "button"), head.tabIndex = 0, head.createDiv({ cls: "wkb-sb-card-title", text: wf.title[lang] }), head.createDiv({ cls: "wkb-sb-card-meta", text: wf.meta[lang] }), head.setAttribute("aria-expanded", String(open));
      let toggle = () => {
        userOpen.set(wf.id, !open), active = wf.id, render();
      };
      if (head.addEventListener("click", toggle), head.addEventListener("keydown", (e) => {
        (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle());
      }), !open) return;
      let steps = card.createEl("ol", { cls: "wkb-sb-steps" });
      for (let node of flowOrder(wf)) {
        let li = steps.createEl("li", { cls: `wkb-sb-step wkb-sb-step--${node.type}` });
        isDeadEnd(wf, node) && li.addClass("wkb-sb-step--dead-end");
        let dot = li.createSpan({ cls: "wkb-sb-dot" });
        dot.style.background = nodeColors(theme, node.type).stroke, dot.title = (TYPE_LABEL[node.type] ?? TYPE_LABEL.main)[lang];
        let body = li.createDiv({ cls: "wkb-sb-step-body" });
        body.createDiv({ cls: "wkb-sb-step-label", text: node.label[lang] ?? node.label.en });
        let facts = [
          node.responsible ? `${T3.responsible[lang]}: ${node.responsible}` : "",
          node.sla ? `SLA ${node.sla}` : ""
        ].filter(Boolean).join(" \xB7 ");
        facts && body.createDiv({ cls: "wkb-sb-step-facts", text: facts });
        for (let e of wf.edges.filter((e2) => e2.from === node.id && node.type === "diamond")) {
          let to = wf.nodes.find((n) => n.id === e.to);
          if (!to) continue;
          let branch = body.createDiv({ cls: "wkb-sb-branch" + (e.exception ? " wkb-sb-branch--exc" : "") });
          branch.textContent = `${e.label?.[lang] ?? "\u2192"} \u2192 ${to.label[lang] ?? to.label.en}`;
        }
      }
      card.createEl("button", { cls: "wkb-sb-btn", text: T3.open[lang] }).addEventListener("click", () => deps.openInCanvas(wf.id));
    }, move = (step) => {
      if (!shownIds.length) return;
      let i = active ? shownIds.indexOf(active) : -1, next = i < 0 ? step === 1 ? 0 : shownIds.length - 1 : (i + step + shownIds.length) % shownIds.length;
      active = shownIds[next], render();
      let el = list.querySelector(".wkb-sb-card--active");
      el && typeof el.scrollIntoView == "function" && el.scrollIntoView({ block: "nearest" });
    }, t = 0;
    input.addEventListener("input", () => {
      userOpen.clear(), active = null, clearTimeout(t), t = window.setTimeout(render, 100);
    }), input.addEventListener("keydown", (e) => {
      e.key === "ArrowDown" || e.key === "ArrowUp" ? (e.preventDefault(), clearTimeout(t), render(), move(e.key === "ArrowDown" ? 1 : -1)) : e.key === "Enter" ? (e.preventDefault(), clearTimeout(t), render(), active && deps.openInCanvas(active)) : e.key === "Escape" && (e.preventDefault(), clearTimeout(t), input.value = "", userOpen.clear(), active = null, render(), deps.onEscape?.());
    }), locPane && deps.locations && (locHandle = mountLocations(locPane, {
      getData: deps.locations,
      lang,
      openOptions: deps.emptyLocations?.run ?? deps.openOptions,
      noDataText: deps.emptyLocations?.text,
      optionsLabel: deps.emptyLocations?.label,
      onEscape: deps.onEscape
    }));
    let showTab = () => {
      wfPane.hidden = tab !== "workflows", locPane && (locPane.hidden = tab !== "locations");
    }, focusActive = () => {
      tab === "locations" && locHandle ? locHandle.focusInput() : (input.focus(), input.select());
    };
    function setTab(next) {
      !tabsOn || next === tab || (tab = next, showTab(), renderTabbar(), deps.onTabChange?.(tab), focusActive());
    }
    return showTab(), renderTabbar(), render(), {
      setQuery(raw) {
        input.value = raw, userOpen.clear(), active = null, render();
      },
      setTab,
      get tab() {
        return tab;
      },
      refresh(next = {}) {
        next.lang && (lang = next.lang), next.theme && (theme = next.theme), render(), renderTabbar(), locHandle?.refresh({ lang });
      },
      focusInput: focusActive
    };
  }

  // src/node-geometry.ts
  var WRAP_WIDTHS = [48, 60, 72, 84, 96, 110, 124, 140];
  function wrapText(text, maxW, measure) {
    let pieces = [];
    for (let word of text.trim().split(/\s+/).filter(Boolean)) {
      if (/^[-/—–+&·]$/.test(word) && pieces.length) {
        pieces[pieces.length - 1].text += ` ${word}`;
        continue;
      }
      (measure(word) > maxW ? word.match(/[^-/]+[-/]*|[-/]+/g) ?? [word] : [word]).forEach((part, i) => pieces.push({ sep: i === 0 ? " " : "", text: part }));
    }
    let lines = [], cur = "";
    for (let p of pieces) {
      let next = cur ? cur + p.sep + p.text : p.text;
      cur && measure(next) > maxW ? (lines.push(cur), cur = p.text) : cur = next;
    }
    return cur && lines.push(cur), lines;
  }
  function shapeSizeFor(type, w, h) {
    return type === "diamond" ? Math.max(28, (w / 2 + 5) / 0.85 + h / 2 + 5) : Math.max(28, Math.hypot(w / 2, h / 2) + 5);
  }
  var FEWER_LINES_SLACK = 1.15;
  function countWordBreaks(text, lines) {
    let words2 = new Set(text.trim().split(/\s+/));
    return lines.filter((l, i) => i < lines.length - 1 && !words2.has(l.split(" ").pop() ?? "")).length;
  }
  function fitsFor(type, text, measure) {
    return WRAP_WIDTHS.map((maxW) => {
      let lines = wrapText(text, maxW, measure), w = Math.max(0, ...lines.map(measure));
      return { size: shapeSizeFor(type, w, lines.length * 14), lines, wordBreaks: countWordBreaks(text, lines) };
    });
  }
  var byReadability = (a, b) => a.wordBreaks - b.wordBreaks || a.lines.length - b.lines.length || a.size - b.size, WORD_BREAK_COST = 0.25;
  function bestFit(fits) {
    let cost = (f) => f.size * (1 + WORD_BREAK_COST * f.wordBreaks), cheapest = Math.min(...fits.map(cost));
    return fits.filter((f) => cost(f) <= cheapest * FEWER_LINES_SLACK + 0.01).sort(byReadability)[0];
  }
  function nodeGeometry(node, measure) {
    let texts = { en: node.label.en ?? "", de: node.label.de ?? node.label.en ?? "" }, fits = { en: fitsFor(node.type, texts.en, measure), de: fitsFor(node.type, texts.de, measure) }, ry = Math.ceil(Math.max(bestFit(fits.en).size, bestFit(fits.de).size)), pick = (f) => f.filter((x) => x.size <= ry).sort(byReadability)[0]?.lines ?? bestFit(f).lines;
    return { rx: node.type === "diamond" ? ry * 0.85 : ry, ry, lines: { en: pick(fits.en), de: pick(fits.de) } };
  }
  function outlineDistance(g, angle, diamond) {
    if (!diamond) return g.ry;
    let c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    return 1 / (c / g.rx + s / g.ry);
  }
  function estimateMeasure(fontPx) {
    return (t) => t.length * fontPx * 0.58;
  }
  var EDGE_LABEL_FONT_PX = 11, EDGE_LABEL_LINE_H = 13, EDGE_LABEL_MAX_W = 150;
  function edgeLabelLines(raw, measure) {
    return raw.split(" / ").map((s) => s.trim()).filter(Boolean).flatMap((part) => wrapText(part, EDGE_LABEL_MAX_W, measure));
  }

  // src/renderer.ts
  var NF = {
    main: { fill: "#1a1228", stroke: "#7F77DD", tc: "#ffffff" },
    sub: { fill: "#0a1e18", stroke: "#1D9E75", tc: "#ffffff" },
    diamond: { fill: "#1e1a0a", stroke: "#EF9F27", tc: "#ffffff" },
    exc: { fill: "#1e1010", stroke: "#E24B4A", tc: "#ffffff" },
    start: { fill: "#111120", stroke: "#7F77DD", tc: "#ffffff" },
    end: { fill: "#111120", stroke: "#888780", tc: "#ffffff" }
  }, LAYOUT = {
    H_GAP: 64,
    // outline-to-outline, neighbours in a row
    V_GAP_MIN: 70,
    // outline-to-outline, consecutive rows
    V_LABEL_PAD: 40,
    // room around the tallest edge label in a row gap
    MARGIN_X: 36,
    TOP: 28,
    // the title sits above the tile
    BOT: 24
  };
  function buildWorkflowLayout(wf, geom, opts = {}) {
    let g = (id) => geom.get(id) ?? { rx: 28, ry: 28, lines: { en: [], de: [] } }, childEdges = /* @__PURE__ */ new Map(), hasParent = /* @__PURE__ */ new Set();
    for (let n of wf.nodes) childEdges.set(n.id, []);
    for (let e of wf.edges)
      childEdges.get(e.from)?.push({ to: e.to, exception: e.exception }), hasParent.add(e.to);
    for (let list of childEdges.values())
      list.sort((a, b) => Number(a.exception) - Number(b.exception));
    let childIds = (id) => (childEdges.get(id) ?? []).map((e) => e.to), levels = /* @__PURE__ */ new Map(), roots = wf.nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id), parentEdges = /* @__PURE__ */ new Map();
    for (let n of wf.nodes) parentEdges.set(n.id, []);
    for (let e of wf.edges) parentEdges.get(e.to)?.push(e.from);
    let inDegree = /* @__PURE__ */ new Map();
    for (let n of wf.nodes) inDegree.set(n.id, 0);
    for (let e of wf.edges) inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    let topoQueue = wf.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
    for (let id of topoQueue) levels.set(id, 0);
    for (; topoQueue.length > 0; ) {
      let id = topoQueue.shift(), myLevel = levels.get(id) ?? 0;
      for (let child of childIds(id)) {
        levels.set(child, Math.max(levels.get(child) ?? 0, myLevel + 1));
        let deg = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, deg), deg === 0 && topoQueue.push(child);
      }
    }
    let nextLevel = levels.size ? Math.max(...levels.values()) + 1 : 0, leftoverLevel = nextLevel;
    for (let n of wf.nodes)
      levels.has(n.id) || levels.set(n.id, leftoverLevel);
    wf.nodes.some((n) => levels.get(n.id) === leftoverLevel) && nextLevel++;
    let gapLabelH = [];
    for (let e of wf.edges) {
      let to = levels.get(e.to) ?? 0;
      to === (levels.get(e.from) ?? 0) + 1 && (gapLabelH[to] = Math.max(gapLabelH[to] ?? 0, opts.edgeLabelH?.get(`${e.from}->${e.to}`) ?? 0));
    }
    let vGap = (l) => Math.max(LAYOUT.V_GAP_MIN, (gapLabelH[l] ?? 0) + LAYOUT.V_LABEL_PAD), rowRy = [];
    for (let n of wf.nodes) {
      let l = levels.get(n.id) ?? 0;
      rowRy[l] = Math.max(rowRy[l] ?? 0, g(n.id).ry);
    }
    let rowY = [];
    for (let l = 0; l < nextLevel; l++) {
      let ry = rowRy[l] ?? 0;
      rowY[l] = l === 0 ? ry : rowY[l - 1] + (rowRy[l - 1] ?? 0) + vGap(l) + ry;
    }
    let ownW = (id) => g(id).rx * 2 + LAYOUT.H_GAP, bandCache = /* @__PURE__ */ new Map();
    function bandW(id, visiting = /* @__PURE__ */ new Set()) {
      if (bandCache.has(id)) return bandCache.get(id);
      if (visiting.has(id)) return ownW(id);
      visiting.add(id);
      let ch = childIds(id), w = Math.max(ownW(id), ch.reduce((s, c) => s + bandW(c, visiting), 0));
      return bandCache.set(id, w), w;
    }
    let nodePos = /* @__PURE__ */ new Map(), assigned = /* @__PURE__ */ new Set(), yOf = (id) => rowY[levels.get(id) ?? 0] ?? 0;
    function place(id, cx, allocW) {
      if (assigned.has(id)) return;
      assigned.add(id), nodePos.set(id, { x: cx, y: yOf(id) });
      let ch = childIds(id);
      if (ch.length === 0) return;
      let counts = ch.map((c) => bandW(c)), total = counts.reduce((a, b) => a + b, 0), startX = cx - allocW / 2;
      for (let i = 0; i < ch.length; i++) {
        let slotW = counts[i] / total * allocW;
        place(ch[i], startX + slotW / 2, slotW), startX += slotW;
      }
    }
    let cursor = 0;
    for (let id of roots) {
      let w = bandW(id);
      place(id, cursor + w / 2, w), cursor += w;
    }
    for (let n of wf.nodes)
      nodePos.has(n.id) || (nodePos.set(n.id, { x: cursor + ownW(n.id) / 2, y: yOf(n.id) }), cursor += ownW(n.id));
    function subtreeIds(id, visited = /* @__PURE__ */ new Set()) {
      if (visited.has(id)) return [];
      visited.add(id);
      let result = [id];
      for (let ch of childIds(id)) result.push(...subtreeIds(ch, visited));
      return result;
    }
    let convergent = wf.nodes.filter((n) => (parentEdges.get(n.id) ?? []).length > 1).sort((a, b) => (levels.get(b.id) ?? 0) - (levels.get(a.id) ?? 0));
    for (let n of convergent) {
      let placedParents = (parentEdges.get(n.id) ?? []).filter((pid) => nodePos.has(pid));
      if (placedParents.length < 2) continue;
      let avgX = placedParents.reduce((s, pid) => s + nodePos.get(pid).x, 0) / placedParents.length, cur = nodePos.get(n.id);
      if (!cur) continue;
      let delta = avgX - cur.x;
      if (!(Math.abs(delta) < 1))
        for (let descId of subtreeIds(n.id)) {
          let p = nodePos.get(descId);
          p && nodePos.set(descId, { ...p, x: p.x + delta });
        }
    }
    let nodesByLevel = /* @__PURE__ */ new Map();
    for (let n of wf.nodes) {
      let lvl = levels.get(n.id) ?? 0;
      nodesByLevel.has(lvl) || nodesByLevel.set(lvl, []), nodesByLevel.get(lvl).push(n.id);
    }
    for (let ids of nodesByLevel.values())
      if (!(ids.length < 2)) {
        ids.sort((a, b) => (nodePos.get(a)?.x ?? 0) - (nodePos.get(b)?.x ?? 0));
        for (let iter = 0; iter < 20; iter++) {
          let moved = !1;
          for (let i = 0; i < ids.length - 1; i++) {
            let pa = nodePos.get(ids[i]), pb = nodePos.get(ids[i + 1]), need = g(ids[i]).rx + g(ids[i + 1]).rx + LAYOUT.H_GAP, gap = pb.x - pa.x;
            if (gap < need - 0.5) {
              let half = (need - gap) / 2;
              nodePos.set(ids[i], { ...pa, x: pa.x - half }), nodePos.set(ids[i + 1], { ...pb, x: pb.x + half }), moved = !0;
            }
          }
          if (!moved) break;
        }
      }
    let minX = 1 / 0, maxX = -1 / 0, maxY = 0;
    for (let n of wf.nodes) {
      let p = nodePos.get(n.id);
      minX = Math.min(minX, p.x - g(n.id).rx), maxX = Math.max(maxX, p.x + g(n.id).rx), maxY = Math.max(maxY, p.y + g(n.id).ry);
    }
    wf.nodes.length || (minX = 0, maxX = 0);
    let tileW = maxX - minX + LAYOUT.MARGIN_X * 2, titleW = (opts.titleW ?? 0) + 24, shiftX = LAYOUT.MARGIN_X - minX + Math.max(0, (titleW - tileW) / 2);
    tileW = Math.max(tileW, titleW);
    for (let [id, p] of nodePos) nodePos.set(id, { x: p.x + shiftX, y: p.y + LAYOUT.TOP });
    return { nodePos, geom, tileW, tileH: LAYOUT.TOP + maxY + LAYOUT.BOT };
  }
  var UI_FONT = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif', MOUSE_EFFECT_SCALE = 0.3, MOUSE_EFFECT_RADIUS = 60, KBCanvasRenderer = class {
    constructor(opts) {
      // Camera
      this.cam = { x: 0, y: 0 };
      this.scale = 1;
      this.SCALE_MIN = 0.3;
      this.SCALE_MAX = 2;
      this.dragging = !1;
      this.dragStart = { x: 0, y: 0 };
      this.dragCamStart = { x: 0, y: 0 };
      // Camera animation targets (lerped toward each frame)
      this.targetCam = { x: 0, y: 0 };
      this.targetScale = 1;
      this.homeCam = { x: 0, y: 0 };
      this.homeScale = 1;
      // Mouse
      this.mouse = { x: -9999, y: -9999 };
      // Extension: viewport size in CSS pixels. The backing store is
      // devicePixelRatio× larger so the canvas stays sharp on scaled displays.
      this.viewW = 0;
      this.viewH = 0;
      this.dpr = 1;
      this.hoveredNode = null;
      // Animation
      this.animT = 0;
      this.rafId = 0;
      // Highlighted workflow IDs (from search) – empty = all visible
      this.highlighted = /* @__PURE__ */ new Set();
      // Search animation state
      this.driftTargets = /* @__PURE__ */ new Map();
      this.driftCurrent = /* @__PURE__ */ new Map();
      this.searchPullCenter = null;
      // Workflow render positions (computed from grid)
      this.positions = /* @__PURE__ */ new Map();
      // Flat theme: repaint only when the frame would differ (DESIGN.md "cheap
      // when idle"). Versions bump on changes the key can't see directly.
      this.lastFrameKey = "";
      this.lastFrameWfs = null;
      this.highlightVersion = 0;
      this.layoutVersion = 0;
      // ── Tile packing ────────────────────────────────────────────────────────────
      // 0.4.1: tiles are packed left to right in rows as wide as the viewport (at
      // 100 % zoom), instead of two fixed columns as wide as the widest tile
      // (~1000 px apart, one per screen). Rows are as tall as their tallest tile.
      this.GRID = { padX: 60, padTop: 80, gapX: 56, gapY: 64 };
      this.MM = { w: 120, h: 90, margin: 14 };
      // ── Per-workflow layout cache ──────────────────────────────────────────────
      // Node sizes depend on the theme's font, so the cache is per theme.
      this.layoutCache = /* @__PURE__ */ new Map();
      this.layoutTheme = null;
      this.onMouseDown = (e) => {
        this.dragging = !0, this.dragStart = { x: e.clientX, y: e.clientY }, this.dragCamStart = { ...this.cam }, this.targetCam = { ...this.cam }, this.targetScale = this.scale, this.canvas.style.cursor = "grabbing";
      };
      this.onMouseMove = (e) => {
        let r = this.canvas.getBoundingClientRect();
        this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }, this.dragging && (this.cam.x = this.dragCamStart.x - (e.clientX - this.dragStart.x), this.cam.y = this.dragCamStart.y - (e.clientY - this.dragStart.y)), this.updateHovered();
      };
      this.onMouseUp = () => {
        this.dragging = !1, this.targetCam = { ...this.cam }, this.targetScale = this.scale, this.canvas.style.cursor = this.hoveredNode ? "pointer" : "grab";
      };
      this.onWheel = (e) => {
        e.preventDefault();
        let factor = e.deltaY > 0 ? 0.9 : 1.1, newScale = Math.min(this.SCALE_MAX, Math.max(this.SCALE_MIN, this.scale * factor));
        if (newScale === this.scale) return;
        let r = this.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, wx = (mx + this.cam.x) / this.scale, wy = (my + this.cam.y) / this.scale;
        this.scale = newScale, this.cam.x = wx * this.scale - mx, this.cam.y = wy * this.scale - my, this.targetScale = this.scale, this.targetCam = { ...this.cam };
      };
      this.onClick = (e) => {
        Math.abs(e.clientX - this.dragStart.x) > 4 || Math.abs(e.clientY - this.dragStart.y) > 4 || this.hoveredNode && this.opts.onNodeClick(this.hoveredNode.wfId, this.hoveredNode.nodeIdx);
      };
      this.onDblClick = (e) => {
        Math.abs(e.clientX - this.dragStart.x) > 4 || Math.abs(e.clientY - this.dragStart.y) > 4 || this.hoveredNode && this.opts.onNodeDoubleClick && this.opts.onNodeDoubleClick(this.hoveredNode.wfId, this.hoveredNode.nodeIdx);
      };
      this.opts = opts, this.canvas = opts.canvas;
      let ctx = this.canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get 2D context");
      this.ctx = ctx, this.attachEvents();
    }
    labelFont() {
      return this.isFlat() ? `${12}px ${FLAT_TOKENS.font}` : `500 ${12}px ${UI_FONT}`;
    }
    edgeLabelFont() {
      return `${EDGE_LABEL_FONT_PX}px ${this.uiFont()}`;
    }
    titleFont() {
      return `700 13px ${this.uiFont()}`;
    }
    // Text width in a font; an estimate where the context can't measure (jsdom).
    measurer(font) {
      let ctx = this.ctx;
      return typeof ctx.measureText != "function" ? estimateMeasure(parseFloat(font.replace(/^\d{3} /, "")) || 12) : (t) => (ctx.font = font, ctx.measureText(t).width);
    }
    // Drop cached layouts after a theme switch (different font, node sizes).
    syncLayoutTheme() {
      let theme = this.isFlat() ? "flat" : "organic";
      theme !== this.layoutTheme && (this.layoutCache.clear(), this.layoutTheme = theme, this.layoutVersion++);
    }
    getLayout(wf) {
      this.syncLayoutTheme();
      let layout = this.layoutCache.get(wf.id);
      if (!layout) {
        let measureNode = this.measurer(this.labelFont()), geom = new Map(wf.nodes.map((n) => [n.id, nodeGeometry(n, measureNode)])), measureEdge = this.measurer(this.edgeLabelFont()), edgeLabelH = /* @__PURE__ */ new Map();
        for (let e of wf.edges)
          for (let lang of ["en", "de"]) {
            let lines = edgeLabelLines((e.label?.[lang] ?? "").trim(), measureEdge).length, key = `${e.from}->${e.to}`;
            lines && edgeLabelH.set(key, Math.max(edgeLabelH.get(key) ?? 0, lines * EDGE_LABEL_LINE_H + 8));
          }
        let measureTitle = this.measurer(this.titleFont()), titleW = Math.max(measureTitle(wf.title.en ?? ""), measureTitle(wf.title.de ?? ""));
        layout = buildWorkflowLayout(wf, geom, { edgeLabelH, titleW }), this.layoutCache.set(wf.id, layout);
      }
      return layout;
    }
    invalidateLayout(wfId) {
      wfId ? this.layoutCache.delete(wfId) : this.layoutCache.clear(), this.layoutVersion++;
    }
    nodePos(wf, nodeId) {
      return this.getLayout(wf).nodePos.get(nodeId) ?? { x: 0, y: 0 };
    }
    nodeGeom(wf, nodeId) {
      return this.getLayout(wf).geom.get(nodeId) ?? { rx: 28, ry: 28, lines: { en: [], de: [] } };
    }
    // Shelf packing: left to right, a new row when the next tile would pass
    // rowLimit. Used for the grid and (0.4.2) for the search cluster.
    pack(wfs, origin) {
      let { padX, gapX, gapY } = this.GRID, maxTileW = wfs.reduce((m, wf) => Math.max(m, this.getLayout(wf).tileW), 0), rowLimit = Math.max(maxTileW, (this.viewW || 1400) - padX * 2), out = /* @__PURE__ */ new Map(), x = origin.x, y = origin.y, rowH = 0;
      for (let wf of wfs) {
        let { tileW, tileH } = this.getLayout(wf);
        x > origin.x && x - origin.x + tileW > rowLimit && (x = origin.x, y += rowH + gapY, rowH = 0), out.set(wf.id, { x, y }), x += tileW + gapX, rowH = Math.max(rowH, tileH);
      }
      return out;
    }
    computePositions() {
      let wfs = this.opts.getWorkflows();
      this.positions = this.pack(wfs, { x: this.GRID.padX, y: this.GRID.padTop });
    }
    getPosition(wfId) {
      return this.positions.get(wfId) ?? { x: 0, y: 0 };
    }
    getEffectivePosition(wfId) {
      let base = this.getPosition(wfId), drift = this.driftCurrent.get(wfId) ?? { x: 0, y: 0 };
      return { x: base.x + drift.x, y: base.y + drift.y };
    }
    getNodePosition(wfId, nodeIdx) {
      let pos = this.getEffectivePosition(wfId), wf = this.opts.getWorkflows().find((w) => w.id === wfId), nodeId = wf?.nodes[nodeIdx]?.id ?? "", local = wf ? this.nodePos(wf, nodeId) : { x: 0, y: 0 };
      return { x: pos.x + local.x, y: pos.y + local.y };
    }
    // ── Search animation ─────────────────────────────────────────────────────────
    setHighlighted(ids) {
      this.highlightVersion++;
      let wasEmpty = this.highlighted.size === 0;
      this.highlighted = ids;
      let wfs = this.opts.getWorkflows();
      if (this.resize(), this.computePositions(), ids.size === 0) {
        wfs.forEach((wf) => this.driftTargets.set(wf.id, { x: 0, y: 0 })), this.targetCam = { ...this.homeCam }, this.targetScale = this.homeScale, this.searchPullCenter = null;
        return;
      }
      wasEmpty && (this.homeCam = { ...this.cam }, this.homeScale = this.scale);
      let matching = wfs.filter((wf) => ids.has(wf.id)), nonMatching = wfs.filter((wf) => !ids.has(wf.id)), firstBase = this.getPosition(matching[0]?.id ?? ""), packed = this.pack(matching, firstBase), minX = 1 / 0, minY = 1 / 0, maxX = -1 / 0, maxY = -1 / 0;
      matching.forEach((wf) => {
        let base = this.getPosition(wf.id), p = packed.get(wf.id) ?? base;
        this.driftTargets.set(wf.id, { x: p.x - base.x, y: p.y - base.y });
        let { tileH, tileW } = this.getLayout(wf);
        minX = Math.min(minX, p.x), minY = Math.min(minY, p.y - 30), maxX = Math.max(maxX, p.x + tileW), maxY = Math.max(maxY, p.y + tileH);
      });
      let clusterCx = (minX + maxX) / 2, clusterCy = (minY + maxY) / 2;
      this.searchPullCenter = { x: clusterCx, y: clusterCy };
      let fitPad = 80, cW = this.viewW || 800, cH = this.viewH || 600, newScale = Math.min(
        this.SCALE_MAX,
        Math.max(this.SCALE_MIN, Math.min(
          (cW - fitPad * 2) / (maxX - minX),
          (cH - fitPad * 2) / (maxY - minY)
        ))
      );
      this.targetScale = newScale, this.targetCam = { x: clusterCx * newScale - cW / 2, y: clusterCy * newScale - cH / 2 };
      let MARGIN2 = 60, view = {
        minX: clusterCx - cW / 2 / newScale - MARGIN2,
        maxX: clusterCx + cW / 2 / newScale + MARGIN2,
        minY: clusterCy - cH / 2 / newScale - MARGIN2,
        maxY: clusterCy + cH / 2 / newScale + MARGIN2
      };
      nonMatching.forEach((wf) => {
        let p = this.getPosition(wf.id), { tileW, tileH } = this.getLayout(wf), dx = p.x + tileW / 2 - clusterCx, dy = p.y + tileH / 2 - clusterCy, dist = Math.hypot(dx, dy);
        dist < 1 ? (dx = 0, dy = 1) : (dx /= dist, dy /= dist);
        let tx = dx > 1e-6 ? (view.maxX - p.x) / dx : dx < -1e-6 ? (view.minX - (p.x + tileW)) / dx : 1 / 0, ty = dy > 1e-6 ? (view.maxY - (p.y - 30)) / dy : dy < -1e-6 ? (view.minY - (p.y + tileH)) / dy : 1 / 0, t = Math.max(0, Math.min(tx, ty));
        this.driftTargets.set(wf.id, { x: dx * t, y: dy * t });
      });
    }
    lerpState(t = 0.08) {
      this.dragging || (this.scale += (this.targetScale - this.scale) * t, Math.abs(this.targetScale - this.scale) < 1e-3 && (this.scale = this.targetScale), this.cam.x += (this.targetCam.x - this.cam.x) * t, this.cam.y += (this.targetCam.y - this.cam.y) * t, Math.abs(this.targetCam.x - this.cam.x) < 0.5 && (this.cam.x = this.targetCam.x), Math.abs(this.targetCam.y - this.cam.y) < 0.5 && (this.cam.y = this.targetCam.y)), this.driftTargets.forEach((target, id) => {
        let cur = this.driftCurrent.get(id) ?? { x: 0, y: 0 };
        cur.x += (target.x - cur.x) * t, cur.y += (target.y - cur.y) * t, Math.abs(target.x - cur.x) < 0.5 && (cur.x = target.x), Math.abs(target.y - cur.y) < 0.5 && (cur.y = target.y), this.driftCurrent.set(id, cur);
      });
    }
    // ── Event handling ───────────────────────────────────────────────────────────
    attachEvents() {
      this.canvas.addEventListener("mousedown", this.onMouseDown), window.addEventListener("mousemove", this.onMouseMove), window.addEventListener("mouseup", this.onMouseUp), this.canvas.addEventListener("click", this.onClick), this.canvas.addEventListener("dblclick", this.onDblClick), this.canvas.addEventListener("wheel", this.onWheel, { passive: !1 });
    }
    detachEvents() {
      this.canvas.removeEventListener("mousedown", this.onMouseDown), window.removeEventListener("mousemove", this.onMouseMove), window.removeEventListener("mouseup", this.onMouseUp), this.canvas.removeEventListener("click", this.onClick), this.canvas.removeEventListener("dblclick", this.onDblClick), this.canvas.removeEventListener("wheel", this.onWheel), cancelAnimationFrame(this.rafId);
    }
    updateHovered() {
      let wfs = this.opts.getWorkflows();
      this.hoveredNode = null;
      for (let wf of wfs)
        for (let i = 0; i < wf.nodes.length; i++) {
          let np = this.getNodePosition(wf.id, i), sx = np.x * this.scale - this.cam.x, sy = np.y * this.scale - this.cam.y, dist = Math.hypot(sx - this.mouse.x, sy - this.mouse.y), g = this.nodeGeom(wf, wf.nodes[i].id);
          if (dist < (Math.max(g.rx, g.ry) + 6) * this.scale) {
            this.hoveredNode = { wfId: wf.id, nodeIdx: i }, this.canvas.style.cursor = "pointer";
            return;
          }
        }
      this.dragging || (this.canvas.style.cursor = "grab");
    }
    // ── Main loop ────────────────────────────────────────────────────────────────
    start() {
      let loop = (t) => {
        this.animT = t * 1e-3, this.render(), this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
    stop() {
      cancelAnimationFrame(this.rafId);
    }
    resize() {
      let r = this.canvas.parentElement?.getBoundingClientRect();
      if (r) {
        this.dpr = window.devicePixelRatio || 1, this.viewW = r.width, this.viewH = r.height;
        let bw = Math.round(r.width * this.dpr), bh = Math.round(r.height * this.dpr);
        this.canvas.width !== bw && (this.canvas.width = bw), this.canvas.height !== bh && (this.canvas.height = bh);
      }
    }
    mouseEffect() {
      return this.isFlat() || this.opts.getMouseEffect?.() === !1 ? 0 : MOUSE_EFFECT_SCALE;
    }
    isFlat() {
      return this.opts.getTheme?.() === "flat";
    }
    uiFont() {
      return this.isFlat() ? FLAT_TOKENS.font : UI_FONT;
    }
    nodeStyle(type) {
      if (this.isFlat()) {
        let c = nodeColors("flat", type);
        return { fill: c.fill, stroke: c.stroke, tc: c.text };
      }
      return NF[type] ?? NF.main;
    }
    // Flat theme: everything a frame depends on. Same key → skip the repaint.
    frameKey() {
      let h = this.hoveredNode;
      return [
        this.cam.x,
        this.cam.y,
        this.scale,
        this.viewW,
        this.viewH,
        this.dpr,
        h ? `${h.wfId}/${h.nodeIdx}` : "",
        this.highlightVersion,
        this.layoutVersion,
        this.opts.getLang()
      ].join("|");
    }
    // ── Render ───────────────────────────────────────────────────────────────────
    render() {
      let flat = this.isFlat();
      this.lerpState(flat ? 1 : 0.08), this.resize();
      let { ctx } = this, W = this.viewW, H = this.viewH, wfs = this.opts.getWorkflows();
      if (this.syncLayoutTheme(), flat) {
        let key = this.frameKey();
        if (key === this.lastFrameKey && wfs === this.lastFrameWfs) return;
        this.lastFrameKey = key, this.lastFrameWfs = wfs;
      } else
        this.lastFrameKey = "";
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0), ctx.clearRect(0, 0, W, H), ctx.fillStyle = flat ? FLAT_TOKENS.panelBg : "#07070f", ctx.fillRect(0, 0, W, H), this.computePositions(), ctx.save(), ctx.scale(this.scale, this.scale), ctx.translate(-this.cam.x / this.scale, -this.cam.y / this.scale), wfs.forEach((wf, i) => {
        let isHL = this.highlighted.size === 0 || this.highlighted.has(wf.id);
        ctx.globalAlpha = isHL ? 1 : 0.12;
        let pulse = Math.sin(this.animT * 1.6 + i * 1.3) * 0.5 + 0.5, pos = this.getEffectivePosition(wf.id), pull = isHL && this.searchPullCenter && !flat ? this.searchPullCenter : null, edgeColorMap = this.buildEdgeColorMap(wf), outR = (id, a) => {
          let node = wf.nodes.find((n) => n.id === id);
          return outlineDistance(this.nodeGeom(wf, id), a, node?.type === "diamond");
        }, TOTAL_SPREAD = 135 * Math.PI / 180, exitPts = /* @__PURE__ */ new Map(), exitAngles = /* @__PURE__ */ new Map(), entryPts = /* @__PURE__ */ new Map(), entryAngles = /* @__PURE__ */ new Map(), bySource = /* @__PURE__ */ new Map();
        for (let edge of wf.edges) {
          let list = bySource.get(edge.from) ?? [];
          list.push(edge), bySource.set(edge.from, list);
        }
        for (let [fromId, edges] of bySource) {
          let sp = this.nodePos(wf, fromId), scx = pos.x + sp.x, scy = pos.y + sp.y;
          if (edges.length === 1) {
            let ep = this.nodePos(wf, edges[0].to), a = Math.atan2(pos.y + ep.y - scy, pos.x + ep.x - scx), key = `${fromId}->${edges[0].to}`;
            exitPts.set(key, { x: scx + outR(fromId, a) * Math.cos(a), y: scy + outR(fromId, a) * Math.sin(a) }), exitAngles.set(key, a);
          } else {
            let ea = edges.map((e) => {
              let ep = this.nodePos(wf, e.to);
              return { key: `${fromId}->${e.to}`, naturalAngle: Math.atan2(pos.y + ep.y - scy, pos.x + ep.x - scx) };
            }).sort((a, b) => a.naturalAngle - b.naturalAngle), avgAngle = ea.reduce((s, e) => s + e.naturalAngle, 0) / ea.length, n = ea.length, step = n > 1 ? TOTAL_SPREAD / (n - 1) : 0;
            ea.forEach((item, idx) => {
              let a = avgAngle - TOTAL_SPREAD / 2 + idx * step;
              exitPts.set(item.key, { x: scx + outR(fromId, a) * Math.cos(a), y: scy + outR(fromId, a) * Math.sin(a) }), exitAngles.set(item.key, a);
            });
          }
        }
        for (let edge of wf.edges) {
          let sp = this.nodePos(wf, edge.from), ep = this.nodePos(wf, edge.to), scx = pos.x + sp.x, scy = pos.y + sp.y, ecx = pos.x + ep.x, ecy = pos.y + ep.y, a = Math.atan2(scy - ecy, scx - ecx), key = `${edge.from}->${edge.to}`;
          entryPts.set(key, { x: ecx + outR(edge.to, a) * Math.cos(a), y: ecy + outR(edge.to, a) * Math.sin(a) }), entryAngles.set(key, a);
        }
        let EDGE_SPINE_N = 10, edgeSpinePts = /* @__PURE__ */ new Map();
        for (let edge of wf.edges) {
          let key = `${edge.from}->${edge.to}`, sp = this.nodePos(wf, edge.from), ep = this.nodePos(wf, edge.to), p1 = exitPts.get(key) ?? this.perimeterPt(pos.x + sp.x, pos.y + sp.y, this.nodeGeom(wf, edge.from).ry, pos.x + ep.x, pos.y + ep.y), p2 = entryPts.get(key) ?? this.perimeterPt(pos.x + ep.x, pos.y + ep.y, this.nodeGeom(wf, edge.to).ry, pos.x + sp.x, pos.y + sp.y), exitA = exitAngles.get(key), entryA = entryAngles.get(key), x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y, dx = x2 - x1, dy = y2 - y1, tension = Math.hypot(dx, dy) * 0.38, cp1x = exitA !== void 0 ? x1 + Math.cos(exitA) * tension : x1 + dx / 3, cp1y = exitA !== void 0 ? y1 + Math.sin(exitA) * tension : y1 + dy / 3, cp2x = entryA !== void 0 ? x2 + Math.cos(entryA) * tension : x1 + 2 * dx / 3, cp2y = entryA !== void 0 ? y2 + Math.sin(entryA) * tension : y1 + 2 * dy / 3, pts = [];
          for (let s = 1; s < EDGE_SPINE_N; s++) {
            let t = s / EDGE_SPINE_N, mt = 1 - t;
            pts.push({
              x: mt * mt * mt * x1 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x2,
              y: mt * mt * mt * y1 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y2
            });
          }
          edgeSpinePts.set(key, pts);
        }
        wf.edges.forEach((edge, edgeIdx) => {
          let sp = this.nodePos(wf, edge.from), ep = this.nodePos(wf, edge.to);
          if (!sp || !ep) return;
          let key = `${edge.from}->${edge.to}`, p1 = exitPts.get(key) ?? this.perimeterPt(pos.x + sp.x, pos.y + sp.y, this.nodeGeom(wf, edge.from).ry, pos.x + ep.x, pos.y + ep.y), p2 = entryPts.get(key) ?? this.perimeterPt(pos.x + ep.x, pos.y + ep.y, this.nodeGeom(wf, edge.to).ry, pos.x + sp.x, pos.y + sp.y), color = flat ? edge.exception ? FLAT_TOKENS.noResultsText : FLAT_TOKENS.textSecondary : edge.exception ? "#E24B4A" : edgeColorMap.get(key) ?? wf.color, avoidPts = wf.nodes.filter((n) => n.id !== edge.from && n.id !== edge.to).map((n) => {
            let lp = this.nodePos(wf, n.id);
            return { x: pos.x + lp.x, y: pos.y + lp.y };
          }), otherEdgePts = wf.edges.filter((_, j) => j !== edgeIdx).flatMap((e) => edgeSpinePts.get(`${e.from}->${e.to}`) ?? []), edgePhase = edgeIdx * (Math.PI * 2 / 7);
          this.drawOrganicEdge(
            p1.x,
            p1.y,
            p2.x,
            p2.y,
            color,
            edge.exception,
            pulse,
            avoidPts,
            edgePhase,
            exitAngles.get(key),
            entryAngles.get(key),
            otherEdgePts
          );
        }), wf.nodes.forEach((node, ni) => {
          let lp = this.nodePos(wf, node.id), np = { x: pos.x + lp.x, y: pos.y + lp.y }, isHov = this.hoveredNode?.wfId === wf.id && this.hoveredNode?.nodeIdx === ni, nodePulse = Math.sin(this.animT * 1.3 + ni * 1.1) * 0.5 + 0.5;
          this.drawNode(np.x, np.y, node, this.nodeGeom(wf, node.id), isHov, nodePulse, pull);
        });
        let lang = this.opts.getLang(), midPts = /* @__PURE__ */ new Map();
        for (let [k, pts] of edgeSpinePts) pts[4] && midPts.set(k, pts[4]);
        this.drawEdgeLabels(wf, pos, lang, flat ? void 0 : edgeColorMap, midPts), ctx.save(), ctx.globalAlpha = isHL ? 1 : 0.12, ctx.font = this.titleFont(), ctx.textAlign = "center", ctx.textBaseline = "bottom", ctx.strokeStyle = flat ? FLAT_TOKENS.panelBg : "rgba(7,7,15,0.85)", ctx.lineWidth = 3, ctx.lineJoin = "round";
        let titleX = pos.x + this.getLayout(wf).tileW / 2;
        ctx.strokeText(wf.title[lang], titleX, pos.y - 10), ctx.fillStyle = flat ? FLAT_TOKENS.text : wf.color, ctx.fillText(wf.title[lang], titleX, pos.y - 10), ctx.restore(), ctx.globalAlpha = 1;
      }), ctx.restore(), this.drawMinimap(wfs), wfs.length === 0 && (ctx.save(), ctx.fillStyle = "#333", ctx.font = `13px ${this.uiFont()}`, ctx.textAlign = "center", ctx.textBaseline = "middle", ctx.fillText("No workflows loaded", W / 2, H / 2), ctx.restore());
    }
    // ── Draw helpers (identical to prototype) ───────────────────────────────────
    // ── Edge label drawing ────────────────────────────────────────────────────────
    // 0.4.1: each label starts centred on its edge's midpoint (it used to sit a
    // fixed 58 px from the source, so a fan's labels bunched up by the decision),
    // then a separation pass pushes it off other labels AND off nodes. A thin
    // connector links a moved label back to its edge.
    drawEdgeLabels(wf, pos, lang, edgeColorMap, midPts) {
      let { ctx } = this, flat = this.isFlat(), FONT = this.edgeLabelFont(), LINE_H = EDGE_LABEL_LINE_H, PAD_X = 6, PAD_Y = 4, GAP2 = 8, NODE_GAP = 6, measure = this.measurer(FONT), fade = ctx.globalAlpha, boxes = [];
      wf.edges.forEach((edge) => {
        if (!edge.label) return;
        let raw = (edge.label[lang] ?? "").trim();
        if (!raw) return;
        let key = `${edge.from}->${edge.to}`, mid = midPts.get(key);
        if (!mid) {
          let a = this.nodePos(wf, edge.from), b = this.nodePos(wf, edge.to);
          mid = { x: pos.x + (a.x + b.x) / 2, y: pos.y + (a.y + b.y) / 2 };
        }
        let color = flat ? edge.exception ? FLAT_TOKENS.noResultsText : FLAT_TOKENS.textSecondary : edge.exception ? "#E24B4A" : edgeColorMap?.get(key) ?? wf.color, lines = edgeLabelLines(raw, measure), maxW = Math.max(...lines.map(measure));
        boxes.push({
          lines,
          cx: mid.x,
          cy: mid.y,
          ax: mid.x,
          ay: mid.y,
          hw: maxW / 2 + PAD_X,
          hh: lines.length * LINE_H / 2 + PAD_Y,
          color
        });
      });
      let nodeBoxes = wf.nodes.map((n) => {
        let p = this.nodePos(wf, n.id), g = this.nodeGeom(wf, n.id);
        return { cx: pos.x + p.x, cy: pos.y + p.y, hw: g.rx, hh: g.ry };
      }), push = (A, B, gap, share) => {
        let overlapX = A.hw + B.hw + gap - Math.abs(A.cx - B.cx), overlapY = A.hh + B.hh + gap - Math.abs(A.cy - B.cy);
        if (overlapX <= 0 || overlapY <= 0) return !1;
        if (overlapX < overlapY) {
          let d = (A.cx >= B.cx ? 1 : -1) * (overlapX * share + 0.5);
          A.cx += d, share < 1 && (B.cx -= d);
        } else {
          let d = (A.cy >= B.cy ? 1 : -1) * (overlapY * share + 0.5);
          A.cy += d, share < 1 && (B.cy -= d);
        }
        return !0;
      };
      for (let iter = 0; iter < 24; iter++) {
        let moved = !1;
        for (let a = 0; a < boxes.length; a++) {
          for (let b = a + 1; b < boxes.length; b++)
            push(boxes[a], boxes[b], GAP2, 0.5) && (moved = !0);
          for (let nb of nodeBoxes)
            push(boxes[a], nb, NODE_GAP, 1) && (moved = !0);
        }
        if (!moved) break;
      }
      ctx.save(), ctx.globalAlpha = fade, ctx.font = FONT, ctx.textAlign = "center", ctx.textBaseline = "middle";
      for (let box of boxes) {
        let { lines, cx, cy, ax, ay, hw, hh, color } = box;
        Math.hypot(cx - ax, cy - ay) > hh && (ctx.beginPath(), ctx.moveTo(ax, ay), ctx.lineTo(cx, cy), ctx.strokeStyle = color, ctx.globalAlpha = 0.35 * fade, ctx.lineWidth = 0.8, ctx.setLineDash([]), ctx.stroke(), ctx.globalAlpha = fade), ctx.beginPath(), ctx.roundRect(cx - hw, cy - hh, hw * 2, hh * 2, 3), ctx.fillStyle = flat ? FLAT_TOKENS.rowBg : "rgba(7,7,15,0.92)", ctx.fill(), ctx.strokeStyle = flat ? FLAT_TOKENS.rowBorder : color, ctx.globalAlpha = (flat ? 1 : 0.5) * fade, ctx.lineWidth = flat ? 1 : 0.8, ctx.stroke(), ctx.globalAlpha = fade, ctx.fillStyle = flat && color === FLAT_TOKENS.textSecondary ? FLAT_TOKENS.text : color;
        let totalH = lines.length * LINE_H;
        lines.forEach((line, i) => {
          ctx.fillText(line, cx, cy - totalH / 2 + LINE_H * i + LINE_H / 2);
        });
      }
      ctx.restore();
    }
    drawOrganicEdge(x1, y1, x2, y2, color, dashed, pulse, avoid = [], edgePhase = 0, exitAngle, entryAngle, avoidEdges = []) {
      let { ctx } = this, fade = ctx.globalAlpha, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      if (len < 1) return;
      let steps = Math.max(32, Math.floor(len / 4)), flat = this.isFlat(), wave = flat ? 0 : (1.5 + pulse * 0.8) * Math.sin(this.animT * 0.5 + len * 0.02), tension = len * 0.38, cp1x = exitAngle !== void 0 ? x1 + Math.cos(exitAngle) * tension : x1 + dx / 3, cp1y = exitAngle !== void 0 ? y1 + Math.sin(exitAngle) * tension : y1 + dy / 3, cp2x = entryAngle !== void 0 ? x2 + Math.cos(entryAngle) * tension : x1 + 2 * dx / 3, cp2y = entryAngle !== void 0 ? y2 + Math.sin(entryAngle) * tension : y1 + 2 * dy / 3, mwx = (this.mouse.x + this.cam.x) / this.scale, mwy = (this.mouse.y + this.cam.y) / this.scale, AVOID_R = 52, mouseK = this.mouseEffect(), bez = (t) => {
        let mt = 1 - t;
        return {
          x: mt * mt * mt * x1 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x2,
          y: mt * mt * mt * y1 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y2
        };
      }, bezT = (t) => {
        let mt = 1 - t;
        return {
          x: 3 * mt * mt * (cp1x - x1) + 6 * mt * t * (cp2x - cp1x) + 3 * t * t * (x2 - cp2x),
          y: 3 * mt * mt * (cp1y - y1) + 6 * mt * t * (cp2y - cp1y) + 3 * t * t * (y2 - cp2y)
        };
      };
      ctx.save(), ctx.lineWidth = dashed ? 1 : 1.4, ctx.lineCap = "round", ctx.setLineDash(dashed ? [5, 4] : []);
      let lastX = x1, lastY = y1, prevX = x1, prevY = y1;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        let t = i / steps, b = bez(t), bt = bezT(t), tl = Math.hypot(bt.x, bt.y) || 1, nx = -bt.y / tl, ny = bt.x / tl, dm = Math.hypot(b.x - mwx, b.y - mwy), mr = Math.max(0, 1 - dm / MOUSE_EFFECT_RADIUS) * 10 * mouseK, mdx = (b.x - mwx) / (dm + 1), mdy = (b.y - mwy) / (dm + 1), wo = Math.sin(t * Math.PI * 3 + this.animT * 2 + edgePhase) * wave * Math.sin(t * Math.PI), rnx = 0, rny = 0;
        for (let av of avoid) {
          let da = Math.hypot(b.x - av.x, b.y - av.y);
          if (da < AVOID_R && da > 0) {
            let str2 = (1 - da / AVOID_R) * 24;
            rnx += (b.x - av.x) / da * str2, rny += (b.y - av.y) / da * str2;
          }
        }
        let EDGE_AVOID_R = 10;
        for (let av of avoidEdges) {
          let da = Math.hypot(b.x - av.x, b.y - av.y);
          if (da < EDGE_AVOID_R && da > 0) {
            let str2 = (1 - da / EDGE_AVOID_R) * 4;
            rnx += (b.x - av.x) / da * str2, rny += (b.y - av.y) / da * str2;
          }
        }
        let px = b.x + nx * wo + mdx * mr + rnx, py = b.y + ny * wo + mdy * mr + rny;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py), prevX = lastX, prevY = lastY, lastX = px, lastY = py;
      }
      if (flat) {
        ctx.strokeStyle = color, ctx.lineWidth = 1.5, ctx.stroke();
        let a = Math.atan2(lastY - prevY, lastX - prevX);
        ctx.setLineDash([]), ctx.beginPath(), ctx.moveTo(lastX, lastY), ctx.lineTo(lastX - 8 * Math.cos(a - 0.4), lastY - 8 * Math.sin(a - 0.4)), ctx.lineTo(lastX - 8 * Math.cos(a + 0.4), lastY - 8 * Math.sin(a + 0.4)), ctx.closePath(), ctx.fillStyle = color, ctx.fill(), ctx.restore();
        return;
      }
      if (dashed)
        ctx.strokeStyle = color, ctx.globalAlpha = 0.5 * fade;
      else {
        let rgb = this.hexToRgb(color), grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, `rgba(${rgb},0.25)`), grad.addColorStop(0.5, `rgba(${rgb},0.85)`), grad.addColorStop(1, `rgba(${rgb},0.25)`), ctx.strokeStyle = grad, ctx.globalAlpha = 0.85 * fade;
      }
      ctx.stroke();
      let dotCount = Math.floor(len / 26);
      for (let d = 0; d < dotCount; d++) {
        let dt = ((d / dotCount + this.animT * (12 / len) * (dashed ? -1 : 1)) % 1 + 1) % 1, b = bez(dt), bt = bezT(dt), tl = Math.hypot(bt.x, bt.y) || 1, nx = -bt.y / tl, ny = bt.x / tl, wo = Math.sin(dt * Math.PI * 3 + this.animT * 2 + edgePhase) * wave * Math.sin(dt * Math.PI);
        ctx.beginPath(), ctx.arc(b.x + nx * wo, b.y + ny * wo, dashed ? 1.3 : 1.8, 0, Math.PI * 2), ctx.fillStyle = color, ctx.globalAlpha = (dashed ? 0.35 : 0.65) * fade, ctx.fill();
      }
      ctx.restore();
    }
    drawNode(x, y, node, geom, hovered, pulse, gravPull = null) {
      let { ctx } = this, fade = ctx.globalAlpha, flat = this.isFlat(), style = this.nodeStyle(node.type), breathe = flat ? 0 : Math.sin(this.animT * 1.3 + x * 0.04 + y * 0.03) * 2, r = geom.ry + breathe, mwx = (this.mouse.x + this.cam.x) / this.scale, mwy = (this.mouse.y + this.cam.y) / this.scale, dm = Math.hypot(x - mwx, y - mwy), mr = Math.max(0, 1 - dm / MOUSE_EFFECT_RADIUS) * 4 * this.mouseEffect(), rx = x + (mwx - x) / (dm + 1) * mr, ry = y + (mwy - y) / (dm + 1) * mr;
      if (gravPull) {
        let gdx = gravPull.x - x, gdy = gravPull.y - y, gdist = Math.hypot(gdx, gdy) || 1, strength = Math.sin(this.animT * 0.9 + x * 8e-3) * 3 + 4;
        rx += gdx / gdist * strength, ry += gdy / gdist * strength;
      }
      if (ctx.save(), ctx.shadowBlur = flat ? 0 : hovered ? 30 : 12, ctx.shadowColor = style.stroke, node.type === "diamond") {
        let s = r + 2;
        ctx.beginPath(), ctx.moveTo(rx, ry - s), ctx.lineTo(rx + s * 0.85, ry), ctx.lineTo(rx, ry + s), ctx.lineTo(rx - s * 0.85, ry), ctx.closePath();
      } else
        ctx.beginPath(), ctx.arc(rx, ry, r + (hovered && !flat ? 4 : 0), 0, Math.PI * 2);
      ctx.fillStyle = style.fill, ctx.fill(), ctx.strokeStyle = style.stroke, ctx.lineWidth = flat ? hovered ? 3 : 1.5 : hovered ? 2 : 1, ctx.stroke(), hovered && !flat && (ctx.globalAlpha = 0.2 * fade, ctx.beginPath(), ctx.arc(rx, ry, r + 14, 0, Math.PI * 2), ctx.stroke()), ctx.restore();
      let lang = this.opts.getLang();
      ctx.save(), ctx.font = this.labelFont(), ctx.textAlign = "center", ctx.textBaseline = "middle", ctx.globalAlpha = (hovered || flat ? 1 : 0.95) * fade, ctx.fillStyle = style.tc, ctx.shadowColor = "rgba(0,0,0,0.95)", ctx.shadowBlur = flat ? 0 : 4;
      let lines = geom.lines[lang].length ? geom.lines[lang] : geom.lines.en;
      lines.forEach((line, i) => {
        ctx.fillText(line, rx, ry + (i - (lines.length - 1) / 2) * 14);
      }), ctx.restore();
    }
    // ── Minimap ──────────────────────────────────────────────────────────────────
    drawMinimap(wfs) {
      if (wfs.length === 0) return;
      let { ctx } = this, W = this.viewW, H = this.viewH, { w, h, margin } = this.MM, mx = W - margin - w, my = margin, minX = 1 / 0, minY = 1 / 0, maxX = -1 / 0, maxY = -1 / 0;
      wfs.forEach((wf) => {
        let pos = this.getPosition(wf.id);
        pos.x < minX && (minX = pos.x), pos.y < minY && (minY = pos.y), pos.x + this.getLayout(wf).tileW > maxX && (maxX = pos.x + this.getLayout(wf).tileW), pos.y + this.getLayout(wf).tileH > maxY && (maxY = pos.y + this.getLayout(wf).tileH);
      });
      let pad = 30;
      minX -= pad, minY -= pad, maxX += pad, maxY += pad;
      let worldW = maxX - minX, worldH = maxY - minY, mmScale = Math.min(w / worldW, h / worldH), offX = mx + (w - worldW * mmScale) / 2, offY = my + (h - worldH * mmScale) / 2, toMM = (wx, wy) => ({
        x: offX + (wx - minX) * mmScale,
        y: offY + (wy - minY) * mmScale
      }), flat = this.isFlat();
      ctx.save(), ctx.fillStyle = flat ? FLAT_TOKENS.panelBg : "rgba(7,7,15,0.82)", ctx.strokeStyle = flat ? FLAT_TOKENS.panelBorder : "rgba(127,119,221,0.22)", ctx.lineWidth = 1, ctx.beginPath(), ctx.roundRect(mx, my, w, h, 4), ctx.fill(), ctx.stroke(), ctx.beginPath(), ctx.rect(mx, my, w, h), ctx.clip(), wfs.forEach((wf) => {
        let pos = this.getEffectivePosition(wf.id), isHL = this.highlighted.size === 0 || this.highlighted.has(wf.id), { nodePos, tileH, tileW } = this.getLayout(wf), tl = toMM(pos.x, pos.y), tw = tileW * mmScale, th = tileH * mmScale;
        ctx.globalAlpha = isHL ? 0.7 : 0.18, ctx.fillStyle = flat ? FLAT_TOKENS.rowBg : wf.color + "22", ctx.strokeStyle = flat ? FLAT_TOKENS.rowBorder : wf.color, ctx.lineWidth = 0.5, ctx.beginPath(), ctx.roundRect(tl.x, tl.y, tw, th, 2), ctx.fill(), ctx.stroke(), wf.nodes.forEach((node) => {
          let np = nodePos.get(node.id);
          if (!np) return;
          let style = this.nodeStyle(node.type), dp = toMM(pos.x + np.x, pos.y + np.y);
          ctx.globalAlpha = isHL ? 0.85 : 0.18, ctx.fillStyle = style.stroke, ctx.beginPath(), ctx.arc(dp.x, dp.y, 2, 0, Math.PI * 2), ctx.fill();
        });
      }), ctx.globalAlpha = 1;
      let vpTL = toMM(this.cam.x / this.scale, this.cam.y / this.scale), vpBR = toMM((this.cam.x + W) / this.scale, (this.cam.y + H) / this.scale);
      ctx.fillStyle = flat ? "rgba(0,123,255,0.12)" : "rgba(255,255,255,0.06)", ctx.strokeStyle = flat ? FLAT_TOKENS.accent : "rgba(255,255,255,0.45)", ctx.lineWidth = 1, ctx.beginPath(), ctx.rect(vpTL.x, vpTL.y, vpBR.x - vpTL.x, vpBR.y - vpTL.y), ctx.fill(), ctx.stroke(), ctx.restore();
    }
    hexToRgb(hex) {
      let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return `${r},${g},${b}`;
    }
    // Returns the point on a circle's perimeter (radius r, centre cx/cy)
    // that faces toward target (tx, ty).
    perimeterPt(cx, cy, r, tx, ty) {
      let angle = Math.atan2(ty - cy, tx - cx);
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }
    hexToHsl(hex) {
      let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2;
      if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min), max === r ? h = ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? h = ((b - r) / d + 2) / 6 : h = ((r - g) / d + 4) / 6;
      }
      return { h: h * 360, s: s * 100, l: l * 100 };
    }
    hslToHex(h, s, l) {
      s /= 100, l /= 100;
      let a = s * Math.min(l, 1 - l), f = (n) => {
        let k = (n + h / 30) % 12, color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, "0");
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    }
    // Assigns globally distinct hue-shifted colors across all normal edges in the
    // workflow. Colors are spread evenly around the hue wheel so that adjacent
    // edges from different nodes don't accidentally share the same color.
    // Exception edges always remain red.
    buildEdgeColorMap(wf) {
      let map = /* @__PURE__ */ new Map(), normalEdges = wf.edges.filter((e) => !e.exception);
      if (normalEdges.length === 0) return map;
      let { h, s, l } = this.hexToHsl(wf.color), step = 360 / normalEdges.length;
      return normalEdges.forEach((edge, i) => {
        let hue = (h + i * step) % 360;
        map.set(`${edge.from}->${edge.to}`, this.hslToHex(hue, Math.min(s + 12, 100), Math.min(l + 6, 88)));
      }), map;
    }
  };

  // src/search-panel.ts
  var SearchPanel = class {
    constructor(container, plugin, onResults) {
      this.isOpen = !1;
      this.debounceTimer = 0;
      this.textarea = null;
      this.container = container, this.plugin = plugin, this.onResults = onResults, this.build();
    }
    build() {
      this.container.style.cssText = `
      position:absolute;bottom:60px;right:16px;z-index:30;
    `;
      let toggleBtn = this.container.createDiv({ cls: "wkb-search-toggle" });
      toggleBtn.style.cssText = `
      width:40px;height:40px;border-radius:50%;background:#1a1a2e;
      border:1px solid #3a3a5e;display:flex;align-items:center;justify-content:center;
      cursor:pointer;transition:all .25s;margin-left:auto;
    `, toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7F77DD" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>', toggleBtn.addEventListener("click", () => this.toggle());
      let panel = this.container.createDiv({ cls: "wkb-search-panel" });
      panel.style.cssText = `
      background:rgba(12,12,24,.96);border:0.5px solid #2a2a44;border-radius:14px;
      width:260px;margin-top:8px;overflow:hidden;
      transform-origin:bottom right;transform:scale(.92) translateY(8px);
      opacity:0;pointer-events:none;transition:all .28s cubic-bezier(.4,0,.2,1);
    `;
      let inner = panel.createDiv();
      inner.style.cssText = "padding:12px";
      let lbl = inner.createDiv({ cls: "wkb-search-label" });
      lbl.style.cssText = "font-size:10px;color:#555;letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px", lbl.textContent = this.plugin.settings.lang === "en" ? "Search workflows" : "Workflows suchen";
      let textarea = inner.createEl("textarea");
      this.textarea = textarea, textarea.style.cssText = `
      width:100%;background:#111122;border:0.5px solid #2a2a44;border-radius:8px;
      padding:7px 9px;font-size:12px;color:#bbb;font-family:inherit;
      resize:none;min-height:48px;line-height:1.6;outline:none;
    `, textarea.placeholder = this.plugin.settings.lang === "en" ? `booking
2e` : `buchung
2f`, textarea.addEventListener("input", () => {
        clearTimeout(this.debounceTimer), this.debounceTimer = window.setTimeout(() => this.search(textarea.value), 120);
      });
      let tagsEl = inner.createDiv();
      tagsEl.style.cssText = "min-height:16px;margin-top:4px";
      let resultsEl = inner.createDiv();
      resultsEl.style.cssText = "max-height:180px;overflow-y:auto;margin-top:8px", resultsEl.createDiv({ cls: "wkb-search-hint", text: this.plugin.settings.lang === "en" ? "Start typing\u2026" : "Stichw\xF6rter eingeben\u2026" }).style.cssText = "font-size:11px;color:#333;padding:4px 0", this.tagsEl = tagsEl, this.resultsEl = resultsEl, this.panel = panel;
    }
    clearSearch() {
      this.textarea && (this.textarea.value = "", this.search(""));
    }
    toggle() {
      this.isOpen = !this.isOpen;
      let panel = this.panel;
      this.isOpen ? (panel.style.transform = "none", panel.style.opacity = "1", panel.style.pointerEvents = "all") : (panel.style.transform = "scale(.92) translateY(8px)", panel.style.opacity = "0", panel.style.pointerEvents = "none");
    }
    search(raw) {
      let terms = termsFromLines(raw), tagsEl = this.tagsEl, resultsEl = this.resultsEl, lang = this.plugin.settings.lang, l = lang === "en" ? { empty: "Start typing\u2026", none: "No matches" } : { empty: "Stichw\xF6rter eingeben\u2026", none: "Keine \xDCbereinstimmung" };
      if (tagsEl.empty(), terms.forEach((t) => {
        let pill = tagsEl.createSpan({ cls: "wkb-search-pill", text: t });
        pill.style.cssText = "display:inline-block;background:rgba(127,119,221,.15);color:#AFA9EC;border-radius:99px;font-size:10px;padding:1px 7px;margin:2px 2px 0 0";
      }), !terms.length) {
        resultsEl.empty(), resultsEl.createDiv({ cls: "wkb-search-hint", text: l.empty }).style.cssText = "font-size:11px;color:#333;padding:4px 0", this.onResults([]);
        return;
      }
      let wfs = this.plugin.store.workflows, matched = matchWorkflows(wfs, terms, lang);
      if (this.onResults(matched.map((w) => w.id)), resultsEl.empty(), !matched.length) {
        resultsEl.createDiv({ cls: "wkb-search-hint wkb-search-none", text: l.none }).style.cssText = "font-size:11px;color:#333;padding:4px 0";
        return;
      }
      matched.forEach((wf) => {
        let card = resultsEl.createDiv({ cls: "wkb-search-card" });
        card.style.cssText = `
        padding:7px 9px;border-radius:6px;cursor:pointer;
        transition:background .15s;border-left:2px solid ${wf.color};margin-bottom:3px;
      `, card.addEventListener("mouseenter", () => card.style.background = "#151528"), card.addEventListener("mouseleave", () => card.style.background = ""), card.createDiv({ cls: "wkb-search-card-title", text: wf.title[lang] }).style.cssText = "font-size:12px;font-weight:500;color:#bbb", card.createDiv({ cls: "wkb-search-card-meta", text: wf.meta[lang] }).style.cssText = "font-size:10px;color:#444;margin-top:1px";
      });
    }
  };

  // src/toast.ts
  var hostOverride = null;
  function setToastHost(getHost) {
    hostOverride = getHost;
  }
  function getStack(doc) {
    let base = hostOverride?.() ?? null, host = (base ?? doc).querySelector("dialog[open]") ?? base ?? doc.body, stack = host.querySelector(":scope > .wkb-toast-stack");
    return stack || (stack = doc.createElement("div"), stack.className = "wkb-toast-stack", host.appendChild(stack)), stack;
  }
  function toast(message, timeoutMs = 5e3) {
    let el = document.createElement("div");
    el.className = "wkb-toast", el.setAttribute("role", "status"), el.textContent = message, getStack(document).appendChild(el);
    let timer = 0, hide = () => {
      clearTimeout(timer), el.remove();
    };
    return el.addEventListener("click", hide), timeoutMs > 0 && (timer = window.setTimeout(hide, timeoutMs)), { el, hide };
  }

  // src/edit-dialog.ts
  function openEditDialog(ctx, wf, nodeIdx, onSaved, parent = document.body) {
    let node = wf.nodes[nodeIdx];
    if (!node) return null;
    let dialog = document.createElement("dialog");
    dialog.className = "wkb-nem-dialog", parent.appendChild(dialog);
    let close = () => {
      typeof dialog.close == "function" && dialog.open && dialog.close(), dialog.remove();
    }, contentEl = dialog.createDiv();
    contentEl.addClass("wkb-nem"), contentEl.createEl("h3", { cls: "wkb-nem-title", text: "Edit Node" });
    let ctxEl = contentEl.createDiv({ cls: "wkb-nem-ctx" });
    ctxEl.style.color = wf.color, ctxEl.textContent = wf.title[ctx.settings.lang];
    let typeGroup = contentEl.createDiv({ cls: "wkb-nem-group" });
    typeGroup.createDiv({ cls: "wkb-nem-label", text: "Type" });
    let typeBtns = typeGroup.createDiv({ cls: "wkb-nem-type-row" }), NODE_TYPES = ["main", "sub", "diamond", "exc", "start", "end"], selectedType = node.type, btnEls = {}, refreshTypeBtns = () => {
      NODE_TYPES.forEach((t) => {
        btnEls[t]?.classList.toggle("wkb-nem-type-btn--active", t === selectedType);
      });
    };
    NODE_TYPES.forEach((t) => {
      let btn = typeBtns.createEl("button", { cls: "wkb-nem-type-btn", text: t });
      btnEls[t] = btn, btn.addEventListener("click", () => {
        selectedType = t, refreshTypeBtns();
      });
    }), refreshTypeBtns();
    let labelRow = contentEl.createDiv({ cls: "wkb-nem-label-row" }), labelInput = (lang, value) => {
      let group = labelRow.createDiv({ cls: `wkb-nem-group wkb-nem-group--${lang}` }), id = `wkb-nem-label-${lang}`;
      group.createEl("label", { cls: "wkb-nem-label", text: `Label (${lang.toUpperCase()})` }).setAttribute("for", id);
      let input = group.createEl("input", { cls: "wkb-nem-input", type: "text" });
      return input.id = id, input.lang = lang, input.dataset.lang = lang, input.value = value, input;
    }, enInput = labelInput("en", node.label.en), deInput = labelInput("de", node.label.de), respGroup = contentEl.createDiv({ cls: "wkb-nem-group" });
    respGroup.createDiv({ cls: "wkb-nem-label", text: "Responsible (optional)" });
    let respInput = respGroup.createEl("input", { cls: "wkb-nem-input", type: "text" });
    respInput.value = node.responsible ?? "";
    let slaGroup = contentEl.createDiv({ cls: "wkb-nem-group" });
    slaGroup.createDiv({ cls: "wkb-nem-label", text: "SLA (optional)" });
    let slaInput = slaGroup.createEl("input", { cls: "wkb-nem-input", type: "text" });
    slaInput.value = node.sla ?? "";
    let footer = contentEl.createDiv({ cls: "wkb-nem-footer" }), cancelBtn = footer.createEl("button", { cls: "wkb-nem-btn wkb-nem-btn--cancel", text: "Cancel" }), saveBtn = footer.createEl("button", { cls: "wkb-nem-btn wkb-nem-btn--save", text: "Save" });
    cancelBtn.addEventListener("click", () => close());
    let saving = !1, doSave = async () => {
      if (saving) return;
      let enVal = enInput.value.trim(), deVal = deInput.value.trim();
      if (!enVal || !deVal) {
        toast("Both EN and DE labels are required.");
        return;
      }
      saving = !0;
      try {
        await ctx.store.setNodeEdit(wf.id, node.id, {
          label: { en: enVal, de: deVal },
          type: selectedType,
          // "" = cleared (see NodeEdit in store.ts)
          responsible: respInput.value.trim(),
          sla: slaInput.value.trim()
        });
      } catch (e) {
        saving = !1, toast(`Could not save edit: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      onSaved(), close();
    };
    return saveBtn.addEventListener("click", () => {
      doSave();
    }), dialog.addEventListener("keydown", (e) => {
      e.key === "Enter" && (e.metaKey || e.ctrlKey) ? (e.preventDefault(), doSave()) : e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), close());
    }), dialog.addEventListener("cancel", (e) => {
      e.preventDefault(), close();
    }), typeof dialog.showModal == "function" ? dialog.showModal() : dialog.setAttribute("open", ""), setTimeout(() => enInput.focus(), 50), dialog;
  }

  // src/canvas-page.ts
  var UI_STATE_KEY = "ikb.ui";
  async function loadCanvasSettings(storage) {
    let s = (await storage.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {}, ui = (await storage.get(UI_STATE_KEY))[UI_STATE_KEY] ?? {};
    return {
      lang: s.lang === "de" ? "de" : "en",
      mouseEffect: s.mouseEffect !== !1,
      theme: parseTheme(s.theme),
      legendOpen: ui.legendOpen ?? !1,
      lastCanvasPan: ui.lastCanvasPan ?? { x: 0, y: 0 }
    };
  }
  async function saveCanvasSettings(storage, settings) {
    let current = (await storage.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {};
    await storage.set({
      [SETTINGS_KEY]: { ...current, lang: settings.lang },
      [UI_STATE_KEY]: { legendOpen: settings.legendOpen, lastCanvasPan: settings.lastCanvasPan }
    });
  }
  var CanvasPage = class {
    constructor(container, ctx, host = {}) {
      this.renderer = null;
      this.searchPanel = null;
      this.canvas = null;
      this.resizeObserver = null;
      // Detail panel (node click)
      this.detailPanel = null;
      this.detailOverlay = null;
      this.currentDetailWf = null;
      this.currentDetailNode = null;
      // Keyboard handler (stored for removal)
      this.keyHandler = null;
      this.pageHideHandler = null;
      // Workflows table panel (toolbar tab)
      this.workflowsPanel = null;
      this.workflowsOverlay = null;
      this.wfSortCol = "title";
      this.wfSortAsc = !0;
      this.legendEl = null;
      // ── Node style map ───────────────────────────────────────────────────────────
      this.NODE_STYLE = {
        main: { stroke: "#7F77DD", label: { en: "Main step", de: "Hauptschritt" } },
        sub: { stroke: "#1D9E75", label: { en: "Sub-step", de: "Teilschritt" } },
        diamond: { stroke: "#EF9F27", label: { en: "Decision", de: "Entscheidung" } },
        exc: { stroke: "#E24B4A", label: { en: "Exception", de: "Ausnahme" } },
        start: { stroke: "#7F77DD", label: { en: "Start", de: "Start" } },
        end: { stroke: "#888780", label: { en: "End", de: "Ende" } }
      };
      this.container = container, this.ctx = ctx, this.host = host;
    }
    get keyTarget() {
      return this.host.keyTarget ?? document;
    }
    mount() {
      let container = this.container;
      container.empty(), container.style.cssText = "padding:0;overflow:hidden;position:relative;background:#07070f", this.canvas = container.createEl("canvas", {
        attr: { style: "position:absolute;inset:0;width:100%;height:100%;cursor:grab" }
      });
      let toolbar = container.createDiv({ cls: "wkb-toolbar" });
      this.buildToolbar(toolbar);
      let legend = container.createDiv({ cls: "wkb-legend" });
      this.legendEl = legend, this.buildLegend(legend);
      let langBtn = container.createDiv({ cls: "wkb-lang-btn" });
      this.buildLangBtn(langBtn);
      let searchWrap = container.createDiv({ cls: "wkb-search-wrap" });
      this.searchPanel = new SearchPanel(searchWrap, this.ctx, (matchedIds) => {
        this.renderer && this.renderer.setHighlighted(new Set(matchedIds));
      }), this.detailOverlay = container.createDiv({ cls: "wkb-detail-overlay" }), this.detailOverlay.addEventListener("click", (e) => {
        let wf = this.currentDetailWf, node = this.currentDetailNode;
        if (e.detail === 2 && wf && node) {
          this.handleNodeDoubleClick(wf.id, wf.nodes.indexOf(node));
          return;
        }
        this.closeDetailPanel();
      }), this.detailPanel = container.createDiv({ cls: "wkb-detail-panel" }), this.workflowsOverlay = container.createDiv({ cls: "wkb-detail-overlay" }), this.workflowsOverlay.addEventListener("click", () => this.closeWorkflowsPanel()), this.workflowsPanel = container.createDiv({ cls: "wkb-detail-panel wkb-wf-panel" }), this.renderer = new KBCanvasRenderer({
        canvas: this.canvas,
        getWorkflows: () => this.ctx.store.workflows,
        getLang: () => this.ctx.settings.lang,
        onNodeClick: (wfId, nodeIdx) => this.handleNodeClick(wfId, nodeIdx),
        onNodeDoubleClick: (wfId, nodeIdx) => this.handleNodeDoubleClick(wfId, nodeIdx),
        onWorkflowClick: (wfId) => this.handleWorkflowClick(wfId),
        getMouseEffect: () => this.ctx.settings.mouseEffect,
        getTheme: () => this.ctx.settings.theme
      }), this.keyHandler = (e) => {
        e.key === "Escape" && this.renderer && (this.renderer.setHighlighted(/* @__PURE__ */ new Set()), this.searchPanel?.clearSearch());
      }, this.keyTarget.addEventListener("keydown", this.keyHandler), this.renderer.cam = { ...this.ctx.settings.lastCanvasPan }, this.renderer.start(), this.pageHideHandler = () => {
        this.renderer && (this.ctx.settings.lastCanvasPan = { ...this.renderer.cam }, this.ctx.saveSettings());
      }, window.addEventListener("pagehide", this.pageHideHandler), this.resizeObserver = new ResizeObserver(() => this.renderer?.resize()), this.resizeObserver.observe(container);
    }
    // Options-page theme switch, applied live. The renderer reads the theme per
    // frame; the page CSS follows html[data-theme]; the legend swatches and an
    // open detail panel carry inline colours, so they are rebuilt.
    setTheme(theme) {
      this.ctx.settings.theme = theme, applyThemeToDocument(theme, this.host.themeTarget), this.legendEl && (this.legendEl.empty(), this.buildLegend(this.legendEl)), this.currentDetailWf && this.currentDetailNode && this.openDetailPanel(this.currentDetailWf, this.currentDetailNode);
    }
    // Sidebar "Open in canvas" / `canvas.html#wf=<id>`: highlight one workflow
    // (same effect as a Workflows-table row click). False if it isn't loaded.
    showWorkflow(wfId) {
      return this.ctx.store.workflows.some((w) => w.id === wfId) ? (this.closeDetailPanel(), this.closeWorkflowsPanel(), this.renderer?.setHighlighted(/* @__PURE__ */ new Set([wfId])), !0) : !1;
    }
    async destroy() {
      this.pageHideHandler && window.removeEventListener("pagehide", this.pageHideHandler), this.resizeObserver?.disconnect(), this.renderer && (this.ctx.settings.lastCanvasPan = { ...this.renderer.cam }, await this.ctx.saveSettings(), this.renderer.stop(), this.renderer.detachEvents()), this.keyHandler && this.keyTarget.removeEventListener("keydown", this.keyHandler);
    }
    handleNodeClick(wfId, nodeIdx) {
      let wf = this.ctx.store.workflows.find((w) => w.id === wfId);
      if (!wf) return;
      let node = wf.nodes[nodeIdx];
      node && this.openDetailPanel(wf, node);
    }
    handleNodeDoubleClick(wfId, nodeIdx) {
      let wf = this.ctx.store.workflows.find((w) => w.id === wfId);
      if (!wf) return;
      let node = wf.nodes[nodeIdx];
      node && openEditDialog(this.ctx, wf, nodeIdx, () => {
        let saved = this.ctx.store.workflows.find((w) => w.id === wfId);
        this.renderer?.invalidateLayout(wfId), saved && this.currentDetailWf?.id === wfId && this.currentDetailNode?.id === node.id && this.openDetailPanel(saved, saved.nodes[nodeIdx]);
      }, this.host.dialogParent);
    }
    handleWorkflowClick(_wfId) {
    }
    // ── Detail panel ─────────────────────────────────────────────────────────────
    openDetailPanel(wf, node) {
      if (!this.detailPanel || !this.detailOverlay) return;
      this.currentDetailWf = wf, this.currentDetailNode = node;
      let lang = this.ctx.settings.lang, panel = this.detailPanel;
      panel.empty();
      let ns = this.NODE_STYLE[node.type] ?? this.NODE_STYLE.main, typeColor = nodeColors(this.ctx.settings.theme, node.type).stroke, header = panel.createDiv({ cls: "wkb-detail-header" }), closeBtn = header.createDiv({ cls: "wkb-detail-close" });
      closeBtn.textContent = "\u2715", closeBtn.addEventListener("click", () => this.closeDetailPanel());
      let wfCtx = header.createDiv({ cls: "wkb-detail-wf-ctx" });
      wfCtx.style.color = wf.color, wfCtx.textContent = wf.title[lang], header.createDiv({ cls: "wkb-detail-label-primary", text: node.label.en }), node.label.de !== node.label.en && header.createDiv({ cls: "wkb-detail-label-secondary", text: node.label.de });
      let typeBadge = header.createDiv({ cls: "wkb-detail-type-badge" }), dot = typeBadge.createDiv({ cls: "wkb-detail-type-dot" });
      dot.style.cssText = `background:${typeColor};box-shadow:0 0 6px ${typeColor}`;
      let typeLabel = typeBadge.createSpan({ cls: "wkb-detail-type-label" });
      typeLabel.style.color = typeColor, typeLabel.textContent = ns.label[lang];
      let body = panel.createDiv({ cls: "wkb-detail-body" });
      if (node.responsible) {
        let row = body.createDiv({ cls: "wkb-detail-row" });
        row.createSpan({
          cls: "wkb-detail-row-label",
          text: lang === "en" ? "Responsible" : "Zust\xE4ndig"
        }), row.createSpan({ cls: "wkb-detail-row-value", text: node.responsible });
      }
      if (node.sla) {
        let row = body.createDiv({ cls: "wkb-detail-row" });
        row.createSpan({ cls: "wkb-detail-row-label", text: "SLA" }), row.createSpan({ cls: "wkb-detail-row-value wkb-detail-row-value--sla", text: node.sla });
      }
      panel.classList.add("wkb-detail-panel--open"), this.detailOverlay.classList.add("wkb-detail-overlay--active");
    }
    closeDetailPanel() {
      this.detailPanel?.classList.remove("wkb-detail-panel--open"), this.detailOverlay?.classList.remove("wkb-detail-overlay--active"), this.currentDetailWf = null, this.currentDetailNode = null;
    }
    // ── Workflows table panel ─────────────────────────────────────────────────────
    openWorkflowsPanel() {
      !this.workflowsPanel || !this.workflowsOverlay || (this.buildWorkflowsTable(), this.workflowsPanel.classList.add("wkb-detail-panel--open"), this.workflowsOverlay.classList.add("wkb-detail-overlay--active"));
    }
    closeWorkflowsPanel() {
      this.workflowsPanel?.classList.remove("wkb-detail-panel--open"), this.workflowsOverlay?.classList.remove("wkb-detail-overlay--active");
    }
    buildWorkflowsTable() {
      let lang = this.ctx.settings.lang, panel = this.workflowsPanel;
      panel.empty();
      let header = panel.createDiv({ cls: "wkb-detail-header" }), closeBtn = header.createDiv({ cls: "wkb-detail-close" });
      closeBtn.textContent = "\u2715", closeBtn.addEventListener("click", () => this.closeWorkflowsPanel()), header.createDiv({
        cls: "wkb-detail-label-primary",
        text: "Workflows"
      }), header.createDiv({
        cls: "wkb-detail-label-secondary",
        text: `${this.ctx.store.workflows.length} total`
      });
      let body = panel.createDiv({ cls: "wkb-detail-body" }), cols = [
        { key: "title", label: "Name" },
        { key: "status", label: "Status" },
        { key: "owner", label: lang === "en" ? "Owner" : "Zust\xE4ndig" },
        { key: "nodes", label: lang === "en" ? "Nodes" : "Knoten", align: "right" }
      ], table = body.createEl("table", { cls: "wkb-wf-table" }), hrow = table.createEl("thead").createEl("tr");
      cols.forEach((col) => {
        let th = hrow.createEl("th", { cls: "wkb-wf-th" });
        col.align === "right" && (th.style.textAlign = "right"), col.key === this.wfSortCol && th.classList.add("wkb-wf-th--active");
        let inner = th.createDiv({ cls: "wkb-wf-th-inner" });
        col.align === "right" && (inner.style.justifyContent = "flex-end"), inner.createSpan({ text: col.label }), col.key === this.wfSortCol && inner.createSpan({ cls: "wkb-wf-sort-arrow", text: this.wfSortAsc ? " \u25B2" : " \u25BC" }), th.addEventListener("click", () => {
          this.wfSortCol === col.key ? this.wfSortAsc = !this.wfSortAsc : (this.wfSortCol = col.key, this.wfSortAsc = !0), this.buildWorkflowsTable();
        });
      });
      let wfs = [...this.ctx.store.workflows].sort((a, b) => {
        let av, bv;
        switch (this.wfSortCol) {
          case "title":
            av = a.title[lang], bv = b.title[lang];
            break;
          case "status":
            av = a.status, bv = b.status;
            break;
          case "owner":
            av = a.owner ?? "", bv = b.owner ?? "";
            break;
          case "nodes":
            av = String(a.nodes.length).padStart(3, "0"), bv = String(b.nodes.length).padStart(3, "0");
            break;
          default:
            av = a.title[lang], bv = b.title[lang];
        }
        return this.wfSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }), tbody = table.createEl("tbody");
      wfs.forEach((wf) => {
        let row = tbody.createEl("tr", { cls: "wkb-wf-row" });
        row.addEventListener("click", () => {
          this.renderer && this.renderer.setHighlighted(/* @__PURE__ */ new Set([wf.id])), this.closeWorkflowsPanel();
        });
        let titleInner = row.createEl("td", { cls: "wkb-wf-td" }).createDiv({ cls: "wkb-wf-td-title" }), dot = titleInner.createDiv({ cls: "wkb-wf-dot" });
        dot.style.cssText = `background:${wf.color};box-shadow:0 0 4px ${wf.color}`, titleInner.createSpan({ text: wf.title[lang] });
        let badge = row.createEl("td", { cls: "wkb-wf-td" }).createDiv({ cls: `wkb-wf-badge wkb-wf-badge--${wf.status}` });
        badge.textContent = wf.status, row.createEl("td", { cls: "wkb-wf-td wkb-wf-td--muted", text: wf.owner ?? "\u2014" });
        let tdNodes = row.createEl("td", { cls: "wkb-wf-td wkb-wf-td--num" });
        tdNodes.textContent = String(wf.nodes.length);
      });
    }
    // ── Toolbar ───────────────────────────────────────────────────────────────────
    buildToolbar(el) {
      el.style.cssText = `
      position:absolute;top:12px;left:50%;transform:translateX(-50%);
      z-index:25;display:flex;gap:4px;background:rgba(10,10,20,.9);
      border:0.5px solid #2a2a3e;border-radius:10px;padding:4px;
    `;
      let makeTab = (label) => {
        let tab = el.createDiv({ cls: "wkb-toolbar-tab" });
        return tab.style.cssText = `padding:5px 14px;border-radius:7px;font-size:11px;
        color:#555;cursor:pointer;font-weight:500;transition:all .15s;`, tab.textContent = label, tab;
      }, setActive = (tab) => {
        [canvasTab, workflowsTab].forEach((t) => {
          t.classList.remove("wkb-toolbar-tab--active"), t.style.color = "#555", t.style.background = "", t.style.border = "";
        }), tab.classList.add("wkb-toolbar-tab--active"), tab.style.color = "#AFA9EC", tab.style.background = "#1a1a2e", tab.style.border = "0.5px solid #3a3a5e";
      }, canvasTab = makeTab("Canvas"), workflowsTab = makeTab("Workflows");
      setActive(canvasTab), canvasTab.addEventListener("click", () => {
        setActive(canvasTab), this.closeWorkflowsPanel();
      }), workflowsTab.addEventListener("click", () => {
        setActive(workflowsTab), this.openWorkflowsPanel();
      });
    }
    // ── Legend ────────────────────────────────────────────────────────────────────
    buildLegend(el) {
      el.style.cssText = "position:absolute;bottom:56px;left:12px;z-index:20";
      let inner = el.createDiv({ cls: "wkb-legend-inner" });
      inner.style.cssText = "background:rgba(10,10,20,.92);border:0.5px solid #2a2a3e;border-radius:10px;overflow:hidden";
      let hdr = inner.createDiv({ cls: "wkb-legend-hdr" });
      hdr.style.cssText = "padding:6px 10px;display:flex;align-items:center;gap:6px;cursor:pointer";
      let title = hdr.createSpan({ text: this.getLegendTitle() });
      title.addClass("wkb-legend-title"), title.style.cssText = "font-size:10px;color:#666;font-weight:500";
      let arr = hdr.createSpan({ text: "\u25BE" });
      arr.style.cssText = "font-size:9px;color:#333;margin-left:auto;transition:transform .25s";
      let body = inner.createDiv({ cls: "wkb-legend-body" });
      body.style.cssText = "max-height:0;overflow:hidden;transition:max-height .28s ease", this.ctx.settings.legendOpen && (body.style.maxHeight = "160px", hdr.style.borderBottom = "0.5px solid #1e1e2e", arr.style.transform = "rotate(180deg)"), hdr.addEventListener("click", () => {
        body.style.maxHeight !== "0px" && body.style.maxHeight !== "" ? (body.style.maxHeight = "0px", hdr.style.borderBottom = "", arr.style.transform = "", this.ctx.settings.legendOpen = !1) : (body.style.maxHeight = "160px", hdr.style.borderBottom = "0.5px solid #1e1e2e", arr.style.transform = "rotate(180deg)", this.ctx.settings.legendOpen = !0), this.ctx.saveSettings();
      });
      let pal = (t) => nodeColors(this.ctx.settings.theme, t);
      [
        { ...pal("main"), label: () => this.ctx.settings.lang === "en" ? "Main node" : "Hauptknoten" },
        { ...pal("exc"), label: () => this.ctx.settings.lang === "en" ? "Exception" : "Ausnahme" },
        { ...pal("diamond"), label: () => this.ctx.settings.lang === "en" ? "Decision" : "Entscheidung" },
        { ...pal("sub"), label: () => this.ctx.settings.lang === "en" ? "Sub-step" : "Teilschritt" }
      ].forEach((item) => {
        let row = body.createDiv({ cls: "wkb-legend-row" });
        row.style.cssText = "display:flex;align-items:center;gap:7px;padding:4px 10px;font-size:10px;color:#555";
        let swatch = row.createDiv({ cls: "wkb-legend-swatch" });
        swatch.style.cssText = `width:18px;height:10px;border-radius:50%;flex-shrink:0;background:${item.fill};border:1px solid ${item.stroke}`, row.createSpan({ text: item.label() });
      });
    }
    // ── Lang button ───────────────────────────────────────────────────────────────
    buildLangBtn(el) {
      el.style.cssText = `
      position:absolute;bottom:12px;left:12px;z-index:20;
      background:rgba(10,10,20,.9);border:0.5px solid #2a2a3e;border-radius:8px;
      padding:5px 10px;cursor:pointer;display:flex;align-items:center;gap:5px;
      font-size:12px;color:#666;transition:all .2s;
    `;
      let flag = el.createSpan({ text: this.ctx.settings.lang === "en" ? "\u{1F1EC}\u{1F1E7}" : "\u{1F1E9}\u{1F1EA}" }), lbl = el.createSpan({ text: this.ctx.settings.lang === "en" ? "EN" : "DE" });
      el.addEventListener("click", async () => {
        this.ctx.settings.lang = this.ctx.settings.lang === "en" ? "de" : "en", await this.ctx.saveSettings(), flag.textContent = this.ctx.settings.lang === "en" ? "\u{1F1EC}\u{1F1E7}" : "\u{1F1E9}\u{1F1EA}", lbl.textContent = this.ctx.settings.lang === "en" ? "EN" : "DE", this.currentDetailWf && this.currentDetailNode && this.openDetailPanel(this.currentDetailWf, this.currentDetailNode);
      });
    }
    getLegendTitle() {
      return this.ctx.settings.lang === "en" ? "Legend" : "Legende";
    }
  }, EMPTY_TEXT = {
    en: "Import a JSON file or set a data URL in the extension options.",
    de: "Importieren Sie eine JSON-Datei oder legen Sie in den Erweiterungsoptionen eine Daten-URL fest."
  }, OPTIONS_LABEL = { en: "Open options", de: "Optionen \xF6ffnen" };
  function buildEmptyState(container, lang, deps) {
    let el = container.createDiv({ cls: "wkb-empty" });
    el.createDiv({
      cls: "wkb-empty-title",
      text: lang === "en" ? "No workflow data loaded" : "Keine Workflow-Daten geladen"
    }), el.createDiv({ cls: "wkb-empty-body", text: (deps.emptyText ?? EMPTY_TEXT)[lang] }), deps.openOptions && el.createEl("button", {
      cls: "wkb-nem-btn wkb-nem-btn--save",
      text: (deps.optionsLabel ?? OPTIONS_LABEL)[lang]
    }).addEventListener("click", deps.openOptions);
  }
  async function mount2(container, deps) {
    installDomShim();
    let settings = await loadCanvasSettings(deps.storage);
    applyThemeToDocument(settings.theme, deps.host?.themeTarget);
    let ctx = {
      settings,
      store: deps.store,
      saveSettings: () => saveCanvasSettings(deps.storage, settings)
    }, page = new CanvasPage(container, ctx, deps.host);
    page.mount(), deps.store.workflows.length === 0 && buildEmptyState(container, settings.lang, deps);
    let wf = deps.showWf;
    if (wf === void 0) {
      let m = /^#wf=(.+)$/.exec(window.location.hash);
      wf = m ? decodeURIComponent(m[1]) : null;
    }
    return wf && page.showWorkflow(wf), page;
  }

  // src/shadow-css.ts
  function toShadowCss(css) {
    return css.replace(/^@font-face\s*\{[^}]*\}\s*$/gm, "").replace(/^body:has\([^{]*\{[^}]*\}\s*$/gm, "").replace(/\bhtml\[data-theme="(\w+)"\]/g, ':host([data-theme="$1"])').replace(/^html,\s*body\s*\{/gm, ":host, #app {").replace(/(:host\(\[data-theme="\w+"\]\)) body\b/g, "$1 #app");
  }

  // static/launcher.css
  var launcher_default = `/* 0.4.0 \u2014 in-page launcher + panel (src/launcher.ts). Injected by the browser
   alongside the content script, so a page CSP can't block it. Every rule is
   !important and starts from \`all: initial\`, because these elements live in
   the host page's DOM. The search itself is an iframe and needs none of this.

   Flat follows ao-tools-shared DESIGN.md \xA72.1/\xA72.2 (launcher 70\xD770, #007BFF,
   11px Arial two-line label, z-index 999999; panel #222, 1px #444, radius 10px,
   z-index 999998). Organic uses the canvas palette from root CLAUDE.md
   \xA7 Visual style, with no CSS animation or transition. Position (right/bottom,
   and the panel's box) is set from script through CSSOM. */

ikb-launcher#ikb-launcher,
ikb-panel#ikb-panel,
ikb-panel#ikb-panel * {
  all: initial !important;
}

ikb-launcher#ikb-launcher {
  position: fixed !important;
  z-index: 999999 !important;
  width: 70px !important;
  height: 70px !important;
  box-sizing: border-box !important;
  border-radius: 50% !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  align-items: center !important;
  font: 11px/1.3 Arial, sans-serif !important;
  text-align: center !important;
  cursor: pointer !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  touch-action: none !important;
  background: #007BFF !important;
  color: #fff !important;
  transition: background 0.3s !important;
}
ikb-launcher#ikb-launcher:hover { background: #0056b3 !important; }
ikb-launcher#ikb-launcher[data-dragging="true"] { cursor: grabbing !important; }
ikb-launcher#ikb-launcher:focus-visible { outline: 2px solid #fff !important; outline-offset: 2px !important; }
ikb-launcher#ikb-launcher ikb-line {
  all: initial !important;
  display: block !important;
  font: inherit !important;
  color: inherit !important;
  pointer-events: none !important;
}

ikb-panel#ikb-panel {
  position: fixed !important;
  z-index: 999998 !important;
  box-sizing: border-box !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  background: #222 !important;
  border: 1px solid #444 !important;
  border-radius: 10px !important;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.6) !important;
  font: 12px Arial, sans-serif !important;
  color: #fff !important;
}
ikb-panel#ikb-panel[data-open="false"] { display: none !important; }
ikb-panel#ikb-panel ikb-frame-slot {
  display: flex !important;
  flex: 1 1 auto !important;
  min-height: 0 !important;
}
ikb-panel#ikb-panel iframe.ikb-frame {
  display: block !important;
  flex: 1 1 auto !important;
  width: 100% !important;
  height: 100% !important;
  border: 0 !important;
  background: #222 !important;
  color-scheme: dark !important;
}
ikb-panel#ikb-panel ikb-bar {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 6px 8px !important;
  border-top: 1px solid #444 !important;
  background: #222 !important;
}
ikb-panel#ikb-panel button.ikb-bar-btn {
  display: inline-block !important;
  padding: 4px 10px !important;
  background: #333 !important;
  border: 1px solid #555 !important;
  border-radius: 5px !important;
  color: #fff !important;
  font: 12px Arial, sans-serif !important;
  cursor: pointer !important;
  transition: background 0.3s !important;
}
ikb-panel#ikb-panel button.ikb-bar-btn:hover { background: #007BFF !important; }
ikb-panel#ikb-panel button.ikb-bar-btn:focus-visible { outline: 2px solid #007BFF !important; outline-offset: 1px !important; }
ikb-panel#ikb-panel button.ikb-bar-close { font-size: 16px !important; line-height: 1 !important; padding: 2px 9px !important; }

/* Organic */
ikb-launcher#ikb-launcher[data-theme="organic"] {
  background: #1a1228 !important;
  border: 2px solid #7F77DD !important;
  color: #AFA9EC !important;
  font-family: Inter, system-ui, sans-serif !important;
  box-shadow: 0 0 14px rgba(127, 119, 221, 0.55) !important;
  transition: none !important;
}
ikb-launcher#ikb-launcher[data-theme="organic"]:hover { background: #251a3a !important; }
ikb-panel#ikb-panel[data-theme="organic"] {
  background: #07070f !important;
  border-color: rgba(127, 119, 221, 0.45) !important;
  box-shadow: 0 0 18px rgba(127, 119, 221, 0.25), 0 4px 8px rgba(0, 0, 0, 0.6) !important;
}
ikb-panel#ikb-panel[data-theme="organic"] iframe.ikb-frame,
ikb-panel#ikb-panel[data-theme="organic"] ikb-bar { background: #07070f !important; }
ikb-panel#ikb-panel[data-theme="organic"] ikb-bar { border-top-color: rgba(127, 119, 221, 0.25) !important; }
ikb-panel#ikb-panel[data-theme="organic"] button.ikb-bar-btn {
  background: rgba(127, 119, 221, 0.12) !important;
  border-color: rgba(127, 119, 221, 0.5) !important;
  color: #AFA9EC !important;
  font-family: Inter, system-ui, sans-serif !important;
  transition: none !important;
}
ikb-panel#ikb-panel[data-theme="organic"] button.ikb-bar-btn:hover { background: rgba(127, 119, 221, 0.28) !important; }
`;

  // static/styles.css
  var styles_default = `/* \u2500\u2500 Workflow KB plugin styles \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.wkb-toolbar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  gap: 4px;
  background: rgba(10, 10, 20, 0.9);
  border: 0.5px solid #2a2a3e;
  border-radius: 10px;
  padding: 4px;
  user-select: none;
}

.wkb-legend {
  position: absolute;
  bottom: 56px;
  left: 12px;
  z-index: 20;
}

.wkb-lang-btn {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 20;
}

.wkb-search-wrap {
  position: absolute;
  bottom: 60px;
  right: 16px;
  z-index: 30;
}

/* Scrollbar styling for the dark canvas panels */
.wkb-search-panel ::-webkit-scrollbar {
  width: 4px;
}
.wkb-search-panel ::-webkit-scrollbar-track {
  background: transparent;
}
.wkb-search-panel ::-webkit-scrollbar-thumb {
  background: #2a2a44;
  border-radius: 2px;
}

/* \u2500\u2500 Detail panel (slide-in from right on node click) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.wkb-detail-overlay {
  display: none;
  position: absolute;
  inset: 0;
  z-index: 39;
}
.wkb-detail-overlay--active {
  display: block;
}

.wkb-detail-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 272px;
  background: #07070f;
  border-left: 1px solid #1e1e30;
  z-index: 40;
  transform: translateX(100%);
  transition: transform 0.24s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wkb-detail-panel--open {
  transform: translateX(0);
}

.wkb-detail-header {
  padding: 16px 14px 12px;
  border-bottom: 0.5px solid #1e1e30;
  position: relative;
  flex-shrink: 0;
}
.wkb-detail-close {
  position: absolute;
  top: 12px;
  right: 12px;
  cursor: pointer;
  color: #333;
  font-size: 13px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 4px;
  transition: color 0.15s;
}
.wkb-detail-close:hover { color: #888; }

.wkb-detail-wf-ctx {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
  margin-bottom: 6px;
  opacity: 0.85;
}
.wkb-detail-label-primary {
  font-size: 15px;
  font-weight: 600;
  color: #d0ccf5;
  line-height: 1.3;
  margin-bottom: 2px;
}
.wkb-detail-label-secondary {
  font-size: 11px;
  color: #444;
  font-style: italic;
  margin-bottom: 6px;
}
.wkb-detail-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
}
.wkb-detail-type-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wkb-detail-type-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.wkb-detail-body {
  padding: 12px 14px;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wkb-detail-body::-webkit-scrollbar { width: 3px; }
.wkb-detail-body::-webkit-scrollbar-track { background: transparent; }
.wkb-detail-body::-webkit-scrollbar-thumb { background: #1e1e30; border-radius: 2px; }

.wkb-detail-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wkb-detail-row-label {
  font-size: 9px;
  color: #333;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 500;
}
.wkb-detail-row-value {
  font-size: 11px;
  color: #888;
}
.wkb-detail-row-value--sla { color: #EF9F27; }


/* \u2500\u2500 Workflows table panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.wkb-wf-panel {
  width: 360px;
}

.wkb-wf-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.wkb-wf-th {
  text-align: left;
  padding: 5px 8px;
  color: #333;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 500;
  border-bottom: 0.5px solid #1e1e30;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.wkb-wf-th:hover { color: #555; }
.wkb-wf-th--active { color: #AFA9EC; }

.wkb-wf-th-inner {
  display: flex;
  align-items: center;
  gap: 3px;
}

.wkb-wf-sort-arrow {
  font-size: 8px;
  opacity: 0.7;
}

.wkb-wf-row {
  border-bottom: 0.5px solid #0d0d1a;
  cursor: pointer;
  transition: background 0.1s;
}
.wkb-wf-row:hover { background: #0d0d1e; }

.wkb-wf-td {
  padding: 7px 8px;
  color: #666;
  vertical-align: middle;
}

.wkb-wf-td-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #999;
  font-weight: 500;
}

.wkb-wf-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.wkb-wf-td--muted {
  color: #3a3a50;
  font-size: 10px;
}

.wkb-wf-td--num {
  color: #3a3a50;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 10px;
}

.wkb-wf-badge {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 99px;
  font-weight: 500;
  display: inline-block;
  white-space: nowrap;
}
.wkb-wf-badge--active     { background: rgba(29,158,117,.12); color: #1D9E75; }
.wkb-wf-badge--draft      { background: rgba(239,159,39,.12); color: #EF9F27; }
.wkb-wf-badge--deprecated { background: rgba(136,135,128,.12); color: #555; }

/* \u2500\u2500 Node edit modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.wkb-nem {
  padding: 4px 2px 2px;
}

.wkb-nem-title {
  font-size: 14px;
  font-weight: 600;
  color: #d0ccf5;
  margin: 0 0 4px;
}

.wkb-nem-ctx {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
  opacity: 0.8;
  margin-bottom: 16px;
}

.wkb-nem-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 14px;
}

/* EN | DE label inputs side by side; each column is at least 150px, so the
   pair wraps to one column in a narrow window instead of squeezing. */
.wkb-nem-label-row {
  display: flex;
  flex-wrap: wrap;
  column-gap: 10px;
}
.wkb-nem-label-row > .wkb-nem-group {
  flex: 1 1 150px;
  min-width: 0;
}

.wkb-nem-label {
  font-size: 9px;
  color: #444;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 500;
}

.wkb-nem-input {
  background: #0d0d1e;
  border: 0.5px solid #2a2a44;
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 12px;
  color: #bbb;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
  box-sizing: border-box;
}
.wkb-nem-input:focus {
  border-color: #7F77DD;
}

.wkb-nem-type-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.wkb-nem-type-btn {
  padding: 3px 10px;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  border: 0.5px solid #2a2a44;
  background: transparent;
  color: #444;
  font-family: inherit;
  transition: all 0.15s;
}
.wkb-nem-type-btn:hover {
  color: #888;
  border-color: #3a3a5e;
}
.wkb-nem-type-btn--active {
  background: rgba(127,119,221,0.15);
  border-color: #7F77DD;
  color: #AFA9EC;
}

.wkb-nem-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 0.5px solid #1e1e30;
}

.wkb-nem-btn {
  padding: 5px 16px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  border: 0.5px solid transparent;
}
.wkb-nem-btn--cancel {
  background: transparent;
  border-color: #2a2a44;
  color: #444;
}
.wkb-nem-btn--cancel:hover { color: #888; border-color: #3a3a5e; }
.wkb-nem-btn--save {
  background: rgba(127,119,221,0.18);
  border-color: #7F77DD;
  color: #AFA9EC;
}
.wkb-nem-btn--save:hover { background: rgba(127,119,221,0.28); }


/* \u2500\u2500 Extension-only (E4) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Everything above is byte-identical to the frozen plugin's styles.css.
   Below replaces what Obsidian's app chrome used to supply: page frame +
   interface font, Modal chrome (\u2192 <dialog>), and Notice (\u2192 toast.ts). */

/* Inter, bundled by build.mjs from @fontsource/inter (OFL-1.1). Obsidian
   ships Inter as its interface font, so this is what the plugin looked like. */
@font-face { font-family: Inter; font-style: normal; font-weight: 400; font-display: swap; src: url(fonts/inter-latin-400-normal.woff2) format("woff2"); }
@font-face { font-family: Inter; font-style: normal; font-weight: 500; font-display: swap; src: url(fonts/inter-latin-500-normal.woff2) format("woff2"); }
@font-face { font-family: Inter; font-style: normal; font-weight: 600; font-display: swap; src: url(fonts/inter-latin-600-normal.woff2) format("woff2"); }
@font-face { font-family: Inter; font-style: normal; font-weight: 700; font-display: swap; src: url(fonts/inter-latin-700-normal.woff2) format("woff2"); }

html, body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #07070f;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

#app {
  height: 100%;
}

/* search-panel.ts gives the textarea width:100% + padding; Obsidian's base
   CSS made that border-box, a bare page overflows the panel without it. */
.wkb-search-panel textarea {
  box-sizing: border-box;
}

.wkb-nem-dialog {
  background: #0c0c18;
  color: #bbb;
  border: 0.5px solid #2a2a44;
  border-radius: 12px;
  padding: 18px 20px;
  /* border-box so max-width holds including the padding on a narrow window */
  box-sizing: border-box;
  width: 460px;
  max-width: calc(100vw - 32px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}
.wkb-nem-dialog::backdrop {
  background: rgba(0, 0, 0, 0.55);
}

.wkb-toast-stack {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.wkb-toast {
  background: rgba(10, 10, 20, 0.95);
  border: 0.5px solid #2a2a3e;
  border-radius: 8px;
  padding: 8px 12px;
  max-width: 320px;
  font-size: 12px;
  line-height: 1.5;
  color: #AFA9EC;
  cursor: pointer;
}

/* E7 \u2014 empty state when no data source is set (nothing is bundled). */
.wkb-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 20;
  max-width: 340px;
  padding: 20px 22px;
  text-align: center;
  background: rgba(10, 10, 20, 0.92);
  border: 0.5px solid #2a2a3e;
  border-radius: 12px;
}
.wkb-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: #AFA9EC;
  margin-bottom: 6px;
}
.wkb-empty-body {
  font-size: 12px;
  line-height: 1.5;
  color: #666;
  margin-bottom: 14px;
}

/* \u2500\u2500 Sidebar search (0.2.0) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Firefox sidebar_action / Chrome side_panel. Same palette as the canvas
   panels, laid out for a narrow, scrolling column. */
.wkb-sb-page { overflow: auto; }
.wkb-sb { min-height: 100%; color: #bbb; font-size: 12px; }
.wkb-sb-header {
  position: sticky; top: 0; z-index: 1;
  padding: 12px 12px 8px;
  background: #07070f;
  border-bottom: 0.5px solid #1e1e30;
}
.wkb-sb-title {
  font-size: 10px; color: #666; letter-spacing: .07em;
  text-transform: uppercase; margin-bottom: 6px;
}
.wkb-sb-input {
  width: 100%; box-sizing: border-box;
  background: #111122; border: 0.5px solid #2a2a44; border-radius: 8px;
  padding: 7px 9px; font: inherit; font-size: 13px; color: #ddd; outline: none;
}
.wkb-sb-input:focus { border-color: #7F77DD; }
.wkb-sb-count { font-size: 10px; color: #555; margin-top: 6px; }
.wkb-sb-list { padding: 8px 8px 16px; }
.wkb-sb-empty { padding: 10px 6px; color: #666; line-height: 1.5; }
.wkb-sb-card {
  border-left: 2px solid #7F77DD; border-radius: 6px;
  background: #0c0c18; margin-bottom: 6px; overflow: hidden;
}
.wkb-sb-card-head { padding: 8px 10px; cursor: pointer; }
.wkb-sb-card-head:hover, .wkb-sb-card-head:focus-visible { background: #151528; outline: none; }
.wkb-sb-card-title { font-size: 13px; font-weight: 600; color: #d0ccf5; }
.wkb-sb-card-meta { font-size: 10px; color: #555; margin-top: 2px; }
.wkb-sb-steps { list-style: none; margin: 0; padding: 2px 10px 4px; }
.wkb-sb-step { display: flex; gap: 8px; padding: 5px 0; border-top: 0.5px solid #1a1a2c; }
.wkb-sb-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; }
.wkb-sb-step--dead-end { padding-left: 16px; }
.wkb-sb-step--diamond .wkb-sb-dot { border-radius: 1px; transform: rotate(45deg); }
.wkb-sb-step-body { min-width: 0; }
.wkb-sb-step-label { color: #ccc; line-height: 1.4; }
.wkb-sb-step-facts { font-size: 10px; color: #777; margin-top: 2px; }
.wkb-sb-branch { font-size: 11px; color: #EF9F27; margin-top: 2px; }
.wkb-sb-branch--exc { color: #F09595; }
.wkb-sb-btn {
  margin: 4px 10px 10px; padding: 5px 12px; border-radius: 7px;
  font: inherit; font-size: 11px; font-weight: 500; cursor: pointer;
  background: rgba(127,119,221,0.18); border: 0.5px solid #7F77DD; color: #AFA9EC;
}
.wkb-sb-btn:hover { background: rgba(127,119,221,0.28); }
.wkb-sb-empty + .wkb-sb-btn { margin-left: 6px; }

/* \u2500\u2500 Options page layout (0.3.0) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Was unstyled until 0.3.0. Organic colours here; flat overrides below. */
.wkb-opt {
  box-sizing: border-box;
  max-width: 560px;
  height: auto;
  padding: 24px 16px 40px;
  margin: 0 auto;
  color: #bbb;
  font-size: 13px;
}
body:has(> .wkb-opt), html:has(.wkb-opt) { overflow: auto; height: auto; min-height: 100%; }
.wkb-opt h1 { font-size: 16px; font-weight: 600; color: #d0ccf5; margin: 0 0 18px; }
.wkb-opt label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.wkb-opt label.wkb-opt-check { flex-direction: row; align-items: center; gap: 6px; }
.wkb-opt select,
.wkb-opt input[type="text"],
.wkb-opt input[type="file"] {
  box-sizing: border-box; width: 100%;
  background: #111122; color: #ddd; border: 0.5px solid #2a2a44; border-radius: 8px;
  padding: 6px 9px; font: inherit;
}
.wkb-opt-btn {
  margin: 4px 8px 4px 0; padding: 6px 14px; border-radius: 7px; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 500;
  background: transparent; border: 0.5px solid #2a2a44; color: #888;
}
.wkb-opt-btn--primary { background: rgba(127,119,221,0.18); border-color: #7F77DD; color: #AFA9EC; }
#wkb-opt-status { min-height: 1.4em; color: #888; }

/* Sidebar keyboard highlight (0.3.0), organic colours. */
.wkb-sb-card--active { background: #151528; box-shadow: inset 0 0 0 0.5px #7F77DD; }

/* \u2500\u2500 Flat theme (0.3.0, default) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Tokens COPIED from ao-tools-shared DESIGN.md \xA72.1 (ao-tools-ui.js 1.0.0);
   MV3 can't load remote code, so the extension carries the look, not the
   library. Keep in sync with FLAT_TOKENS in src/theme.ts. Everything is scoped
   to html[data-theme="flat"]; the rules above stay the Organic look.
   !important: much of the canvas chrome is styled inline by the ported code. */
html[data-theme="flat"] {
  --flat-accent: #007BFF;
  --flat-accent-hover: #0056b3;
  --flat-panel-bg: #222;
  --flat-panel-border: 1px solid #444;
  --flat-row-bg: #333;
  --flat-row-border: 1px solid #555;
  --flat-text: #fff;
  --flat-text-2: #aaa;
  --flat-none-bg: #3d0000;
  --flat-none-text: #ff6b6b;
  --flat-font: Arial, sans-serif;
  --flat-radius-panel: 10px;
  --flat-radius-row: 5px;
  --flat-shadow: 0 4px 8px rgba(0,0,0,0.6);
  --flat-hover: background 0.3s;
}
html[data-theme="flat"],
html[data-theme="flat"] body,
html[data-theme="flat"] #app {
  background: var(--flat-panel-bg) !important;
  color: var(--flat-text);
  font-family: var(--flat-font);
}
/* Nothing animated: panels appear, they don't slide or scale. */
html[data-theme="flat"] .wkb-detail-panel,
html[data-theme="flat"] .wkb-search-panel,
html[data-theme="flat"] .wkb-search-toggle,
html[data-theme="flat"] .wkb-legend-body,
html[data-theme="flat"] .wkb-legend-hdr span,
html[data-theme="flat"] .wkb-toolbar-tab,
html[data-theme="flat"] .wkb-lang-btn { transition: none !important; }
html[data-theme="flat"] .wkb-search-panel { transform: none !important; }

/* Floating chrome: panel tokens. */
html[data-theme="flat"] .wkb-toolbar,
html[data-theme="flat"] .wkb-legend-inner,
html[data-theme="flat"] .wkb-lang-btn,
html[data-theme="flat"] .wkb-search-panel,
html[data-theme="flat"] .wkb-empty,
html[data-theme="flat"] .wkb-toast {
  background: var(--flat-panel-bg) !important;
  border: var(--flat-panel-border) !important;
  border-radius: var(--flat-radius-panel) !important;
  box-shadow: var(--flat-shadow);
  color: var(--flat-text) !important;
  font-family: var(--flat-font);
}
html[data-theme="flat"] .wkb-toolbar-tab {
  color: var(--flat-text) !important;
  background: var(--flat-row-bg) !important;
  border: var(--flat-row-border) !important;
  border-radius: var(--flat-radius-row) !important;
  font-size: 12px !important;
}
html[data-theme="flat"] .wkb-toolbar-tab--active { background: var(--flat-accent) !important; border-color: var(--flat-accent) !important; }
html[data-theme="flat"] .wkb-legend-hdr { border-bottom-color: #444 !important; }
html[data-theme="flat"] .wkb-legend-title,
html[data-theme="flat"] .wkb-legend-row { color: var(--flat-text) !important; font-size: 12px !important; }
html[data-theme="flat"] .wkb-legend-hdr span:last-child { color: var(--flat-text-2) !important; }
html[data-theme="flat"] .wkb-legend-swatch { border-width: 2px !important; }
html[data-theme="flat"] .wkb-lang-btn { color: var(--flat-text) !important; }

/* Canvas search bubble: the launcher is the accent circle. */
html[data-theme="flat"] .wkb-search-toggle {
  background: var(--flat-accent) !important;
  border: none !important;
}
html[data-theme="flat"] .wkb-search-toggle:hover { background: var(--flat-accent-hover) !important; }
html[data-theme="flat"] .wkb-search-toggle svg { stroke: var(--flat-text); }
html[data-theme="flat"] .wkb-search-label { color: var(--flat-text-2) !important; font-size: 11px !important; }
html[data-theme="flat"] .wkb-search-panel textarea,
html[data-theme="flat"] .wkb-sb-input,
html[data-theme="flat"] .wkb-nem-input,
html[data-theme="flat"] .wkb-opt select,
html[data-theme="flat"] .wkb-opt input[type="text"],
html[data-theme="flat"] .wkb-opt input[type="file"] {
  background: var(--flat-row-bg) !important;
  border: var(--flat-row-border) !important;
  border-radius: var(--flat-radius-row) !important;
  color: var(--flat-text) !important;
  font-family: var(--flat-font) !important;
  font-size: 14px !important;
}
html[data-theme="flat"] .wkb-search-panel textarea:focus,
html[data-theme="flat"] .wkb-sb-input:focus,
html[data-theme="flat"] .wkb-nem-input:focus { border-color: var(--flat-accent) !important; }
html[data-theme="flat"] .wkb-search-pill { background: var(--flat-row-bg) !important; color: var(--flat-text) !important; border: var(--flat-row-border); }
html[data-theme="flat"] .wkb-search-hint { color: var(--flat-text-2) !important; }
html[data-theme="flat"] .wkb-search-none,
html[data-theme="flat"] .wkb-sb-none {
  background: var(--flat-none-bg) !important;
  color: var(--flat-none-text) !important;
  font-style: italic;
  text-align: center;
  border-radius: var(--flat-radius-row);
  padding: 8px !important;
}
html[data-theme="flat"] .wkb-search-card {
  background: var(--flat-row-bg) !important;
  border: var(--flat-row-border) !important;
  border-radius: var(--flat-radius-row) !important;
  transition: var(--flat-hover) !important;
}
html[data-theme="flat"] .wkb-search-card:hover { background: var(--flat-accent) !important; }
html[data-theme="flat"] .wkb-search-card-title { color: var(--flat-text) !important; font-size: 14px !important; }
html[data-theme="flat"] .wkb-search-card-meta { color: var(--flat-text-2) !important; }

/* Detail + Workflows panels. */
html[data-theme="flat"] .wkb-detail-panel { background: var(--flat-panel-bg); border-left: var(--flat-panel-border); box-shadow: var(--flat-shadow); }
html[data-theme="flat"] .wkb-detail-header { border-bottom: var(--flat-panel-border); }
html[data-theme="flat"] .wkb-detail-close { color: var(--flat-text-2); }
html[data-theme="flat"] .wkb-detail-close:hover { color: var(--flat-text); }
html[data-theme="flat"] .wkb-detail-label-primary { color: var(--flat-text); font-size: 16px; }
html[data-theme="flat"] .wkb-detail-label-secondary { color: var(--flat-text-2); }
html[data-theme="flat"] .wkb-detail-row-label,
html[data-theme="flat"] .wkb-detail-type-label,
html[data-theme="flat"] .wkb-detail-wf-ctx { font-size: 11px; }
html[data-theme="flat"] .wkb-detail-row-label { color: var(--flat-text-2); }
html[data-theme="flat"] .wkb-detail-row-value { color: var(--flat-text); font-size: 14px; }
html[data-theme="flat"] .wkb-detail-type-dot,
html[data-theme="flat"] .wkb-wf-dot { box-shadow: none !important; }
html[data-theme="flat"] .wkb-wf-table { font-size: 13px; }
html[data-theme="flat"] .wkb-wf-th { color: var(--flat-text-2); font-size: 11px; border-bottom: var(--flat-panel-border); }
html[data-theme="flat"] .wkb-wf-th:hover { color: var(--flat-text); }
html[data-theme="flat"] .wkb-wf-th--active { color: var(--flat-accent); }
html[data-theme="flat"] .wkb-wf-row { border-bottom: 1px solid #333; transition: var(--flat-hover); }
html[data-theme="flat"] .wkb-wf-row:hover { background: var(--flat-accent); }
html[data-theme="flat"] .wkb-wf-td,
html[data-theme="flat"] .wkb-wf-td-title { color: var(--flat-text); }
html[data-theme="flat"] .wkb-wf-td--muted,
html[data-theme="flat"] .wkb-wf-td--num { color: var(--flat-text-2); font-size: 12px; }

/* Edit dialog, toast, empty state. */
html[data-theme="flat"] .wkb-nem-dialog {
  background: var(--flat-panel-bg); color: var(--flat-text); font-family: var(--flat-font);
  border: var(--flat-panel-border); border-radius: var(--flat-radius-panel); box-shadow: var(--flat-shadow);
}
html[data-theme="flat"] .wkb-nem-title { color: var(--flat-text); }
html[data-theme="flat"] .wkb-nem-label { color: var(--flat-text-2); font-size: 11px; }
html[data-theme="flat"] .wkb-nem-footer { border-top: var(--flat-panel-border); }
html[data-theme="flat"] .wkb-nem-type-btn,
html[data-theme="flat"] .wkb-nem-btn,
html[data-theme="flat"] .wkb-sb-btn,
html[data-theme="flat"] .wkb-opt-btn {
  background: var(--flat-row-bg); border: var(--flat-row-border); border-radius: var(--flat-radius-row);
  color: var(--flat-text); font-family: var(--flat-font); font-size: 12px; transition: var(--flat-hover);
}
html[data-theme="flat"] .wkb-nem-type-btn:hover,
html[data-theme="flat"] .wkb-nem-btn:hover,
html[data-theme="flat"] .wkb-sb-btn:hover,
html[data-theme="flat"] .wkb-opt-btn:hover { background: var(--flat-accent-hover); color: var(--flat-text); }
html[data-theme="flat"] .wkb-nem-type-btn--active,
html[data-theme="flat"] .wkb-nem-btn--save,
html[data-theme="flat"] .wkb-opt-btn--primary { background: var(--flat-accent); border-color: var(--flat-accent); color: var(--flat-text); }
html[data-theme="flat"] .wkb-nem-btn--save:hover,
html[data-theme="flat"] .wkb-opt-btn--primary:hover { background: var(--flat-accent-hover); }
html[data-theme="flat"] .wkb-toast { font-size: 13px; }
html[data-theme="flat"] .wkb-empty-title { color: var(--flat-text); }
html[data-theme="flat"] .wkb-empty-body { color: var(--flat-text-2); }

/* Sidebar: rows are the userscript list rows; the highlighted row is the accent. */
html[data-theme="flat"] .wkb-sb { color: var(--flat-text); font-size: 14px; }
html[data-theme="flat"] .wkb-sb-header { background: var(--flat-panel-bg); border-bottom: var(--flat-panel-border); }
html[data-theme="flat"] .wkb-sb-title,
html[data-theme="flat"] .wkb-sb-count { color: var(--flat-text-2); font-size: 11px; }
html[data-theme="flat"] .wkb-sb-empty { color: var(--flat-text-2); }
html[data-theme="flat"] .wkb-sb-card {
  background: var(--flat-row-bg); border: var(--flat-row-border); border-left-width: 3px;
  border-radius: var(--flat-radius-row); box-shadow: none; transition: var(--flat-hover);
}
html[data-theme="flat"] .wkb-sb-card-head:hover,
html[data-theme="flat"] .wkb-sb-card-head:focus-visible { background: var(--flat-accent); }
html[data-theme="flat"] .wkb-sb-card-head { padding: 10px; }
html[data-theme="flat"] .wkb-sb-card--active > .wkb-sb-card-head { background: var(--flat-accent); }
html[data-theme="flat"] .wkb-sb-card-title { color: var(--flat-text); font-size: 14px; font-weight: bold; }
html[data-theme="flat"] .wkb-sb-card-meta { color: var(--flat-text-2); font-size: 12px; }
html[data-theme="flat"] .wkb-sb-card--active .wkb-sb-card-meta,
html[data-theme="flat"] .wkb-sb-card-head:hover .wkb-sb-card-meta { color: var(--flat-text); }
html[data-theme="flat"] .wkb-sb-step { border-top: 1px solid #444; }
html[data-theme="flat"] .wkb-sb-step-label { color: var(--flat-text); }
html[data-theme="flat"] .wkb-sb-step-facts { color: var(--flat-text-2); font-size: 12px; }
html[data-theme="flat"] .wkb-sb-branch { color: var(--flat-text-2); font-size: 12px; }
html[data-theme="flat"] .wkb-sb-branch--exc { color: var(--flat-none-text); }

/* Options page. */
html[data-theme="flat"] .wkb-opt { color: var(--flat-text); font-size: 14px; }
html[data-theme="flat"] .wkb-opt h1 { color: var(--flat-text); }
html[data-theme="flat"] #wkb-opt-status { color: var(--flat-text-2); }

/* Options page: in-page launcher sites (0.4.0). */
.wkb-opt-sites { margin-top: 26px; padding-top: 16px; border-top: 0.5px solid #2a2a44; }
.wkb-opt h2 { font-size: 14px; font-weight: 600; color: #d0ccf5; margin: 0 0 8px; }
.wkb-opt-help { color: #888; margin: 0 0 10px; line-height: 1.45; }
.wkb-opt-site-add { display: flex; gap: 8px; align-items: center; }
.wkb-opt-site-add input[type="text"] { flex: 1 1 auto; }
.wkb-opt-site-add .wkb-opt-btn { margin: 0; white-space: nowrap; }
#wkb-opt-sites { list-style: none; margin: 12px 0; padding: 0; }
.wkb-opt-site { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 6px 0; border-bottom: 0.5px solid #1c1c30; }
.wkb-opt-site-name { flex: 1 1 200px; color: #ddd; overflow-wrap: anywhere; }
.wkb-opt-site-pos { color: #666; font-size: 12px; }
.wkb-opt-site .wkb-opt-btn { margin: 0; }
.wkb-opt-site--none { color: #666; font-style: italic; }
.wkb-opt-btn:disabled { opacity: 0.45; cursor: default; }
/* Embedded in the page launcher's panel: fill the iframe. */
.wkb-sb-embed { margin: 0; }
html[data-theme="flat"] .wkb-opt-sites { border-top: var(--flat-panel-border); }
html[data-theme="flat"] .wkb-opt h2 { color: var(--flat-text); }
html[data-theme="flat"] .wkb-opt-help,
html[data-theme="flat"] .wkb-opt-site-pos { color: var(--flat-text-2); }
html[data-theme="flat"] .wkb-opt-site { border-bottom: 1px solid #333; }
html[data-theme="flat"] .wkb-opt-site-name { color: var(--flat-text); }
html[data-theme="flat"] .wkb-opt-site--none { color: var(--flat-text-2); }

/* \u2500\u2500 Sidebar tabs + Locations tab (0.5.0) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Tabs replace the pane title in the sticky header. Yes / No are the
   answer, so they read at a glance: green / red, unknown greyed. */
.wkb-sb-pane[hidden] { display: none; }
/* 0.5.2: the tab bar is fixed to the bottom of the sidebar / panel. */
.wkb-sb--tabs { padding-bottom: 48px; }
.wkb-sb-tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2;
  display: flex; gap: 6px; padding: 8px 12px;
  background: #07070f; border-top: 0.5px solid #1e1e30;
}
.wkb-sb-tab {
  flex: 1 1 0; padding: 6px 10px; border-radius: 6px; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 500;
  background: transparent; border: 0.5px solid #2a2a44; color: #777;
}
/* Clear (\xD7) button inside the search box (search-box.ts). */
.wkb-sb-inputwrap { position: relative; }
.wkb-sb-inputwrap .wkb-sb-input { padding-right: 30px; }
.wkb-sb-input::-webkit-search-cancel-button { display: none; }
.wkb-sb-clear {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  width: 22px; height: 22px; padding: 0; border: none; border-radius: 50%;
  background: transparent; color: #777; font-size: 17px; line-height: 22px; cursor: pointer;
}
.wkb-sb-clear:hover { color: #ddd; background: #1a1a2c; }
.wkb-sb-clear[hidden] { display: none; }
.wkb-sb-tab--active { background: rgba(127,119,221,0.18); border-color: #7F77DD; color: #AFA9EC; }
.wkb-loc-card { border-left-color: #1D9E75; }
.wkb-loc-fields { padding: 2px 10px 8px; }
.wkb-loc-fields--picked { padding-top: 0; }
.wkb-loc-group {
  font-size: 10px; color: #666; letter-spacing: .07em; text-transform: uppercase;
  margin: 8px 0 2px;
}
.wkb-loc-field {
  display: grid; grid-template-columns: fit-content(60%) minmax(0, 1fr); gap: 2px 10px;
  padding: 4px 0; border-top: 0.5px solid #1a1a2c; align-items: baseline;
}
.wkb-loc-field-label { color: #ccc; }
.wkb-loc-value { font-weight: 600; text-align: right; overflow-wrap: break-word; }
.wkb-loc-value--yes { color: #5DCAA5; }
.wkb-loc-value--no { color: #F09595; }
.wkb-loc-value--unknown { color: #555; font-weight: 400; }
.wkb-loc-value--text { color: #ddd; font-weight: 400; }
.wkb-loc-note { grid-column: 1 / -1; font-size: 10px; color: #777; }
.wkb-opt-locations { margin-top: 26px; padding-top: 16px; border-top: 0.5px solid #2a2a44; }

html[data-theme="flat"] .wkb-sb-tab {
  background: var(--flat-row-bg); border: var(--flat-row-border); border-radius: var(--flat-radius-row);
  color: var(--flat-text-2); font-family: var(--flat-font); font-size: 13px;
}
html[data-theme="flat"] .wkb-sb-tabbar { background: var(--flat-panel-bg); border-top: var(--flat-panel-border); }
html[data-theme="flat"] .wkb-sb-clear { color: var(--flat-text-2); font-family: var(--flat-font); }
html[data-theme="flat"] .wkb-sb-clear:hover { color: var(--flat-text); background: #444; }
html[data-theme="flat"] .wkb-sb-tab--active { background: var(--flat-accent); border-color: var(--flat-accent); color: var(--flat-text); }
html[data-theme="flat"] .wkb-loc-card { border-left-color: var(--flat-accent); }
html[data-theme="flat"] .wkb-loc-field { border-top: 1px solid #444; }
html[data-theme="flat"] .wkb-loc-field-label,
html[data-theme="flat"] .wkb-loc-value--text { color: var(--flat-text); }
html[data-theme="flat"] .wkb-loc-group,
html[data-theme="flat"] .wkb-loc-note,
html[data-theme="flat"] .wkb-loc-value--unknown { color: var(--flat-text-2); font-size: 11px; }
html[data-theme="flat"] .wkb-loc-value--yes { color: #4cd07d; }
html[data-theme="flat"] .wkb-loc-value--no { color: var(--flat-none-text); }
html[data-theme="flat"] .wkb-opt-locations { border-top: var(--flat-panel-border); }
`;

  // static/userscript.css
  var userscript_default = `/* Userscript only (src/userscript.ts), added to the page with launcher.css
   through GM_addStyle: the hosts of the shadow roots, and the bar's button
   group. Same rules as launcher.css: everything !important, from
   \`all: initial\`, because these elements sit in the host page's DOM. What is
   inside the shadow roots is styled by styles.css (rewritten, shadow-css.ts)
   and userscript-shadow.css. */

ikb-panel#ikb-panel ikb-bar-group {
  display: flex !important;
  gap: 8px !important;
}

/* The search, in the launcher's slot (where the extension has its iframe). */
ikb-panel#ikb-panel ikb-panel-root {
  display: block !important;
  flex: 1 1 auto !important;
  min-width: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
  background: #222 !important;
  color-scheme: dark !important;
}
ikb-panel#ikb-panel[data-theme="organic"] ikb-panel-root { background: #07070f !important; }

/* The canvas: the whole window, above the launcher (999999). */
ikb-canvas-root {
  all: initial !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483000 !important;
  display: block !important;
  color-scheme: dark !important;
}

/* Toasts when the canvas is closed: a fixed, empty box; the stack inside is
   fixed to the window's top right. */
ikb-toast-root {
  all: initial !important;
  position: fixed !important;
  top: 0 !important;
  right: 0 !important;
  width: 0 !important;
  height: 0 !important;
  z-index: 2147483001 !important;
  display: block !important;
}
`;

  // static/userscript-shadow.css
  var userscript_shadow_default = `/* Userscript only: inside every shadow root, after the rewritten styles.css
   (shadow-css.ts). */

/* The search panel. In the extension the tab bar is fixed to the bottom of
   the iframe's window; here it would be fixed to the page's window, so the
   panel becomes a column: panes scroll, the tab bar sits under them. */
#app.wkb-sb {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding-bottom: 0;
  overflow: hidden;
}
#app.wkb-sb > .wkb-sb-pane { flex: 1 1 auto; min-height: 0; overflow: auto; }
#app.wkb-sb > .wkb-sb-pane[hidden] { display: none; }
#app.wkb-sb > .wkb-sb-tabbar { position: static; flex: none; }

/* Above the canvas overlay and the page. Outside #app (the toasts' own
   shadow root), so the base font is set here too. */
.wkb-toast-stack {
  z-index: 2147483647;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

/* The canvas overlay's close button: top left (the toolbar is centred, the
   minimap and toasts are top right). */
.ikb-us-close {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  border: 0.5px solid #2a2a44;
  background: #0c0c18;
  color: #bbb;
  font: 20px/1 Arial, sans-serif;
  cursor: pointer;
}
.ikb-us-close:hover { color: #fff; border-color: #7F77DD; }
:host([data-theme="flat"]) .ikb-us-close {
  border: 1px solid #555;
  border-radius: 5px;
  background: #333;
  color: #fff;
}
:host([data-theme="flat"]) .ikb-us-close:hover { background: #007BFF; border-color: #007BFF; }
`;

  // src/userscript.ts
  var PICKER_ID = "ikb-file-picker", TOGGLE_KEY = { key: "J", altKey: !0, shiftKey: !0 }, T4 = {
    canvas: { en: "Canvas", de: "Canvas" },
    close: { en: "Close canvas (Esc)", de: "Canvas schlie\xDFen (Esc)" },
    wfEmpty: {
      en: "No workflow data loaded. Import the workflows file (JSON), or set a data URL in the Violentmonkey menu.",
      de: "Keine Workflow-Daten geladen. Workflow-Datei (JSON) importieren oder im Violentmonkey-Men\xFC eine Daten-URL festlegen."
    },
    wfImport: { en: "Import workflows\u2026", de: "Workflows importieren\u2026" },
    locEmpty: {
      en: "No locations table loaded. Import it here, or from the Violentmonkey menu.",
      de: "Keine Standorttabelle geladen. Hier oder im Violentmonkey-Men\xFC importieren."
    },
    locImport: { en: "Import locations\u2026", de: "Standorte importieren\u2026" },
    canvasEmpty: {
      en: "Import a workflows file (JSON) or set a data URL in the Violentmonkey menu.",
      de: "Workflow-Datei (JSON) importieren oder im Violentmonkey-Men\xFC eine Daten-URL festlegen."
    }
  }, MENU = {
    canvas: "Open workflow canvas",
    site: "Launcher on this site: on / off",
    importWf: "Import workflows (JSON)\u2026",
    importLoc: "Import locations table\u2026",
    dataUrl: "Set data URL\u2026",
    theme: "Theme: Flat / Organic",
    lang: "Language: EN / DE",
    mouse: "Canvas cursor effect: on / off",
    export: "Export workflows with my edits",
    resetEdits: "Reset my node edits",
    removeLoc: "Remove locations table",
    resetPos: "Reset launcher position"
  };
  function gmStorageArea(gm) {
    return {
      async get(key) {
        let v = gm.getValue(key);
        return v === void 0 ? {} : { [key]: v };
      },
      async set(items) {
        for (let [k, v] of Object.entries(items)) gm.setValue(k, v);
      }
    };
  }
  function gmFetch(xhr, timeoutMs = 5e3) {
    return (input) => new Promise((resolve, reject) => {
      xhr({
        method: "GET",
        url: String(input),
        timeout: timeoutMs,
        responseType: "text",
        onload: (r) => resolve({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => JSON.parse(r.responseText)
        }),
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timed out"))
      });
    });
  }
  var sheetText = null;
  function shadowSheet() {
    return sheetText ?? (sheetText = toShadowCss(styles_default) + `
` + userscript_shadow_default), sheetText;
  }
  var shadowMode = "closed";
  function attachStyled(host, doc) {
    let shadow = host.attachShadow({ mode: shadowMode });
    try {
      let sheet = new CSSStyleSheet();
      sheet.replaceSync(shadowSheet()), shadow.adoptedStyleSheets = [sheet];
    } catch {
      let style = doc.createElement("style");
      style.textContent = shadowSheet(), shadow.appendChild(style);
    }
    return shadow;
  }
  function keepKeysIn(host) {
    for (let type of ["keydown", "keyup", "keypress"])
      host.addEventListener(type, (e) => e.stopPropagation());
  }
  async function startUserscript(deps) {
    let doc = deps.doc ?? document, win = doc.defaultView ?? window;
    if (shadowMode = deps.shadowMode ?? "closed", doc.getElementById("ikb-launcher") || doc.querySelector("ikb-toast-root")) return null;
    let { storage } = deps, store = new ExtensionStore(storage, { fetchImpl: deps.fetchImpl }), getSettings = async () => (await storage.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {}, settings = await getSettings(), lang = settings.lang === "de" ? "de" : "en", theme = parseTheme(settings.theme), loadError, toastHost = null, toastBox = null, ensurePageUi = () => {
      if (toastBox) return toastBox;
      deps.addStyle(launcher_default + `
` + userscript_default), toastHost = doc.createElement("ikb-toast-root"), toastHost.dataset.theme = theme;
      let toastShadow = attachStyled(toastHost, doc);
      return toastBox = doc.createElement("div"), toastShadow.appendChild(toastBox), doc.documentElement.appendChild(toastHost), toastBox;
    }, canvas = null;
    setToastHost(() => canvas?.container ?? ensurePageUi());
    let loadData = async (announce) => {
      try {
        let r = await store.load();
        r.error && r.error !== loadError && announce && toast(`Data URL failed \u2014 ${r.error}. ` + (r.source === "imported" ? "Showing the imported file instead." : "No data loaded.")), loadError = r.error;
      } catch (e) {
        toast(`Could not load workflow data: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, loaded = null, ensureLoaded = () => loaded ?? (loaded = loadData(!0)), applyTheme = () => {
      toastHost && (toastHost.dataset.theme = theme), panelHost && (panelHost.dataset.theme = theme), canvas && (canvas.host.dataset.theme = theme);
    }, pickFile = (onText) => {
      if (deps.pickFile) {
        deps.pickFile(onText);
        return;
      }
      doc.getElementById(PICKER_ID)?.remove();
      let input = doc.createElement("input");
      input.id = PICKER_ID, input.type = "file", input.accept = "application/json,.json", input.hidden = !0, input.style.setProperty("display", "none", "important"), doc.documentElement.appendChild(input), input.addEventListener("change", async () => {
        input.remove();
        let file = input.files?.[0];
        if (file)
          try {
            onText(file.name, await file.text());
          } catch (e) {
            toast(`Import failed \u2014 could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
      }), input.click();
    }, importWorkflows = async (name, text) => {
      await ensureLoaded();
      let r = await store.importData(text);
      if (!r.ok) {
        toast(`Import failed \u2014 ${r.error}. The previous data is unchanged.`);
        return;
      }
      settings = await getSettings(), toast(`Imported ${r.workflows} workflows from ${name}.` + (settings.dataUrl ? " A data URL is set, and it still wins when it can be reached." : "")), await refreshAll();
    }, importLocations = async (name, text) => {
      await ensureLoaded();
      let r = await store.importLocations(text);
      if (!r.ok) {
        toast(`Import failed \u2014 ${r.error}. The previous table is unchanged.`);
        return;
      }
      toast(`Imported ${r.locations} locations, ${r.fields} fields from ${name}.` + (r.warnings.length ? ` Warnings: ${r.warnings.join("; ")}.` : "")), await refreshAll();
    }, pickWorkflows = () => pickFile((n, t) => void importWorkflows(n, t)), pickLocations = () => pickFile((n, t) => void importLocations(n, t)), panelHost = null, sidebar = null, launcher = null, siteKey = "", mountPanel = async (slot) => {
      panelHost = doc.createElement("ikb-panel-root"), panelHost.dataset.theme = theme, keepKeysIn(panelHost), slot.appendChild(panelHost);
      let shadow = attachStyled(panelHost, doc), root = doc.createElement("div");
      root.id = "app", shadow.appendChild(root), await ensureLoaded();
      let savedTab = (await storage.get(SIDEBAR_TAB_KEY))[SIDEBAR_TAB_KEY];
      sidebar = mount(root, {
        store,
        lang,
        theme,
        locations: () => store.locations,
        initialTab: savedTab === "locations" ? "locations" : "workflows",
        onTabChange: (tab) => {
          storage.set({ [SIDEBAR_TAB_KEY]: tab });
        },
        openInCanvas: (wfId) => {
          launcher?.close(), openCanvas(wfId);
        },
        onEscape: () => launcher?.close(!0),
        emptyWorkflows: { text: T4.wfEmpty, label: T4.wfImport, run: pickWorkflows },
        emptyLocations: { text: T4.locEmpty, label: T4.locImport, run: pickLocations }
      }), launcher?.isOpen() && sidebar.focusInput();
    }, mountLauncherHere = async () => {
      if (launcher) return;
      let pattern = findSiteForUrl(deps.href, await loadSites(storage));
      if (!pattern) return;
      siteKey = siteKeyFromPattern(pattern);
      let positions = await loadPositions(storage);
      launcher || (ensurePageUi(), launcher = mountLauncher({
        storage,
        siteKey,
        doc,
        settings,
        position: positions[siteKey],
        buttons: [{ label: T4.canvas, onClick: () => {
          launcher?.close(), openCanvas(null);
        } }],
        embed: {
          mount(slot) {
            mountPanel(slot);
          },
          opened() {
            sidebar?.focusInput();
          }
        }
      }));
    }, unmountLauncher = () => {
      launcher?.destroy(), launcher = null, sidebar = null, panelHost = null;
    }, toggleSite = async () => {
      let sites = await loadSites(storage), current = findSiteForUrl(deps.href, sites);
      if (current) {
        await storage.set({ [SITES_KEY]: sites.filter((s) => s !== current) }), unmountLauncher(), toast(`Launcher off for ${current.replace(/\/\*$/, "")}.`);
        return;
      }
      let site = normalizeSite(deps.href);
      if (!site) {
        toast("The launcher can only be shown on http(s) pages.");
        return;
      }
      await storage.set({ [SITES_KEY]: [...sites, site.pattern] }), await mountLauncherHere(), toast(`Launcher on for ${site.key}. Alt+Shift+J opens it.`);
    }, onCanvasKey = (e) => {
      !canvas || e.key !== "Escape" || canvas.container.querySelector("dialog[open]") || (e.preventDefault(), e.stopPropagation(), closeCanvas());
    }, openCanvas = async (wfId) => {
      if (canvas) {
        wfId && (canvas.page ? canvas.page.showWorkflow(wfId) : canvas.pendingWf = wfId);
        return;
      }
      ensurePageUi();
      let host = doc.createElement("ikb-canvas-root");
      host.dataset.theme = theme, keepKeysIn(host);
      let shadow = attachStyled(host, doc), container = doc.createElement("div");
      container.id = "app";
      let closeBtn = doc.createElement("button");
      if (closeBtn.type = "button", closeBtn.className = "ikb-us-close", closeBtn.textContent = "\xD7", closeBtn.title = T4.close[lang], closeBtn.setAttribute("aria-label", T4.close[lang]), closeBtn.addEventListener("click", () => void closeCanvas()), shadow.append(container, closeBtn), doc.documentElement.appendChild(host), canvas = { host, container, page: null }, doc.addEventListener("keydown", onCanvasKey, !0), await ensureLoaded(), canvas?.host !== host) return;
      let page = await mount2(container, {
        storage,
        store,
        host: { themeTarget: host, keyTarget: shadow, dialogParent: container },
        showWf: wfId ?? null,
        openOptions: pickWorkflows,
        emptyText: T4.canvasEmpty,
        optionsLabel: T4.wfImport
      });
      if (canvas?.host !== host) {
        await page.destroy();
        return;
      }
      canvas.page = page, canvas.pendingWf && page.showWorkflow(canvas.pendingWf);
    }, closeCanvas = async () => {
      if (!canvas) return;
      let c = canvas;
      canvas = null, doc.removeEventListener("keydown", onCanvasKey, !0), c.host.remove(), await c.page?.destroy(), launcher?.launcher.focus({ preventScroll: !0 });
    };
    async function refreshAll(reload = !1) {
      let prevUrl = settings.dataUrl;
      settings = await getSettings(), lang = settings.lang === "de" ? "de" : "en";
      let nextTheme = parseTheme(settings.theme), themeChanged = nextTheme !== theme;
      theme = nextTheme, applyTheme(), loaded && (reload || settings.dataUrl !== prevUrl) && await loadData(!1), launcher?.applySettings(settings), sidebar?.refresh({ lang, theme });
      let page = canvas?.page;
      page && (page.ctx.settings.mouseEffect = settings.mouseEffect !== !1, page.ctx.settings.lang !== lang && (page.ctx.settings.lang = lang), themeChanged && page.setTheme(theme));
    }
    let updateSettings = async (patch) => {
      let current = await getSettings();
      await storage.set({ [SETTINGS_KEY]: { ...current, ...patch } }), await refreshAll();
    }, download = deps.download ?? ((name, text) => {
      let url = URL.createObjectURL(new Blob([text], { type: "application/json" })), a = doc.createElement("a");
      a.href = url, a.download = name, a.style.setProperty("display", "none", "important"), doc.documentElement.appendChild(a), a.click(), a.remove(), win.setTimeout(() => URL.revokeObjectURL(url), 1e4);
    });
    deps.registerMenuCommand(MENU.canvas, () => void openCanvas(null)), deps.registerMenuCommand(MENU.site, () => void toggleSite()), deps.registerMenuCommand(MENU.importWf, pickWorkflows), deps.registerMenuCommand(MENU.importLoc, pickLocations), deps.registerMenuCommand(MENU.dataUrl, () => void (async () => {
      let current = (await getSettings()).dataUrl ?? "", next = deps.prompt(
        "Data URL (a raw gist or GitHub address). It wins over the imported file when it can be reached. Empty = none.",
        current
      );
      if (next === null) return;
      let url = next.trim();
      if (url && !/^https:\/\//i.test(url)) {
        toast("The data URL must start with https://.");
        return;
      }
      loadError = void 0, await updateSettings({ dataUrl: url || void 0 }), loaded || await ensureLoaded(), url ? loadError ? toast(`Data URL set, but it failed \u2014 ${loadError}. ${store.workflows.length} workflows from the imported file.`) : toast(`Data URL set. ${store.workflows.length} workflows loaded.`) : toast("Data URL removed.");
    })()), deps.registerMenuCommand(MENU.theme, () => void (async () => {
      let next = theme === "flat" ? "organic" : "flat";
      await updateSettings({ theme: next }), toast(`Theme: ${next === "flat" ? "Flat" : "Organic"}.`);
    })()), deps.registerMenuCommand(MENU.lang, () => void updateSettings({ lang: lang === "en" ? "de" : "en" })), deps.registerMenuCommand(MENU.mouse, () => void (async () => {
      let on = (await getSettings()).mouseEffect === !1;
      await updateSettings({ mouseEffect: on }), toast(`Canvas cursor effect ${on ? "on" : "off"}.`);
    })()), deps.registerMenuCommand(MENU.export, () => void (async () => {
      if (await ensureLoaded(), !store.workflows.length) {
        toast("No workflow data to export.");
        return;
      }
      download("ikb-workflows.json", JSON.stringify(store.buildExportData(), null, 2) + `
`);
    })()), deps.registerMenuCommand(MENU.resetEdits, () => void (async () => {
      deps.confirm("Remove all node edits made in the canvas, in this browser?") && (await store.resetEdits(), await refreshAll(!0), toast("Node edits removed."));
    })()), deps.registerMenuCommand(MENU.removeLoc, () => void (async () => {
      deps.confirm("Remove the imported locations table from this browser?") && (await store.clearLocations(), await refreshAll(), toast("Locations table removed."));
    })()), deps.registerMenuCommand(MENU.resetPos, () => void launcher?.resetPosition()), doc.addEventListener("keydown", (e) => {
      !launcher || e.altKey !== TOGGLE_KEY.altKey || e.shiftKey !== TOGGLE_KEY.shiftKey || e.ctrlKey || e.metaKey || e.code !== "KeyJ" || (e.preventDefault(), e.stopPropagation(), launcher.toggle());
    }, !0), deps.onValueChange(SETTINGS_KEY, (_v, remote) => {
      remote && refreshAll();
    });
    for (let key of [IMPORTED_KEY, EDITS_KEY, LOCATIONS_KEY])
      deps.onValueChange(key, (_v, remote) => {
        remote && refreshAll(!0);
      });
    return deps.onValueChange(LAUNCHER_POS_KEY, (v) => launcher?.applyPositions(v ?? {})), deps.onValueChange(SITES_KEY, (v) => {
      let sites = Array.isArray(v) ? v : [], pattern = findSiteForUrl(deps.href, sites);
      pattern ? (!launcher || siteKeyFromPattern(pattern) !== siteKey) && (unmountLauncher(), mountLauncherHere()) : unmountLauncher();
    }), applyTheme(), await mountLauncherHere(), {
      store,
      launcher: () => launcher,
      openCanvas,
      closeCanvas,
      canvasOpen: () => !!canvas,
      importWorkflows,
      importLocations,
      toggleSite
    };
  }
  typeof GM_getValue == "function" && typeof window < "u" && window === window.top && startUserscript({
    storage: gmStorageArea({ getValue: (k) => GM_getValue(k), setValue: (k, v) => GM_setValue(k, v) }),
    href: location.href,
    fetchImpl: gmFetch((d) => GM_xmlhttpRequest(d)),
    addStyle: (css) => {
      GM_addStyle(css);
    },
    registerMenuCommand: (caption, onClick) => {
      GM_registerMenuCommand(caption, onClick);
    },
    onValueChange: (key, cb) => {
      GM_addValueChangeListener(key, (_k, _old, nv, remote) => cb(nv, remote));
    },
    confirm: (text) => window.confirm(text),
    prompt: (text, value) => window.prompt(text, value)
  });
})();
