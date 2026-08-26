/* ============================================================================
   JV Inline Editor — sales-page build (jv-roadmap). v3 "block builder".

   Auto-tagger (in index.html) gives every element a stable data-eid and marks
   text-leaves with data-etext. This editor adds, on top of text/style editing:
     • spacing controls (padding / gap)
     • Add block: Section, Heading, Text, Button, Image (upload/URL), Video, Spacer
     • Duplicate a block
     • Move a block up / down within its section
     • Select-parent + Remove (delete links, blocks, whole sections)
   Everything persists via the content API and re-applies on load for visitors.

   Persistence model (edits array items):
     {eid, html, style}            – text-leaf content / style
     {eid, style}                  – container style (padding/margin/etc.)
     {eid, removed:true}           – element removed
     {insert, id, html, parentEid, afterEid}  – new/duplicated block
     {reorder, eid, order:[...]}   – child order of a container that was moved
   ========================================================================== */
(function () {
  "use strict";

  var cfg = window.JV_EDITOR || {};
  var SITE = cfg.site || "default";
  var PAGE = cfg.page || 1;
  var API = cfg.api || "/api/content";
  var APIBASE = (API.replace(/\/content.*$/, "") || "");      // e.g. https://.../api
  function endpointFor(pg) { return API + "?site=" + encodeURIComponent(SITE) + "&page=" + encodeURIComponent(pg); }
  var UPLOAD = APIBASE + "/upload"; // sibling endpoint
  // One password per BRAND, not per page. Each page has its own `site` store, so
  // keying the password by site meant re-entering it on every single page.
  var PW_KEY = "jv-pw:" + (cfg.pwKey || SITE);
  var EDIT_ENABLED = new URLSearchParams(location.search).get("edit") === "1";
  var PREVIEW_MODE = new URLSearchParams(location.search).get("view") === "preview";
  // Where "← Control Center" goes. Overridable via ?cc=<url> when the dashboard opens the editor.
  var CONTROL_CENTER_URL = (function () {
    try { var c = new URLSearchParams(location.search).get("cc"); if (c && /^https?:\/\//.test(c)) return c; } catch (e) {}
    return "https://julianhierro.github.io/trt-guy-control/";
  })();

  // ── A/B variants ──────────────────────────────────────────────────────────
  // Control (A) = the existing store (PAGE). Variant B = page (1000+PAGE).
  // Experiment config = page 0: edits[0] = {exp:true, active, split, name}.
  // Visitors are bucketed (sticky in localStorage) ONLY while an experiment is
  // active; otherwise everyone gets Control. In edit mode, ?variant=B loads &
  // publishes the B layer (seeded from Control the first time).
  // NOTE: the content API does parseInt(page)||1, so page 0 ALIASES page 1 — never
  // use 0 for a side store (it would clobber Control). Use high, distinct pages.
  var CONTROL_PAGE = PAGE, VARIANT_B_PAGE = 1000 + PAGE, EXP_PAGE = 990 + PAGE;
  var EDIT_VARIANT = ((new URLSearchParams(location.search).get("variant") || "").toUpperCase() === "B") ? "B" : "A";
  var activeVariant = "A", activePage = CONTROL_PAGE, seededFromControl = false, trackKey = SITE;
  var ENDPOINT = endpointFor(CONTROL_PAGE);                   // re-pointed once the variant is decided
  var DRAFT_KEY = "jv-draft:" + SITE + ":A:" + CONTROL_PAGE;  // re-pointed once the variant is decided

  (function () {
    var m = (location.hash || "").match(/[#&]k=([^&]+)/);
    if (m) {
      try { localStorage.setItem(PW_KEY, decodeURIComponent(m[1])); } catch (e) {}
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
  })();

  var MANAGED = ["font-family", "font-size", "color", "font-weight", "font-style", "text-align", "line-height", "letter-spacing", "justify-content", "align-items", "justify-items"];

  var FONTS = [
    { name: "Inter", css: "'Inter', sans-serif", g: "Inter:wght@400;500;600;700" },
    { name: "Montserrat", css: "'Montserrat', sans-serif", g: "Montserrat:wght@400;600;700;800;900" },
    { name: "Oswald", css: "'Oswald', sans-serif", g: "Oswald:wght@400;500;600;700" },
    { name: "Anton", css: "'Anton', sans-serif", g: "Anton" },
    { name: "Bebas Neue", css: "'Bebas Neue', sans-serif", g: "Bebas+Neue" },
    { name: "Poppins", css: "'Poppins', sans-serif", g: "Poppins:wght@400;500;600;700;800" },
    { name: "Roboto", css: "'Roboto', sans-serif", g: "Roboto:wght@400;500;700;900" },
    { name: "Raleway", css: "'Raleway', sans-serif", g: "Raleway:wght@400;600;700;800" },
    { name: "Lato", css: "'Lato', sans-serif", g: "Lato:wght@400;700;900" },
    { name: "Open Sans", css: "'Open Sans', sans-serif", g: "Open+Sans:wght@400;600;700;800" },
    { name: "Playfair Display", css: "'Playfair Display', serif", g: "Playfair+Display:wght@400;600;700;800;900" },
    { name: "Archivo", css: "'Archivo', sans-serif", g: "Archivo:wght@400;600;700;800;900" },
    { name: "Georgia", css: "Georgia, serif" },
    { name: "Arial", css: "Arial, Helvetica, sans-serif" },
    { name: "System", css: "system-ui, -apple-system, sans-serif" },
  ];
  var SWATCHES = ["#1a5cff", "#000000", "#404040", "#737373", "#ffffff", "#b91c1c", "#2563eb", "#d97706"];

  var loadedFonts = {};
  function loadFont(name) {
    var f = FONTS.find(function (x) { return x.name === name; });
    if (!f || !f.g || loadedFonts[name]) return;
    loadedFonts[name] = true;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + f.g + "&display=swap";
    document.head.appendChild(l);
  }
  function fontNameFromCss(cssVal) {
    if (!cssVal) return "";
    var first = cssVal.split(",")[0].replace(/['"]/g, "").trim().toLowerCase();
    var f = FONTS.find(function (x) { return x.name.toLowerCase() === first; });
    return f ? f.name : "";
  }
  function registerFonts(scope) {
    (scope || document).querySelectorAll('[style*="font-family"]').forEach(function (el) {
      var fn = fontNameFromCss(el.style.fontFamily); if (fn) loadFont(fn);
    });
  }

  function editable() { return Array.prototype.slice.call(document.querySelectorAll("[data-etext]")); }
  function byEid(eid) {
    try { return document.querySelector('[data-eid="' + (window.CSS && CSS.escape ? CSS.escape(eid) : eid) + '"]'); }
    catch (e) { return null; }
  }
  function inIns(el) { return !!(el.closest && el.closest("[data-ins]")); }

  // ── Editor state ────────────────────────────────────────────────────────
  var removedEids = {};
  var reorderedContainers = {};

  // ── Device-scoped overrides ("Mobile only / Desktop only") ────────────────
  // editScope: 'all' (shared inline edit, the default) | 'm' (mobile) | 'd' (desktop).
  // A device edit is stored as {css:true, eid, d, props:{...}} and rendered into a
  // <style id="jv-device-css"> as an @media rule, so it coexists with the shared
  // base edits and self-targets by viewport — the dashboard's Mobile view (412px)
  // previews mobile rules live (WYSIWYG). No content-API change needed.
  var BP = 768;                       // mobile = viewport < 768px
  var BP_T = 1024;                    // tablet = 768–1023px, desktop = 1024px+
  var editScope = "all";
  var deviceRules = { m: {}, t: {}, d: {} };
  var deviceStyleEl = null;
  function cssAttrEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function ensureDeviceStyleEl() {
    if (deviceStyleEl && deviceStyleEl.isConnected) return deviceStyleEl;
    deviceStyleEl = document.getElementById("jv-device-css");
    if (!deviceStyleEl) { deviceStyleEl = document.createElement("style"); deviceStyleEl.id = "jv-device-css"; document.head.appendChild(deviceStyleEl); }
    return deviceStyleEl;
  }
  function buildDeviceCSS() {
    var el = ensureDeviceStyleEl(), out = "";
    [["m", "@media (max-width:" + (BP - 1) + "px)"],
     ["t", "@media (min-width:" + BP + "px) and (max-width:" + (BP_T - 1) + "px)"],
     ["d", "@media (min-width:" + BP_T + "px)"]].forEach(function (pair) {
      var map = deviceRules[pair[0]] || {}, inner = "";
      Object.keys(map).forEach(function (eid) {
        var props = map[eid] || {}, body = "";
        Object.keys(props).forEach(function (p) { if (props[p] != null && props[p] !== "") body += p + ":" + props[p] + " !important;"; });
        if (body) inner += '[data-eid="' + cssAttrEsc(eid) + '"]{' + body + "}";
      });
      if (inner) out += pair[1] + "{" + inner + "}";
    });
    el.textContent = out;
  }
  function resetDeviceRules() { deviceRules = { m: {}, t: {}, d: {} }; buildDeviceCSS(); }
  function setDeviceRule(eid, props, d) {
    if (!eid || (d !== "m" && d !== "t" && d !== "d")) return;
    if (!deviceRules[d][eid]) deviceRules[d][eid] = {};
    Object.keys(props).forEach(function (p) { deviceRules[d][eid][p] = props[p]; });
    buildDeviceCSS();
  }
  function scopedVal(eid, d, prop) { return deviceRules[d] && deviceRules[d][eid] ? deviceRules[d][eid][prop] : undefined; }
  function scopeLabel(s) { return s === "m" ? "Mobile only" : s === "t" ? "Tablet only" : s === "d" ? "Desktop only" : "All devices"; }
  function curViewport() { return window.innerWidth < BP ? "m" : window.innerWidth < BP_T ? "t" : "d"; }
  function markReordered(c) {
    if (c && c.getAttribute && c.getAttribute("data-eid") && !c.closest("[data-ins]"))
      reorderedContainers[c.getAttribute("data-eid")] = true;
  }
  // Fresh ids for inserted/duplicated blocks: i1, i2, …
  var _idSeed = null;
  function nextEid() {
    if (_idSeed === null) {
      var mx = 0;
      document.querySelectorAll("[data-eid]").forEach(function (el) {
        var m = /^i(\d+)$/.exec(el.getAttribute("data-eid") || ""); if (m) mx = Math.max(mx, +m[1]);
      });
      _idSeed = mx;
    }
    return "i" + (++_idSeed);
  }
  function tagNew(root) {
    root.setAttribute("data-ins", "1");
    [root].concat(Array.prototype.slice.call(root.querySelectorAll("*"))).forEach(function (el) {
      if (!el.hasAttribute("data-eid")) el.setAttribute("data-eid", nextEid());
    });
  }
  function cleanOuter(node) {
    var c = node.cloneNode(true);
    c.removeAttribute("contenteditable"); if (c.classList) c.classList.remove("jv-active");
    Array.prototype.forEach.call(c.querySelectorAll("[contenteditable]"), function (e) { e.removeAttribute("contenteditable"); });
    Array.prototype.forEach.call(c.querySelectorAll(".jv-active"), function (e) { e.classList.remove("jv-active"); });
    Array.prototype.forEach.call(c.querySelectorAll(".jv-faq-tools, .jv-faq-adder, .jv-section-tools, .jv-inserter"), function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
    c.removeAttribute("data-jv-label");
    Array.prototype.forEach.call(c.querySelectorAll("[data-jv-label]"), function (e) { e.removeAttribute("data-jv-label"); });
    return normNbsp(c.outerHTML);
  }

  // ── Undo / redo ───────────────────────────────────────────────────────────
  // Each history entry is a full snapshot() (the same edits array we publish).
  // Undo = reset the page to its baseline (pristine + published, captured once at
  // open) and re-apply a past snapshot — so it reverses text, style, spacing AND
  // structural changes (add / duplicate / move / remove) consistently.
  var undoStack = [], redoStack = [], pristineContentHTML = "", _lastPush = 0;
  var typingBurst = false, burstTimer = null;
  function contentNodes() {
    return Array.prototype.filter.call(document.body.children, function (el) {
      return !(el.classList && (el.classList.contains("jv-toolbar") || el.classList.contains("jv-launcher") || el.classList.contains("jv-home-btn") || el.classList.contains("jv-addmenu") || el.classList.contains("jv-hover-tools") || el.classList.contains("jv-outline") || el.classList.contains("jv-outline-toggle") || el.classList.contains("jv-preview-overlay"))) && el.id !== "jv-result";
    });
  }
  function captureContent() {
    return contentNodes().map(function (el) {
      var c = el.cloneNode(true);
      if (c.removeAttribute) c.removeAttribute("contenteditable");
      if (c.classList) c.classList.remove("jv-active");
      if (c.querySelectorAll) {
        Array.prototype.forEach.call(c.querySelectorAll("[contenteditable]"), function (e) { e.removeAttribute("contenteditable"); });
        Array.prototype.forEach.call(c.querySelectorAll(".jv-active"), function (e) { e.classList.remove("jv-active"); });
        // drop zones are editor chrome — never part of the content baseline
        Array.prototype.forEach.call(c.querySelectorAll(".jv-inserter, .jv-section-tools, .jv-faq-tools, .jv-faq-adder"), function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
      }
      return c.outerHTML;
    }).join("");
  }
  function restoreContent(html) {
    contentNodes().forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    var tmp = document.createElement("div"); tmp.innerHTML = html;
    var ref = document.body.firstChild;
    while (tmp.firstChild) document.body.insertBefore(tmp.firstChild, ref);
  }
  function pushUndo() {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    redoStack.length = 0;
    if (now - _lastPush < 150) return;   // coalesce rapid ticks (color/size drag)
    _lastPush = now;
    undoStack.push(snapshot());
    if (undoStack.length > 40) undoStack.shift();
    updateUndoBtns();
  }
  function applyState(snap) {
    restoreContent(pristineContentHTML);
    removedEids = {}; reorderedContainers = {}; _idSeed = null;
    resetDeviceRules();
    applyEdits(snap);
    registerFonts(document.body);
    setActive(null);
    editable().forEach(function (el) { el.contentEditable = editMode ? "true" : "false"; });
    if (editMode) { decorateFaqs(); decorateSections(); decorateInserters(); setImgDraggable(true); }   // undo/redo rebuilds the page → re-attach controls + draggability
    saveDraft();
    updateUndoBtns();
  }
  function undo() {
    if (!undoStack.length) { flash("Nothing to undo"); return; }
    redoStack.push(snapshot());
    applyState(undoStack.pop());
    flash("Undo");
  }
  function redo() {
    if (!redoStack.length) { flash("Nothing to redo"); return; }
    undoStack.push(snapshot());
    applyState(redoStack.pop());
    flash("Redo");
  }
  function updateUndoBtns() {
    if (ui.undo) ui.undo.disabled = !undoStack.length;
    if (ui.redo) ui.redo.disabled = !redoStack.length;
  }

  // ── Apply / capture ──────────────────────────────────────────────────────
  function applyEdits(arr) {
    if (!Array.isArray(arr)) return;
    var patches = [], inserts = [], reorders = [], removals = [], cssItems = [], attrsList = [];
    arr.forEach(function (it) {
      if (!it) return;
      if (it.css && it.eid && it.props && (it.d === "m" || it.d === "d")) cssItems.push(it);
      else if (it.insert) inserts.push(it);
      else if (it.reorder) reorders.push(it);
      else if (it.removed && it.eid) removals.push(it.eid);
      else if (it.attrs && it.eid) attrsList.push(it);
      else if (it.eid) patches.push(it);
    });
    // 1) content + style on existing elements
    patches.forEach(function (it) {
      try {
        var el = byEid(it.eid); if (!el) return;
        if (typeof it.html === "string") el.innerHTML = it.html;
        if (typeof it.style === "string") {
          el.setAttribute("style", it.style);
          if (!el.hasAttribute("data-etext")) el.setAttribute("data-edited-style", "1");
          var fn = fontNameFromCss(el.style.fontFamily); if (fn) loadFont(fn);
        }
      } catch (e) { try { console.warn("[jv-editor] skipped bad patch", it && it.eid, e); } catch (e2) {} }
    });
    // 1b) attributes — links, and which button opens the pop-up
    attrsList.forEach(function (it) {
      var el = byEid(it.eid); if (!el) return;
      var gone = (it.attrs["-removed"] || "").split(",");
      Object.keys(it.attrs).forEach(function (k) {
        if (k === "-removed") return;
        if (ATTR_KEYS.indexOf(k) === -1) return;              // ignore anything unexpected
        el.setAttribute(k, it.attrs[k]);
      });
      gone.forEach(function (k) { if (k && ATTR_KEYS.indexOf(k) !== -1) el.removeAttribute(k); });
      el.setAttribute("data-edited-attr", "1");
    });
    // 2) inserts (new / duplicated blocks)
    inserts.forEach(function (it) {
      if (!it.id || typeof it.html !== "string") return;
      if (byEid(it.id)) return;
      var tmp = document.createElement("div"); tmp.innerHTML = it.html.trim();
      var node = tmp.firstElementChild; if (!node) return;
      var after = it.afterEid ? byEid(it.afterEid) : null;
      var parent = it.parentEid ? byEid(it.parentEid) : null;
      if (after && after.parentNode) after.parentNode.insertBefore(node, after.nextSibling);
      else if (parent) parent.appendChild(node);
      else (document.getElementById("jv-wrapper") || document.body).appendChild(node);
      registerFonts(node);
    });
    // 3) reordered containers
    reorders.forEach(function (it) {
      var c = byEid(it.eid); if (!c || !Array.isArray(it.order)) return;
      reorderedContainers[it.eid] = true;
      it.order.forEach(function (cid) { var ch = byEid(cid); if (ch && ch.parentElement === c) c.appendChild(ch); });
    });
    // 4) removals last
    removals.forEach(function (eid) { removedEids[eid] = true; var el = byEid(eid); if (el && el.parentNode) el.parentNode.removeChild(el); });
    // 5) device-scoped style overrides (rendered as @media rules)
    cssItems.forEach(function (it) {
      if (!deviceRules[it.d][it.eid]) deviceRules[it.d][it.eid] = {};
      Object.keys(it.props).forEach(function (p) { deviceRules[it.d][it.eid][p] = it.props[p]; });
    });
    if (cssItems.length) buildDeviceCSS();
  }

  // contenteditable turns typed spaces into non-breaking spaces ( ), which then
  // refuse to wrap and crop on mobile. Normalize them back to regular spaces whenever
  // we serialize text for the draft/publish — so saved content always wraps cleanly.
  function normNbsp(s) { return s == null ? s : String(s).replace(new RegExp(String.fromCharCode(160),"g")," "); }
  // Editor chrome must never reach the published page. The active-element outline
  // lives in the style attribute, so strip it on the way out — it shipped once as a
  // blue box around a live headline.
  function cleanStyle(el) {
    var st = el.getAttribute("style") || "";
    if (st.indexOf("outline") === -1) return st;
    return st.replace(/\s*outline[a-z-]*\s*:[^;]*;?/gi, "").trim();
  }
  function snapshot() {
    var arr = [];
    editable().forEach(function (el) {
      if (inIns(el)) return;
      arr.push({ eid: el.getAttribute("data-eid"), html: normNbsp(el.innerHTML), style: cleanStyle(el) });
    });
    // Attributes (href, target, data-buy…) are not part of innerHTML when the
    // element itself is the edited leaf, so they need their own record.
    document.querySelectorAll("[data-edited-attr]").forEach(function (el) {
      if (el.hasAttribute("data-ins") || inIns(el)) return;
      var out = {};
      ATTR_KEYS.forEach(function (k) { if (el.hasAttribute(k)) out[k] = el.getAttribute(k); });
      out["-removed"] = ATTR_KEYS.filter(function (k) { return !el.hasAttribute(k); }).join(",");
      arr.push({ eid: el.getAttribute("data-eid"), attrs: out });
    });
    document.querySelectorAll("[data-edited-style]").forEach(function (el) {
      if (el.hasAttribute("data-etext")) return;
      if (el.hasAttribute("data-ins") || inIns(el)) return;
      var st = cleanStyle(el); if (st.trim()) arr.push({ eid: el.getAttribute("data-eid"), style: st });
    });
    document.querySelectorAll("[data-ins]").forEach(function (node) {
      if (node.parentElement && node.parentElement.closest("[data-ins]")) return; // nested → part of parent
      var parent = node.parentElement, prev = node.previousElementSibling;
      arr.push({ insert: true, id: node.getAttribute("data-eid"), html: cleanOuter(node),
                 parentEid: parent ? parent.getAttribute("data-eid") : null,
                 afterEid: prev ? prev.getAttribute("data-eid") : null });
    });
    Object.keys(reorderedContainers).forEach(function (cid) {
      var c = byEid(cid); if (!c) return;
      var order = Array.prototype.slice.call(c.children).map(function (ch) { return ch.getAttribute("data-eid"); }).filter(Boolean);
      arr.push({ reorder: true, eid: cid, order: order });
    });
    Object.keys(removedEids).forEach(function (eid) { arr.push({ eid: eid, removed: true }); });
    ["m", "t", "d"].forEach(function (d) {
      Object.keys(deviceRules[d]).forEach(function (eid) {
        var props = deviceRules[d][eid];
        if (props && Object.keys(props).length) arr.push({ css: true, eid: eid, d: d, props: props });
      });
    });
    return arr;
  }

  // ── Draft + server ──────────────────────────────────────────────────────
  var draftTimer = null;
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot())); } catch (e) {} }
  function scheduleDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(function () { saveDraft(); flash("Draft saved"); }, 500); }
  function readDraft() { try { var v = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); return Array.isArray(v) ? v : null; } catch (e) { return null; } }
  var IN_IFRAME = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  // This editor instance is the phone-width CANVAS inside the mobile-editing overlay.
  // It hides its own toolbar and lets the parent page's big-screen toolbar drive it.
  var ME_CANVAS = IN_IFRAME && /[?&]mecanvas=1/.test(location.search);
  function reveal() {
    try {
      document.documentElement.classList.remove("jv-pending");
      // Inside an overlay iframe the body's opacity transition can stall at 0 (black
      // screen). Force it visible — there's no flash to hide in an embedded canvas.
      if (IN_IFRAME) { document.body.style.transition = "none"; document.body.style.opacity = "1"; }
    } catch (e) {}
  }
  function loadPage(pg) {
    // 5s timeout so a hung network can't keep the page hidden — it resolves (null) and reveals.
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 5000) : null;
    return fetch(endpointFor(pg) + "&t=" + Date.now(), { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (timer) clearTimeout(timer); return r.ok ? r.json() : null; })
      .catch(function () { if (timer) clearTimeout(timer); return null; });
  }
  function loadExperiment() {
    return loadPage(EXP_PAGE).then(function (d) {
      var e = d && Array.isArray(d.edits) && d.edits[0];
      return (e && e.exp) ? e : null;
    });
  }
  // ── A/B helpers: visitor id, conversion beacons, sticky bucketing ──────────
  function inIframe() { try { return window.self !== window.top; } catch (e) { return true; } }
  function visitorId() {
    try { var k = "jv_vid", v = localStorage.getItem(k); if (!v) { v = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem(k, v); } return v; }
    catch (e) { return ""; }
  }
  function beacon(pageKey, ev) {
    var url = APIBASE + "/pageview?p=" + encodeURIComponent(pageKey) + "&e=" + ev + "&v=" + encodeURIComponent(visitorId()) + "&_=" + Date.now();
    // sendBeacon survives the page unload that a conversion click triggers (the
    // .pricing-cta navigates to the external order form) — Image src would be cancelled.
    try { if (navigator.sendBeacon && navigator.sendBeacon(url)) return; } catch (e) {}
    try { var i = new Image(); i.src = url; } catch (e) {}
  }
  function bucket(splitB) {
    try {
      var k = "jv_ab:" + SITE, v = localStorage.getItem(k);
      if (v !== "A" && v !== "B") { v = (Math.random() * 100 < (splitB || 50)) ? "B" : "A"; localStorage.setItem(k, v); }
      return v;
    } catch (e) { return "A"; }
  }
  function wireConversionTracking() {
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest(".pricing-cta, [data-jv-convert]");
      if (a) beacon(trackKey, "optin");   // a plan/order-form click = the sales-page "conversion"
    }, true);
  }

  // ── Status ──────────────────────────────────────────────────────────────
  var statusEl, statusTimer;
  function flash(msg, persist) {
    if (!statusEl) return;
    statusEl.textContent = msg; statusEl.classList.add("show");
    clearTimeout(statusTimer);
    if (!persist) statusTimer = setTimeout(function () { statusEl.classList.remove("show"); }, 1800);
  }

  // ── Active element + toolbar sync ───────────────────────────────────────
  var activeEl = null, ui = {};
  function setActive(el) {
    if (activeEl) activeEl.classList.remove("jv-active");
    activeEl = el;
    if (el) el.classList.add("jv-active");
    if (ui.sel) ui.sel.textContent = el ? ("<" + el.tagName.toLowerCase() + ">") : "—";
    syncToolbar();
    if (ME_CANVAS && ME_SELECT_CB) { try { ME_SELECT_CB(meActiveInfo()); } catch (e) {} }
  }
  function syncToolbar() {
    if (!activeEl || !ui.font) return;
    var cs = getComputedStyle(activeEl);
    ui.font.value = fontNameFromCss(activeEl.style.fontFamily || cs.fontFamily) || "";
    ui.size.value = Math.round(parseFloat(cs.fontSize)) || "";
    ui.color.value = rgbToHex(cs.color);
    ui.bold.classList.toggle("on", parseInt(cs.fontWeight, 10) >= 600);
    ui.italic.classList.toggle("on", cs.fontStyle === "italic");
    ["left", "center", "right"].forEach(function (a) {
      ui["align_" + a].classList.toggle("on", (cs.textAlign === a) || (a === "left" && cs.textAlign === "start"));
    });
  }
  function rgbToHex(rgb) {
    var m = (rgb || "").match(/\d+/g); if (!m) return "#000000";
    return "#" + m.slice(0, 3).map(function (n) { var h = parseInt(n, 10).toString(16); return h.length === 1 ? "0" + h : h; }).join("");
  }
  // Only these are ever published — never anything that could inject script.
  var ATTR_KEYS = ["href", "target", "rel", "data-buy", "src", "alt"];
  function markAttr(el) { if (el) el.setAttribute("data-edited-attr", "1"); }
  function markStyled(el) { if (el && !el.hasAttribute("data-etext")) el.setAttribute("data-edited-style", "1"); }

  // ── Mobile-canvas bridge ────────────────────────────────────────────────
  // When this editor is the phone canvas (ME_CANVAS), its own toolbar is hidden and
  // the parent page's big-screen toolbar drives it through window.__jvME. Editing
  // functions act on the live selection / activeEl in THIS (iframe) document, so
  // text formatting uses the user's in-canvas selection (kept current by
  // selectionchange) and block ops use the block they tapped in the phone.
  var ME_SELECT_CB = null;
  function meActiveInfo() {
    if (!activeEl || activeEl === document.body) return null;
    var cs = getComputedStyle(activeEl);
    return {
      tag: activeEl.tagName.toLowerCase(),
      text: !!(activeEl.closest && activeEl.closest("[data-etext]")),
      font: fontNameFromCss(activeEl.style.fontFamily || cs.fontFamily) || "",
      size: Math.round(parseFloat(cs.fontSize)) || "",
      color: rgbToHex(cs.color),
      bold: parseInt(cs.fontWeight, 10) >= 600,
      italic: cs.fontStyle === "italic",
      align: cs.textAlign === "start" ? "left" : cs.textAlign
    };
  }
  function setupMobileCanvasBridge() {
    document.body.classList.add("jv-mecanvas");   // CSS hides the in-canvas toolbar/launcher
    window.__jvME = {
      ready: true,
      dup: function () { duplicateActive(); },
      moveUp: function () { moveActive(-1); },
      moveDown: function () { moveActive(1); },
      remove: function () { removeActive(); },
      parent: function () { selectParent(); },
      pad: function (d) { adjustPad(d); },
      gap: function (d) { adjustMar(d); },
      align: function (a) { if (activeEl) { pushUndo(); setAlign(activeEl, a); markStyled(activeEl); scheduleDraft(); syncToolbar(); if (ME_SELECT_CB) ME_SELECT_CB(meActiveInfo()); } },
      bold: function () { applyStyle("bold"); syncToolbar(); },
      italic: function () { applyStyle("italic"); syncToolbar(); },
      style: function (prop, val) { applyStyle(prop, val); if (ME_SELECT_CB) ME_SELECT_CB(meActiveInfo()); },
      sizeStep: function (d) { var cur = 16; if (activeEl) cur = Math.round(parseFloat(getComputedStyle(activeEl).fontSize)) || 16; applyStyle("font-size", Math.max(8, Math.min(200, cur + d)) + "px"); if (ME_SELECT_CB) ME_SELECT_CB(meActiveInfo()); },
      setSize: function (px) { applyStyle("font-size", Math.max(8, Math.min(200, px)) + "px"); },
      color: function (c) { applyStyle("color", c); },
      fontNames: function () { return FONTS.map(function (f) { return f.name; }); },
      setFont: function (name) { var f = FONTS.find(function (x) { return x.name === name; }); if (f) { loadFont(f.name); applyStyle("font-family", f.css); } },
      clearFmt: function () { var b = document.querySelector(".jv-toolbar .jv-clear"); if (b) b.click(); },
      scope: function (s) { if (ui.scope) { ui.scope.value = s; ui.scope.dispatchEvent(new Event("change")); } },
      getScope: function () { return editScope; },
      insert: function (bt) { addBlock(bt); },
      undo: function () { undo(); },
      redo: function () { redo(); },
      publish: function () { publish(); },
      active: meActiveInfo,
      onSelect: function (cb) { ME_SELECT_CB = cb; }
    };
  }

  // ── Selection-aware styling ─────────────────────────────────────────────
  var savedRange = null;
  document.addEventListener("selectionchange", function () {
    if (!editMode) return;
    var sel = window.getSelection(); if (!sel || !sel.rangeCount) return;
    var r = sel.getRangeAt(0), node = r.commonAncestorContainer;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (el && el.closest("[data-etext]") && !el.closest(".jv-toolbar")) {
      savedRange = r.cloneRange();
      var block = el.closest("[data-etext]");
      if (block && block !== activeEl) setActive(block);
    }
  });
  function restoreSel() { if (!savedRange) return false; if (activeEl) activeEl.focus(); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); return true; }
  function hasTextSelection() { return !!(savedRange && !savedRange.collapsed); }
  // Alignment has to move the RIGHT property: text-align does nothing to the
  // children of a flex or grid container, which is why aligning a row of cards
  // looked broken. Every align entry point goes through this.
  function setAlign(el, value) {
    if (!el) return;
    el.style.textAlign = value;
    var disp = getComputedStyle(el).display;
    if (disp === "flex" || disp === "inline-flex") {
      var dir = getComputedStyle(el).flexDirection || "row";
      var map = { left: "flex-start", center: "center", right: "flex-end" };
      if (dir.indexOf("column") === 0) el.style.alignItems = map[value];
      else el.style.justifyContent = map[value];
    } else if (disp === "grid" || disp === "inline-grid") {
      el.style.justifyItems = { left: "start", center: "center", right: "end" }[value];
    }
  }
  var STYLE_KEY = { color: "color", "font-size": "font-size", "font-family": "font-family", bold: "font-weight", italic: "font-style" };
  function wrapSelection(prop, val) {
    if (!savedRange || savedRange.collapsed) return false;
    var range = savedRange.cloneRange(), span = document.createElement("span");
    span.style.setProperty(prop, val);
    try { range.surroundContents(span); }
    catch (e) { try { var frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); } catch (e2) { return false; } }
    var nr = document.createRange(); nr.selectNodeContents(span); savedRange = nr.cloneRange();
    try { var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(nr); } catch (e3) {}
    if (activeEl) activeEl.classList.add("jv-active");
    return true;
  }
  function applyScopedStyle(kind, value) {
    var eid = activeEl.getAttribute("data-eid"); if (!eid) { flash("Can't scope this element"); return; }
    var d = editScope, props = {};
    if (kind === "font-size") props["font-size"] = value;
    else if (kind === "font-family") { props["font-family"] = value; var fn = fontNameFromCss(value); if (fn) loadFont(fn); }
    else if (kind === "color") props["color"] = value;
    else if (kind === "text-align") props["text-align"] = value;
    else if (kind === "bold") { var w = scopedVal(eid, d, "font-weight") || getComputedStyle(activeEl).fontWeight; props["font-weight"] = (parseInt(w, 10) >= 600 ? "400" : "700"); }
    else if (kind === "italic") { var st = scopedVal(eid, d, "font-style") || getComputedStyle(activeEl).fontStyle; props["font-style"] = (st === "italic" ? "normal" : "italic"); }
    setDeviceRule(eid, props, d);
    var hint = (curViewport() !== d) ? " — switch to " + scopeLabel(d).replace(" only", "") + " view to see it" : "";
    flash(scopeLabel(d) + " · " + (kind === "font-size" ? value : kind) + hint);
  }
  function applyStyle(kind, value) {
    if (!activeEl) { flash("Click some text first"); return; }
    pushUndo();
    if (editScope !== "all") { applyScopedStyle(kind, value); scheduleDraft(); return; }
    // Font SIZE and FONT FAMILY always apply to the WHOLE block (the entire headline),
    // not just a few selected words — and we strip any inner per-word overrides so the
    // whole block becomes uniform. (Color / bold / italic stay per-selection.)
    if (kind === "font-size" || kind === "font-family") {
      activeEl.style.setProperty(kind, value);
      Array.prototype.forEach.call(activeEl.querySelectorAll("[style]"), function (s) { s.style.removeProperty(kind); });
      // An "All devices" change must beat any earlier per-device override of the same
      // property — those are written with !important and would otherwise silently win,
      // so the change appears to do nothing. Clear them so this size actually shows.
      var _eid = activeEl.getAttribute("data-eid"), _cleared = false;
      if (_eid) ["m", "t", "d"].forEach(function (dd) {
        if (deviceRules[dd][_eid] && deviceRules[dd][_eid][kind] != null) { delete deviceRules[dd][_eid][kind]; _cleared = true; }
      });
      if (_cleared) { buildDeviceCSS(); flash("Applied to all devices (cleared the old mobile/desktop size override)"); }
      markStyled(activeEl);
      scheduleDraft();
      return;
    }
    if (hasTextSelection()) {
      if (kind === "bold") wrapSelection("font-weight", "700");
      else if (kind === "italic") wrapSelection("font-style", "italic");
      else wrapSelection(STYLE_KEY[kind] || kind, value);
    } else {
      if (kind === "text-align") setAlign(activeEl, value);
      else if (kind === "color") activeEl.style.color = value;
      else if (kind === "bold") { var on = parseInt(getComputedStyle(activeEl).fontWeight, 10) >= 600; activeEl.style.fontWeight = on ? "400" : "700"; }
      else if (kind === "italic") { var oni = getComputedStyle(activeEl).fontStyle === "italic"; activeEl.style.fontStyle = oni ? "normal" : "italic"; }
      markStyled(activeEl);
    }
    scheduleDraft();
  }

  // ── Spacing ──────────────────────────────────────────────────────────────
  function adjustPad(d) {
    if (!activeEl) { flash("Select a block first"); return; }
    pushUndo();
    var v = Math.max(0, (parseInt(getComputedStyle(activeEl).paddingTop) || 0) + d);
    if (editScope !== "all") { setDeviceRule(activeEl.getAttribute("data-eid"), { "padding-top": v + "px", "padding-bottom": v + "px" }, editScope); scheduleDraft(); flash(scopeLabel(editScope) + " · Padding " + v + "px"); return; }
    activeEl.style.paddingTop = v + "px"; activeEl.style.paddingBottom = v + "px";
    markStyled(activeEl); scheduleDraft(); flash("Padding " + v + "px");
  }
  function adjustMar(d) {
    if (!activeEl) { flash("Select a block first"); return; }
    pushUndo();
    var v = Math.max(0, (parseInt(getComputedStyle(activeEl).marginTop) || 0) + d);
    if (editScope !== "all") { setDeviceRule(activeEl.getAttribute("data-eid"), { "margin-top": v + "px", "margin-bottom": v + "px" }, editScope); scheduleDraft(); flash(scopeLabel(editScope) + " · Spacing " + v + "px"); return; }
    activeEl.style.marginTop = v + "px"; activeEl.style.marginBottom = v + "px";
    markStyled(activeEl); scheduleDraft(); flash("Spacing " + v + "px");
  }

  // ── Select-parent + Remove ──────────────────────────────────────────────
  function selectParent() {
    if (!activeEl) { flash("Click something to select it first"); return; }
    var p = activeEl.parentElement;
    while (p && p !== document.body && !(p.hasAttribute && p.hasAttribute("data-eid"))) p = p.parentElement;
    if (p && p !== document.body && p.hasAttribute("data-eid")) {
      setActive(p); p.scrollIntoView({ block: "center", behavior: "smooth" });
      flash("Selected the surrounding <" + p.tagName.toLowerCase() + ">");
    } else flash("Reached the top of the page");
  }
  function removeActive(optEl, skipConfirm) {
    var el = (optEl && optEl.nodeType === 1) ? optEl : activeEl;
    if (!el || el === document.body) { flash("Click something to select it first"); return; }
    if (editScope !== "all") {
      var heid = el.getAttribute("data-eid");
      if (!heid) { flash("Can't hide this element on one device"); return; }
      pushUndo();
      setDeviceRule(heid, { display: "none" }, editScope);
      scheduleDraft();
      flash("Hidden on " + scopeLabel(editScope) + " — Undo to restore, Publish to apply");
      return;
    }
    if (!skipConfirm) {
      var label = el.tagName.toLowerCase();
      var preview = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!confirm('Remove this <' + label + '>' + (preview ? ' ("' + preview + '…")' : '') +
                   ' and everything inside it?\n\nNothing goes live until you Publish — "Discard draft" undoes it.')) return;
    }
    pushUndo();
    var eid = el.getAttribute("data-eid");
    var parent = el.parentElement;
    if (el.hasAttribute("data-ins")) { /* inserted block: just drop it from DOM */ }
    else if (eid) removedEids[eid] = true;
    var next = parent;
    el.parentNode.removeChild(el);
    if (parent) markReordered(parent);
    if (activeEl === el) setActive(next && next !== document.body && next.hasAttribute("data-eid") ? next : null);
    scheduleDraft(); flash(skipConfirm ? "Removed — Undo (⌘Z) to restore · Publish to make it live" : "Removed — Publish to make it live");
  }

  // ── Blocks: add / duplicate / move ──────────────────────────────────────
  function blockHTML(type, payload) {
    switch (type) {
      case "cols1": return '<section style="padding:56px 24px;"><div class="jv-cols" data-cols="1" style="max-width:1120px;margin:0 auto;"><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 1 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div></div></section>';
      case "cols2": return '<section style="padding:56px 24px;"><div class="jv-cols" data-cols="2" style="max-width:1120px;margin:0 auto;"><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 1 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 2 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div></div></section>';
      case "cols3": return '<section style="padding:56px 24px;"><div class="jv-cols" data-cols="3" style="max-width:1120px;margin:0 auto;"><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 1 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 2 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 3 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div></div></section>';
      case "cols4": return '<section style="padding:56px 24px;"><div class="jv-cols" data-cols="4" style="max-width:1120px;margin:0 auto;"><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 1 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 2 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 3 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div><div class="jv-col" data-etext="1" style="font-family:Inter,sans-serif;font-size:1.02rem;line-height:1.7;">Column 4 — click to edit, or select this column and use ➕ Insert to drop a heading, image or video inside it.</div></div></section>';
      case "h1": return '<div style="max-width:1060px;margin:0 auto;padding:12px 24px;"><h1 data-etext="1" style="font-family:Montserrat,sans-serif;font-size:2.6rem;font-weight:800;line-height:1.2;margin:0;">New H1 heading</h1></div>';
      case "h2": return '<div style="max-width:1060px;margin:0 auto;padding:12px 24px;"><h2 data-etext="1" style="font-family:Montserrat,sans-serif;font-size:2rem;font-weight:800;line-height:1.2;margin:0;">New H2 heading</h2></div>';
      case "h3": return '<div style="max-width:1060px;margin:0 auto;padding:12px 24px;"><h3 data-etext="1" style="font-family:Montserrat,sans-serif;font-size:1.5rem;font-weight:800;line-height:1.2;margin:0;">New H3 heading</h3></div>';
      case "h4": return '<div style="max-width:1060px;margin:0 auto;padding:12px 24px;"><h4 data-etext="1" style="font-family:Montserrat,sans-serif;font-size:1.2rem;font-weight:800;line-height:1.2;margin:0;">New H4 heading</h4></div>';
      case "divider": return '<div style="max-width:1060px;margin:0 auto;padding:20px 24px;"><hr style="border:0;border-top:1px solid rgba(11,13,16,.14);margin:0;"></div>';
      case "section": return '<section style="padding:64px 24px;"><div style="max-width:1060px;margin:0 auto;text-align:center;"><div data-etext="1" style="font-family:Montserrat,sans-serif;font-size:2rem;font-weight:800;line-height:1.2;margin-bottom:12px;">New section heading</div><div data-etext="1" style="font-family:Inter,sans-serif;font-size:1.05rem;line-height:1.7;opacity:.85;">Add your text here, then use ➕ Add to drop images, video or buttons into this section.</div></div></section>';
      case "heading": return '<div style="max-width:1060px;margin:0 auto;padding:14px 24px;"><div data-etext="1" style="font-family:Montserrat,sans-serif;font-size:2rem;font-weight:800;line-height:1.2;">New heading</div></div>';
      case "text": return '<div style="max-width:1060px;margin:0 auto;padding:14px 24px;"><div data-etext="1" style="font-family:Inter,sans-serif;font-size:1.05rem;line-height:1.7;">New text block — click to edit.</div></div>';
      case "button": return '<div style="text-align:center;padding:18px 24px;"><a href="#" data-etext="1" style="display:inline-block;background:#1a5cff;color:#fff;font-family:Montserrat,sans-serif;font-weight:800;padding:14px 34px;border-radius:8px;text-decoration:none;">Click me</a></div>';
      case "image": return '<div style="text-align:center;padding:16px 24px;"><img src="' + payload + '" alt="" style="max-width:100%;height:auto;border-radius:12px;"></div>';
      case "video": return '<div style="max-width:860px;margin:0 auto;padding:16px 24px;"><div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;background:#000;"><iframe src="' + payload + '" style="position:absolute;inset:0;width:100%;height:100%;border:0;" allow="autoplay;fullscreen;picture-in-picture" allowfullscreen></iframe></div></div>';
      case "spacer": return '<div style="height:48px;"></div>';
      case "faq": return '<div class="faq-item">' +
        '<button class="faq-question" type="button" onclick="if(window.toggleFaq)toggleFaq(this)" data-etext="1">Your new question goes here? <span class="arrow">+</span></button>' +
        '<div class="faq-answer"><p data-etext="1">Type the answer to this question here. Click to edit.</p></div>' +
        '</div>';
    }
    return "";
  }
  function toEmbed(u) {
    u = (u || "").trim();
    var yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (yt) return "https://www.youtube.com/embed/" + yt[1] + "?rel=0";
    var vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vm) return "https://player.vimeo.com/video/" + vm[1];
    if (/player\.vimeo\.com|youtube\.com\/embed/.test(u)) return u;
    return null;
  }
  function chooseImage(cb) {
    var upload = confirm("OK = upload an image from your computer.\nCancel = paste an image URL instead.");
    if (!upload) { var url = prompt("Paste an image URL:"); cb(url && url.trim()); return; }
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) { cb(null); return; }
      var pw = localStorage.getItem(PW_KEY) || prompt("Enter your dashboard password to upload:"); if (!pw) { cb(null); return; }
      var fr = new FileReader();
      fr.onload = function () {
        flash("Uploading image…", true);
        fetch(UPLOAD, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw, filename: f.name, contentType: f.type, dataBase64: fr.result }) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.url) { localStorage.setItem(PW_KEY, pw); cb(d.url); } else { alert("Upload failed: " + ((d && d.error) || "unknown")); cb(null); } })
          .catch(function () { alert("Upload network error."); cb(null); });
      };
      fr.readAsDataURL(f);
    };
    inp.click();
  }
  function doInsert(html, anchor) {
    pushUndo();
    var tmp = document.createElement("div"); tmp.innerHTML = html.trim();
    var node = tmp.firstElementChild; if (!node) return;
    tagNew(node);
    var after = anchor || (activeEl && activeEl !== document.body ? activeEl : null);
    // If a column itself is selected, the block belongs INSIDE it — that's what
    // makes "customise the items within the columns" work.
    if (after && after.classList && after.classList.contains("jv-col")) after.appendChild(node);
    else if (after && after.insertAdjacentElement) after.insertAdjacentElement("afterend", node);
    else (document.getElementById("jv-wrapper") || document.body).appendChild(node);
    if (editMode) { if (node.hasAttribute("data-etext")) node.contentEditable = "true"; node.querySelectorAll("[data-etext]").forEach(function (e) { e.contentEditable = "true"; }); }
    setActive(node); node.scrollIntoView({ block: "center", behavior: "smooth" });
    scheduleDraft(); flash("Block added — edit it, then Publish");
  }
  function addBlock(type) {
    if (type === "image") { chooseImage(function (url) { if (url) doInsert(blockHTML("image", url)); }); return; }
    if (type === "video") { var u = prompt("Paste a YouTube or Vimeo link:"); if (!u) return; var e = toEmbed(u); if (!e) { alert("Couldn't read that video link."); return; } doInsert(blockHTML("video", e)); return; }
    // A new FAQ must drop in after the whole FAQ item, not inside one (toggleFaq uses nextElementSibling).
    if (type === "faq") {
      var found = faqList();
      if (found && found.kind === "details") {
        var row = (activeEl && activeEl.closest) ? activeEl.closest("details") : null;
        if (!row) { var all = found.list.querySelectorAll("details"); row = all[all.length - 1] || null; }
        doInsert('<details open><summary data-etext="1">Your new question goes here?</summary>' +
                 '<p class="a" data-etext="1">Type the answer here.</p></details>', row);
        return;
      }
      var fi = (activeEl && activeEl.closest) ? activeEl.closest(".faq-item") : null;
      doInsert(blockHTML("faq"), fi); return;
    }
    doInsert(blockHTML(type));
  }
  // Inline "➕ Add a question" button under the FAQ list (edit mode only) — so adding
  // FAQs never depends on finding the ➕ Add button in the crowded bottom toolbar.
  // It carries no data-eid / data-etext / data-ins, so it's invisible to snapshot()
  // (never published) and to the auto-tagger (created at runtime, no id shift).
  // Edit-mode FAQ controls: a per-question "⧉ Duplicate" + "🗑 Delete" toolbar on
  // each .faq-item, plus an "➕ Add a question" button under the list. All carry no
  // data-eid/data-etext/data-ins so they never publish and never shift ids; cleanOuter()
  // also strips them from any inserted/duplicated HTML.
  function removeFaqDecor() {
    Array.prototype.forEach.call(document.querySelectorAll(".jv-faq-tools, .jv-faq-adder"), function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
  }
  function duplicateFaqItem(item) {
    if (!item) return;
    pushUndo();
    removeFaqDecor();                       // strip controls so the clone is clean
    var clone = item.cloneNode(true);
    clone.removeAttribute("data-eid"); clone.removeAttribute("data-ins"); clone.removeAttribute("data-edited-style");
    if (clone.classList) clone.classList.remove("jv-active");
    Array.prototype.forEach.call(clone.querySelectorAll("[data-eid]"), function (e) { e.removeAttribute("data-eid"); });
    Array.prototype.forEach.call(clone.querySelectorAll("[data-ins]"), function (e) { e.removeAttribute("data-ins"); });
    Array.prototype.forEach.call(clone.querySelectorAll(".jv-faq-tools, .jv-faq-adder, .jv-inserter"), function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
    Array.prototype.forEach.call(clone.querySelectorAll(".jv-active"), function (e) { e.classList.remove("jv-active"); });
    tagNew(clone);                          // fresh ids + data-ins → persists as one insert
    item.insertAdjacentElement("afterend", clone);
    if (editMode) Array.prototype.forEach.call(clone.querySelectorAll("[data-etext]"), function (e) { e.contentEditable = "true"; });
    registerFonts(clone);
    decorateFaqs();                         // re-add controls to all items incl. the copy
    setActive(clone); clone.scrollIntoView({ block: "center", behavior: "smooth" });
    scheduleDraft(); flash("FAQ duplicated — edit the copy, then Publish");
  }
  function deleteFaqItem(item) {
    if (!item) return;
    var preview = (item.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);
    if (!confirm('Delete this FAQ' + (preview ? ' ("' + preview + '…")' : '') + '?\n\nNothing goes live until you Publish.')) return;
    pushUndo();
    var eid = item.getAttribute("data-eid");
    if (!item.hasAttribute("data-ins") && eid) removedEids[eid] = true;
    if (item.parentNode) item.parentNode.removeChild(item);
    setActive(null); decorateFaqs();
    scheduleDraft(); flash("FAQ removed — Publish to make it live");
  }
  // A FAQ list is either the editor's own .faq-list of .faq-item divs, or a plain
  // container of <details> rows. Both get the same Duplicate / Delete / Add tools.
  function faqList() {
    var l = document.querySelector(".faq-list");
    if (l) return { list: l, sel: ".faq-item", kind: "item" };
    var d = document.querySelector("details");
    if (d && d.parentNode && d.parentNode.querySelectorAll("details").length) {
      return { list: d.parentNode, sel: "details", kind: "details" };
    }
    return null;
  }

  // ── <summary> steals the space bar ──────────────────────────────────────
  // A focused <summary> treats Space (and Enter) as "toggle this disclosure", so
  // typing a space in a FAQ question opened/closed the row instead of inserting
  // anything. While editing, type the character ourselves and swallow the toggle.
  // Clicks are swallowed for the same reason — a row must not collapse under you.
  document.addEventListener("keydown", function (e) {
    if (!editMode) return;
    var s = e.target && e.target.closest && e.target.closest("summary");
    if (!s || s.contentEditable !== "true") return;
    if (e.key === " " || e.key === "Spacebar" || e.keyCode === 32) {
      e.preventDefault(); e.stopPropagation();
      document.execCommand("insertText", false, " ");
    } else if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();      // a question is one line
    }
  }, true);
  document.addEventListener("click", function (e) {
    if (!editMode) return;
    var s = e.target && e.target.closest && e.target.closest("summary");
    if (s) { e.preventDefault(); var d = s.closest("details"); if (d) d.open = true; }
  }, true);

  function decorateFaqs() {
    removeFaqDecor();
    if (!editMode) return;
    var found = faqList(); if (!found) return;
    var list = found.list;
    var items = list.querySelectorAll(found.sel);
    if (!items.length) return;
    Array.prototype.forEach.call(items, function (item) {
      var tools = document.createElement("div"); tools.className = "jv-faq-tools";
      var dup = document.createElement("button"); dup.type = "button"; dup.className = "jv-faq-dup"; dup.textContent = "⧉ Duplicate";
      dup.addEventListener("click", function () { duplicateFaqItem(item); });
      var del = document.createElement("button"); del.type = "button"; del.className = "jv-faq-del"; del.textContent = "🗑 Delete";
      del.addEventListener("click", function () { deleteFaqItem(item); });
      tools.appendChild(dup); tools.appendChild(del);
      item.appendChild(tools);             // after the answer; faq-question is still child[0] so toggleFaq() works
    });
    var adder = document.createElement("button"); adder.type = "button"; adder.className = "jv-faq-adder"; adder.textContent = "➕ Add a question";
    adder.addEventListener("click", function () {
      var its = list.querySelectorAll(found.sel);
      if (its.length) setActive(its[its.length - 1]);
      addBlock("faq");
      decorateFaqs();
    });
    list.appendChild(adder);
  }
  function duplicateActive() {
    if (!activeEl || activeEl === document.body) { flash("Select a block first"); return; }
    pushUndo();
    var clone = activeEl.cloneNode(true);
    clone.removeAttribute("data-eid"); clone.removeAttribute("data-moved"); clone.removeAttribute("data-ins"); clone.removeAttribute("data-edited-style"); clone.removeAttribute("data-jv-label");
    clone.querySelectorAll(".jv-section-tools, .jv-faq-tools, .jv-faq-adder, .jv-inserter").forEach(function (e) { e.remove(); });   // never clone editor decor
    clone.querySelectorAll("[data-eid]").forEach(function (e) { e.removeAttribute("data-eid"); });
    clone.querySelectorAll("[data-ins]").forEach(function (e) { e.removeAttribute("data-ins"); });
    clone.querySelectorAll("[data-jv-label]").forEach(function (e) { e.removeAttribute("data-jv-label"); });
    tagNew(clone);
    activeEl.insertAdjacentElement("afterend", clone);
    if (editMode) { if (clone.hasAttribute("data-etext")) clone.contentEditable = "true"; clone.querySelectorAll("[data-etext]").forEach(function (e) { e.contentEditable = "true"; }); }
    registerFonts(clone);
    setActive(clone); clone.scrollIntoView({ block: "center", behavior: "smooth" });
    scheduleDraft(); flash("Block duplicated");
  }
  function moveActive(dir) {
    if (!activeEl || activeEl === document.body) { flash("Select a block first"); return; }
    pushUndo();
    var el = activeEl, parent = el.parentElement; if (!parent) return;
    if (dir < 0) { var prev = el.previousElementSibling; if (!prev) { flash("Already at the top of its section"); return; } parent.insertBefore(el, prev); }
    else { var next = el.nextElementSibling; if (!next) { flash("Already at the bottom of its section"); return; } parent.insertBefore(next, el); }
    markReordered(parent);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    scheduleDraft(); flash(dir < 0 ? "Moved up" : "Moved down");
  }

  // ── Section outlines + per-section toolbar ───────────────────────────────
  // In edit mode every <section> gets a dashed outline, a name tag (pulled from
  // its headline) and a small bar: ✥ drag-to-move · ⧉ duplicate · 🗑 delete.
  // The bar/label carry no data-eid/-etext/-ins and are stripped by cleanOuter
  // + duplicateActive, so they never publish and never shift ids.
  function removeSectionDecor() {
    Array.prototype.forEach.call(document.querySelectorAll(".jv-section-tools"), function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-jv-label]"), function (e) { e.removeAttribute("data-jv-label"); });
  }
  function sectionLabel(sec) {
    var h = sec.querySelector(".section-label, .section-title, h1, h2, h3");
    var t = h ? (h.textContent || "").replace(/\s+/g, " ").trim() : "";
    return t ? (t.length > 34 ? t.slice(0, 34) + "…" : t) : "Section";
  }

  // ── Drop zones ───────────────────────────────────────────────────────────
  // A thin strip in every gap between blocks. Invisible until you're near it;
  // click it and a new section lands exactly there. Built fresh after any
  // structural change, and stripped from every snapshot (see cleanContent).
  function removeInserters() {
    Array.prototype.forEach.call(document.querySelectorAll(".jv-inserter"), function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
  }
  function makeInserter(container, before) {
    var strip = document.createElement("div");
    strip.className = "jv-inserter";
    // self-describing, so "where would this land?" is inspectable
    strip.setAttribute("data-jv-into", container.className || container.tagName);
    strip.setAttribute("data-jv-before", before ? (before.className || before.tagName) : "(end)");
    strip.setAttribute("contenteditable", "false");
    strip.setAttribute("data-noedit", "");
    strip.innerHTML = '<span class="jv-ins-line"></span><button type="button" class="jv-ins-btn">＋ Add section here</button><span class="jv-ins-line"></span>';
    strip.addEventListener("click", function (e) {
      e.stopPropagation(); e.preventDefault();
      insertSectionAt(container, before);
    });
    return strip;
  }
  function insertSectionAt(container, before) {
    pushUndo();
    var tmp = document.createElement("div");
    tmp.innerHTML = blockHTML("section").trim();
    var node = tmp.firstElementChild; if (!node) return;
    tagNew(node);
    if (before && before.parentNode === container) container.insertBefore(node, before);
    else container.appendChild(node);
    if (editMode) node.querySelectorAll("[data-etext]").forEach(function (e) { e.contentEditable = "true"; });
    setActive(node);
    decorateSections(); decorateInserters();
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    scheduleDraft();
    flash("Section added — edit it, then Publish");
  }

  // Light up only the two gaps either side of the block under the pointer. Every
  // other strip stays inert, so nothing intercepts a click meant for the text.
  function markNearInserters(node) {
    Array.prototype.forEach.call(document.querySelectorAll(".jv-inserter.near"), function (s) { s.classList.remove("near"); });
    if (!node || !node.closest || node.closest(".jv-inserter")) return;
    var a = sectionAnchor(node);
    if (!a) return;
    [a.previousElementSibling, a.nextElementSibling].forEach(function (s) {
      if (s && s.classList && s.classList.contains("jv-inserter")) s.classList.add("near");
    });
  }

  function decorateInserters() {
    removeInserters();
    if (!editMode) return;
    var root = document.querySelector("main") || document.getElementById("jv-wrapper");
    if (!root) return;                       // header/footer/nav never get drop zones
    var containers = [root];
    Array.prototype.forEach.call(root.querySelectorAll("section, .wrap"), function (c) {
      if (c.closest(".jv-toolbar, .jv-outline, .jv-preview-overlay, [data-noedit]")) return;
      containers.push(c);
    });
    containers.forEach(function (c) {
      var kids = Array.prototype.filter.call(c.children, function (el) {
        return !el.classList.contains("jv-inserter")
            && !el.classList.contains("jv-section-tools")
            && !el.classList.contains("jv-faq-tools")
            && !el.classList.contains("jv-faq-adder")
            && el.tagName !== "SCRIPT" && el.tagName !== "STYLE";
      });
      if (!kids.length) return;
      kids.forEach(function (k) { c.insertBefore(makeInserter(c, k), k); });
      c.appendChild(makeInserter(c, null));
    });
  }

  function decorateSections() {
    removeSectionDecor();
    if (!editMode) return;
    Array.prototype.forEach.call(document.querySelectorAll("section"), function (sec) {
      if (!sec.getAttribute("data-eid")) return;        // need an id to move/remove
      sec.setAttribute("data-jv-label", sectionLabel(sec));
      var bar = document.createElement("div"); bar.className = "jv-section-tools"; bar.contentEditable = "false";
      var drag = document.createElement("button"); drag.type = "button"; drag.className = "jv-sec-btn jv-sec-drag"; drag.title = "Drag to move this section up or down the page"; drag.setAttribute("draggable", "true"); drag.textContent = "✥ Move";
      drag.addEventListener("dragstart", function (e) { startReorderDrag(sec, e, true); });
      var lbl = document.createElement("span"); lbl.className = "jv-sec-label"; lbl.textContent = sectionLabel(sec);
      var dup = document.createElement("button"); dup.type = "button"; dup.className = "jv-sec-btn jv-sec-dup"; dup.title = "Duplicate this whole section"; dup.textContent = "⧉ Duplicate";
      dup.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); setActive(sec); duplicateActive(); decorateSections(); });
      var del = document.createElement("button"); del.type = "button"; del.className = "jv-sec-btn jv-sec-del"; del.title = "Delete this whole section"; del.textContent = "🗑";
      del.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); removeActive(sec, false); decorateSections(); });
      bar.appendChild(drag); bar.appendChild(lbl); bar.appendChild(dup); bar.appendChild(del);
      sec.appendChild(bar);
    });
    if (outlinePanel && outlinePanel.classList.contains("open")) renderOutline();   // keep the navigator in sync
  }

  // ── Section navigator panel ──────────────────────────────────────────────
  // A side panel that lists every section as a small draggable chip. Drag the
  // chips to reorder — the matching full-size section moves on the page to match.
  // Far easier than dragging giant sections around. Click a chip to jump to it.
  var outlinePanel = null, outlineList = null, outlineDragChip = null;
  function buildOutline() {
    if (outlinePanel) return;
    // (The open/close button now lives in the toolbar as "☰ Sections".)
    outlinePanel = document.createElement("div"); outlinePanel.className = "jv-outline";
    outlinePanel.innerHTML = '<div class="jv-outline-head"><span>Sections — drag to reorder</span><button type="button" class="jv-outline-x" title="Close">×</button></div>';
    outlineList = document.createElement("div"); outlineList.className = "jv-outline-list";
    outlinePanel.appendChild(outlineList);
    document.body.appendChild(outlinePanel);
    outlinePanel.querySelector(".jv-outline-x").addEventListener("click", function () { toggleOutline(false); });

    outlineList.addEventListener("dragover", function (e) {
      if (!outlineDragChip) return;
      var over = e.target.closest && e.target.closest(".jv-outline-item");
      if (!over || over === outlineDragChip) return;
      e.preventDefault();
      var r = over.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      clearOutlineMarkers(); over.classList.add(after ? "jv-oi-after" : "jv-oi-before");
    });
    outlineList.addEventListener("drop", function (e) {
      if (!outlineDragChip) return;
      e.preventDefault();
      var over = e.target.closest && e.target.closest(".jv-outline-item");
      if (!over || over === outlineDragChip) { clearOutlineMarkers(); return; }
      var r = over.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      var dragSec = byEid(outlineDragChip.getAttribute("data-sec-eid"));
      var targetSec = byEid(over.getAttribute("data-sec-eid"));
      if (dragSec && targetSec && dragSec.parentElement) {
        pushUndo();
        if (after) { over.insertAdjacentElement("afterend", outlineDragChip); targetSec.insertAdjacentElement("afterend", dragSec); }
        else { over.insertAdjacentElement("beforebegin", outlineDragChip); targetSec.insertAdjacentElement("beforebegin", dragSec); }
        markReordered(dragSec.parentElement);
        // NOTE: don't rebuild the chip list here — the chip + the section (with its
        // attached on-page bar) are already moved in place. Rebuilding mid-drag would
        // destroy the drag source and jam the next drag. Just renumber.
        renumberOutline();
        scheduleDraft(); flash("Section moved — Publish to make it live");
      }
      clearOutlineMarkers();
    });
  }
  function renumberOutline() {
    if (!outlineList) return;
    Array.prototype.forEach.call(outlineList.children, function (chip, i) {
      var n = chip.querySelector(".jv-oi-num"); if (n) n.textContent = (i + 1);
    });
  }
  function clearOutlineMarkers() {
    if (!outlineList) return;
    Array.prototype.forEach.call(outlineList.querySelectorAll(".jv-oi-before, .jv-oi-after"), function (c) { c.classList.remove("jv-oi-before", "jv-oi-after"); });
  }
  function renderOutline() {
    if (!outlineList) return;
    outlineList.innerHTML = "";
    Array.prototype.forEach.call(document.querySelectorAll("section"), function (sec, i) {
      var eid = sec.getAttribute("data-eid"); if (!eid) return;
      var chip = document.createElement("div");
      chip.className = "jv-outline-item"; chip.setAttribute("draggable", "true"); chip.setAttribute("data-sec-eid", eid);
      var grip = document.createElement("span"); grip.className = "jv-oi-grip"; grip.textContent = "⠿";
      var num = document.createElement("span"); num.className = "jv-oi-num"; num.textContent = (i + 1);
      var label = document.createElement("span"); label.className = "jv-oi-label"; label.textContent = sectionLabel(sec);
      chip.appendChild(grip); chip.appendChild(num); chip.appendChild(label);
      chip.addEventListener("dragstart", function (e) { outlineDragChip = chip; chip.classList.add("jv-oi-dragging"); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", eid); } catch (_) {} });
      chip.addEventListener("dragend", function () { chip.classList.remove("jv-oi-dragging"); clearOutlineMarkers(); outlineDragChip = null; });
      chip.addEventListener("click", function (e) { if (e.target.closest(".jv-oi-grip")) return; var s = byEid(eid); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); });
      outlineList.appendChild(chip);
    });
  }
  function toggleOutline(force) {
    if (!outlinePanel) return;
    var open = (force !== undefined) ? force : !outlinePanel.classList.contains("open");
    if (open) { renderOutline(); outlinePanel.classList.add("open"); }
    else { outlinePanel.classList.remove("open"); }
  }

  // ── Mobile preview (phone-width iframe of the live draft) ────────────────
  var previewOverlay = null;
  function setViewActive(mobile) {
    var d = document.querySelector(".jv-view-d"), m = document.querySelector(".jv-view-m");
    if (d) d.classList.toggle("active", !mobile);
    if (m) m.classList.toggle("active", mobile);
  }
  var ME_SWATCHES = ["#ffffff", "#1a5cff", "#1a5cff", "#0b0c0b", "#9aa19a", "#ffd27a", "#e07a7a", "#3b82f6"];
  function openMobilePreview() {
    try { saveDraft(); } catch (e) {}                 // the canvas reads the latest draft from localStorage
    if (previewOverlay) { previewOverlay.remove(); previewOverlay = null; }
    // The phone is a CLEAN canvas (its own toolbar is hidden via ?mecanvas=1). All the
    // editing controls live on the big screen in the panel below and drive the canvas
    // through its window.__jvME bridge — so you never edit through a cramped phone bar.
    var src = location.pathname + "?edit=1&mecanvas=1" + (EDIT_VARIANT === "B" ? "&variant=B" : "") + "&_=" + Date.now();
    previewOverlay = document.createElement("div");
    previewOverlay.className = "jv-preview-overlay";
    previewOverlay.innerHTML =
      '<div class="jv-preview-topbar">' +
        '<span class="jv-me-title">📱 Editing the <b>mobile</b> view — controls are down here, the phone is just the preview.</span>' +
        '<span class="jv-preview-zoom"><button type="button" class="jv-zoom-out" title="Zoom out">－</button>' +
        '<button type="button" class="jv-zoom-in" title="Zoom in">＋</button></span>' +
        '<button type="button" class="jv-preview-close jv-pc-top">✓ Done — back to desktop</button>' +
      '</div>' +
      '<div class="jv-preview-stage"><div class="jv-preview-phone"><iframe class="jv-preview-frame" title="Mobile editing canvas" src="' + src + '"></iframe></div></div>' +
      '<div class="jv-me-panel">' +
        '<span class="jv-me-scope-wrap" title="Where these edits apply">Edits apply to ' +
          '<select class="jv-me-scope"><option value="m">📱 Mobile only</option><option value="all">🌐 All devices</option><option value="d">💻 Desktop only</option></select></span>' +
        '<span class="jv-me-sel" title="What you have selected in the phone">Tap a block in the phone →</span>' +
        '<span class="jv-me-grp">' +
          '<select class="jv-me-font" title="Font"><option value="">Font…</option></select>' +
          '<button class="jv-me-btn jv-me-b" type="button" title="Bold"><b>B</b></button>' +
          '<button class="jv-me-btn jv-me-i" type="button" title="Italic"><i>I</i></button>' +
          '<button class="jv-me-btn jv-me-sz" data-d="-1" type="button" title="Smaller">A−</button>' +
          '<button class="jv-me-btn jv-me-sz" data-d="1" type="button" title="Bigger">A+</button>' +
          '<span class="jv-me-swatches"></span>' +
          '<button class="jv-me-btn jv-me-al" data-a="left" type="button" title="Align left">☰</button>' +
          '<button class="jv-me-btn jv-me-al" data-a="center" type="button" title="Align center">☷</button>' +
          '<button class="jv-me-btn jv-me-al" data-a="right" type="button" title="Align right">☲</button>' +
        '</span>' +
        '<span class="jv-me-grp">' +
          '<button class="jv-me-btn jv-me-dup" type="button" title="Duplicate block">⧉</button>' +
          '<button class="jv-me-btn jv-me-up" type="button" title="Move up">↑</button>' +
          '<button class="jv-me-btn jv-me-down" type="button" title="Move down">↓</button>' +
          '<button class="jv-me-btn jv-me-parent" type="button" title="Select surrounding section">⤴</button>' +
          '<button class="jv-me-btn jv-me-rm jv-me-danger" type="button" title="Delete block">🗑</button>' +
          '<span class="jv-me-lbl">Pad</span><button class="jv-me-btn jv-me-pad" data-d="-8" type="button">−</button><button class="jv-me-btn jv-me-pad" data-d="8" type="button">+</button>' +
          '<span class="jv-me-lbl">Gap</span><button class="jv-me-btn jv-me-gap" data-d="-8" type="button">−</button><button class="jv-me-btn jv-me-gap" data-d="8" type="button">+</button>' +
        '</span>' +
        '<span class="jv-me-grp jv-me-ins-wrap"><button class="jv-me-btn jv-me-insert" type="button" title="Insert a block">➕ Insert</button>' +
          '<div class="jv-me-insmenu"></div></span>' +
        '<span class="jv-me-spacer"></span>' +
        '<button class="jv-me-btn jv-me-undo" type="button" title="Undo">↶</button>' +
        '<button class="jv-me-btn jv-me-redo" type="button" title="Redo">↷</button>' +
        '<button class="jv-me-btn jv-me-primary jv-me-publish" type="button">Publish</button>' +
        '<button class="jv-me-btn jv-me-close" type="button">✓ Done</button>' +
      '</div>';
    document.body.appendChild(previewOverlay);

    var phone = previewOverlay.querySelector(".jv-preview-phone");
    var zoom = 1;
    function applyZoom() { phone.style.transform = "translate(-50%, -50%) scale(" + zoom + ")"; }
    applyZoom();
    previewOverlay.querySelector(".jv-zoom-in").addEventListener("click", function () { zoom = Math.min(1.8, zoom + 0.15); applyZoom(); });
    previewOverlay.querySelector(".jv-zoom-out").addEventListener("click", function () { zoom = Math.max(0.7, zoom - 0.15); applyZoom(); });
    previewOverlay.querySelectorAll(".jv-preview-close, .jv-me-close").forEach(function (b) { b.addEventListener("click", function () { closeMobilePreview(true); }); });

    wireMobilePanel(previewOverlay);
    setViewActive(true);
  }

  // Wire the big-screen control panel to the phone canvas once its bridge is ready.
  function wireMobilePanel(ov) {
    var frame = ov.querySelector(".jv-preview-frame");
    var panel = ov.querySelector(".jv-me-panel");
    var selLbl = panel.querySelector(".jv-me-sel");
    var fontSel = panel.querySelector(".jv-me-font");
    var scopeSel = panel.querySelector(".jv-me-scope");

    panel.querySelector(".jv-me-swatches").innerHTML = ME_SWATCHES.map(function (c) {
      return '<button class="jv-me-sw" type="button" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
    }).join("");

    function whenReady(cb) {
      var tries = 0;
      (function poll() {
        var w = null; try { w = frame.contentWindow; } catch (e) {}
        if (w && w.__jvME && w.__jvME.ready) { cb(w.__jvME); return; }
        if (tries++ > 150) return;          // ~15s — give up quietly
        setTimeout(poll, 100);
      })();
    }
    function disablePanel(on) { panel.classList.toggle("jv-me-loading", !!on); }
    disablePanel(true);

    whenReady(function (me) {
      disablePanel(false);
      // Default new edits to Mobile-only (that's the point of this view); selectable.
      try { me.scope("m"); } catch (e) {}
      scopeSel.value = "m";
      scopeSel.addEventListener("change", function () { me.scope(scopeSel.value); });

      // Fonts
      try {
        var names = me.fontNames() || [];
        fontSel.innerHTML = '<option value="">Font…</option>' + names.map(function (n) { return '<option value="' + n + '">' + n + "</option>"; }).join("");
      } catch (e) {}
      fontSel.addEventListener("change", function () { if (fontSel.value) me.setFont(fontSel.value); });

      // Selection feedback from the phone → panel
      me.onSelect(function (info) {
        if (!info) { selLbl.textContent = "Tap a block in the phone →"; selLbl.classList.remove("on"); panel.classList.remove("jv-me-has-sel"); return; }
        selLbl.innerHTML = "Selected: <b>&lt;" + info.tag + "&gt;</b>"; selLbl.classList.add("on");
        panel.classList.add("jv-me-has-sel");
        fontSel.value = info.font || "";
        panel.querySelector(".jv-me-b").classList.toggle("on", !!info.bold);
        panel.querySelector(".jv-me-i").classList.toggle("on", !!info.italic);
        panel.querySelectorAll(".jv-me-al").forEach(function (b) { b.classList.toggle("on", b.dataset.a === info.align); });
      });

      var on = function (sel, fn) { var el = panel.querySelector(sel); if (el) el.addEventListener("click", function (e) { e.preventDefault(); fn(); }); };
      on(".jv-me-b", function () { me.bold(); });
      on(".jv-me-i", function () { me.italic(); });
      panel.querySelectorAll(".jv-me-sz").forEach(function (b) { b.addEventListener("click", function () { me.sizeStep(parseInt(b.dataset.d, 10) > 0 ? 2 : -2); }); });
      panel.querySelectorAll(".jv-me-sw").forEach(function (b) { b.addEventListener("click", function () { me.color(b.dataset.c); }); });
      panel.querySelectorAll(".jv-me-al").forEach(function (b) { b.addEventListener("click", function () { me.align(b.dataset.a); }); });
      on(".jv-me-dup", function () { me.dup(); });
      on(".jv-me-up", function () { me.moveUp(); });
      on(".jv-me-down", function () { me.moveDown(); });
      on(".jv-me-parent", function () { me.parent(); });
      on(".jv-me-rm", function () { me.remove(); });
      panel.querySelectorAll(".jv-me-pad").forEach(function (b) { b.addEventListener("click", function () { me.pad(parseInt(b.dataset.d, 10)); }); });
      panel.querySelectorAll(".jv-me-gap").forEach(function (b) { b.addEventListener("click", function () { me.gap(parseInt(b.dataset.d, 10)); }); });
      on(".jv-me-undo", function () { me.undo(); });
      on(".jv-me-redo", function () { me.redo(); });
      on(".jv-me-publish", function () { me.publish(); });

      // Insert menu
      var insWrap = panel.querySelector(".jv-me-ins-wrap"), insMenu = panel.querySelector(".jv-me-insmenu");
      insMenu.innerHTML = [["section", "▭ Section"], ["heading", "H Heading"], ["text", "¶ Text"], ["button", "⬚ Button"], ["image", "🖼 Image"], ["video", "🎬 Video"], ["spacer", "↕ Spacer"]]
        .map(function (b) { return '<button type="button" data-bt="' + b[0] + '">' + b[1] + "</button>"; }).join("");
      panel.querySelector(".jv-me-insert").addEventListener("click", function (e) { e.stopPropagation(); insWrap.classList.toggle("open"); });
      insMenu.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { insWrap.classList.remove("open"); me.insert(b.dataset.bt); }); });
      document.addEventListener("click", function () { insWrap.classList.remove("open"); });
    });
  }
  function closeMobilePreview(sync) {
    var wasOpen = !!previewOverlay;
    if (previewOverlay) { previewOverlay.remove(); previewOverlay = null; }
    setViewActive(false);
    // Pull any edits made in the mobile canvas back into this desktop view so the
    // two never drift (and Publish here can't overwrite them with a stale state).
    if (sync && wasOpen) { try { var d = readDraft(); if (d) applyState(d); } catch (e) {} }
  }

  // ── In-place hover tools ─────────────────────────────────────────────────
  // A small floating icon bar that pins to whatever block you hover in edit
  // mode — images get a quick 🗑, sections/cards get ⧉ ↑ ↓ 🗑 — so you can
  // trim/duplicate/reorder right where you're looking instead of scrolling to
  // the toolbar. The bar lives at body level (excluded from publish/undo via
  // contentNodes + the click-ignore list) and reuses duplicateActive /
  // moveActive / removeActive, so behaviour matches the toolbar exactly.
  var hoverTools = null, hoverEl = null, hoverHideTimer = null;
  function scheduleHoverHide() { clearTimeout(hoverHideTimer); hoverHideTimer = setTimeout(hideHoverTools, 180); }
  function hideHoverTools() {
    clearTimeout(hoverHideTimer);
    if (hoverEl && hoverEl.classList) hoverEl.classList.remove("jv-hovered");
    hoverEl = null;
    if (hoverTools) hoverTools.classList.remove("show");
  }
  function hoverTargetFrom(node) {
    if (!node || !node.closest) return null;
    if (node.closest(".jv-hover-tools, .jv-toolbar, .jv-launcher, .jv-addmenu, .jv-section-tools, .jv-faq-tools, .jv-faq-adder, .jv-inserter, .jv-actions, .jv-outline, .jv-outline-toggle, #jv-result")) return null;
    var img = node.closest(".transform-img");
    if (img) return { el: img, kind: "img" };
    var card = node.closest(".review-card, .testimonial-card, .plan-card, .pricing-card, .faq-item");
    if (card && card.hasAttribute("data-eid")) return { el: card, kind: "block" };
    // A <details> FAQ row is one block. Without this the hover 🗑 fell through to
    // closest("section") and deleting one question wiped the whole FAQ.
    var det = node.closest("details");
    if (det && det.hasAttribute("data-eid")) return { el: det, kind: "block" };

    // Anything not on that hardcoded card list used to fall straight through to
    // closest("section") — so hovering one paragraph targeted the WHOLE section
    // and the 🗑 wiped it. Aim at the nearest real content block instead; whole
    // sections still have their own tools chip at the top-left.
    var col = node.closest(".jv-col");
    if (col && col.hasAttribute("data-eid")) return { el: col, kind: "block" };
    var leaf = node.closest("[data-etext]");
    if (leaf && leaf.hasAttribute("data-eid") && leaf.tagName !== "SECTION") return { el: leaf, kind: "block" };
    var blk = node.closest("p,h1,h2,h3,h4,h5,h6,li,figure,blockquote,img,article,.jv-cols");
    if (blk && blk.hasAttribute("data-eid") && blk.tagName !== "SECTION") return { el: blk, kind: "block" };

    // A block-level <div> — a card, a callout, a boxed CTA — matched none of the
    // tags above, so it fell through to `return null` and never got a hover bar.
    // That made whole sections impossible to delete or move: you could empty one
    // out child by child, but the container itself stayed put forever.
    // Walk out to the outermost element that still sits inside the page's content
    // wrapper and offer THAT, so 🗑 removes the entire block. Runs after the
    // paragraph checks, so hovering text still targets the text.
    var host = node.closest(".wrap, .sheet, main, article, section, body");
    if (host) {
      var top = node;
      while (top && top.parentElement && top.parentElement !== host) top = top.parentElement;
      if (top && top !== host && top.nodeType === 1 && top.hasAttribute && top.hasAttribute("data-eid")
          && !top.closest(".jv-toolbar, .jv-launcher, [data-noedit]")) {
        return { el: top, kind: "block" };
      }
    }

    // A standalone button/link that isn't inside a <section> used to fall through
    // to `return null`, so it never got a hover bar — and with no hover bar there
    // was no ⚡, i.e. no way to set where it points. Catch it here, after the
    // paragraph checks, so a link inside a paragraph still targets the paragraph.
    var lnk = node.closest("a,button");
    if (lnk && lnk.hasAttribute("data-eid") && !lnk.closest(".jv-toolbar,.jv-launcher,[data-noedit]")) {
      return { el: lnk, kind: "block" };
    }

    var sec = node.closest("section");
    if (sec) return { el: sec, kind: "section" };
    return null;
  }
  function repositionHover() {
    if (!hoverTools || !hoverEl || !hoverTools.classList.contains("show")) return;
    if (!document.body.contains(hoverEl)) { hideHoverTools(); return; }
    var r = hoverEl.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { hideHoverTools(); return; }

    // The bar used to sit ON the block's top-right corner, so it covered the very
    // text you were trying to click. Put it in the empty margin beside the block
    // instead: right of it if there's room, otherwise left, otherwise above.
    var bw = hoverTools.offsetWidth || 170;
    var bh = hoverTools.offsetHeight || 38;
    var GAP = 10, EDGE = 6;
    var top = Math.max(EDGE, Math.min(r.top, window.innerHeight - bh - EDGE));
    var left;

    if (r.right + GAP + bw <= window.innerWidth - EDGE) {
      left = r.right + GAP;                                  // right-hand margin
    } else if (r.left - GAP - bw >= EDGE) {
      left = r.left - GAP - bw;                              // left-hand margin
    } else {
      left = Math.max(EDGE, Math.min(r.right - bw, window.innerWidth - bw - EDGE));
      top  = r.top - bh - 6;                                 // sit fully above
      if (top < EDGE) top = r.bottom + 6;                    // ...or fully below
    }
    hoverTools.style.top = top + "px";
    hoverTools.style.left = left + "px";
  }
  function showHoverFor(el, kind) {
    if (hoverEl && hoverEl !== el && hoverEl.classList) hoverEl.classList.remove("jv-hovered");
    hoverEl = el;
    if (el.classList) el.classList.add("jv-hovered");
    var isImg = kind === "img";
    ["dup", "drag"].forEach(function (k) {       // images drag directly (no handle); only 🗑 shows
      var b = hoverTools.querySelector(".jv-ht-" + k); if (b) b.style.display = isImg ? "none" : "";
    });
    hoverTools.classList.add("show");
    repositionHover();
  }
  var hoverNode = null;   // the element actually under the pointer, before widening
  function onHoverMove(e) {
    if (!editMode || !hoverTools) return;
    if (e.target && e.target.closest && e.target.closest(".jv-hover-tools")) { clearTimeout(hoverHideTimer); return; }
    var t = hoverTargetFrom(e.target);
    if (!t) { scheduleHoverHide(); return; }
    hoverNode = e.target;
    markNearInserters(e.target);
    clearTimeout(hoverHideTimer);
    if (t.el !== hoverEl || !hoverTools.classList.contains("show")) showHoverFor(t.el, t.kind);
  }


  // ── What a button does ───────────────────────────────────────────────────
  // Three answers cover everything on these pages: open the pop-up, go to a
  // link, or scroll to a section. Whatever is chosen is stored as attributes,
  // which now publish.
  var actionMenu = null;
  function closeActionMenu() { if (actionMenu) { actionMenu.remove(); actionMenu = null; } }
  function targetLink(el) {
    if (!el || !el.closest) return null;
    if (el.matches && el.matches("a,button")) return el;
    return el.closest("a,button") || el.querySelector("a,button");
  }
  function applyAction(el, kind, value) {
    pushUndo();
    if (kind === "popup") {
      el.setAttribute("data-buy", "1");
      if (el.tagName === "A") el.setAttribute("href", "#start");
      el.removeAttribute("target"); el.removeAttribute("rel"); el.removeAttribute("onclick");
      flash("This button now opens the pop-up");
    } else if (kind === "link") {
      el.removeAttribute("data-buy"); el.removeAttribute("onclick");
      el.setAttribute("href", value);
      if (/^https?:/i.test(value) && value.indexOf(location.host) === -1) {
        el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener");
      } else { el.removeAttribute("target"); el.removeAttribute("rel"); }
      flash("This button now goes to " + value);
    } else if (kind === "scroll") {
      el.removeAttribute("data-buy"); el.removeAttribute("onclick");
      el.removeAttribute("target"); el.removeAttribute("rel");
      el.setAttribute("href", value);
      flash("This button now scrolls to " + value);
    }
    markAttr(el);
    scheduleDraft();
  }
  function sectionChoices() {
    var out = [], seen = {};
    var SKIP = { A:1, BUTTON:1, INPUT:1, IMG:1, HEADER:1, FOOTER:1, NAV:1, FORM:1, LABEL:1 };
    document.querySelectorAll("[id]").forEach(function (s) {
      if (out.length > 11 || !s.id || seen[s.id]) return;
      if (SKIP[s.tagName]) return;
      if (s.closest(".jv-toolbar, .jv-outline, .jv-actions, .cp, [data-noedit]")) return;
      var h = s.querySelector("h1,h2,h3");
      // a place on the page is either a real <section> or something with a heading
      if (s.tagName !== "SECTION" && !h) return;
      var label = (h ? h.textContent : s.id).replace(/\s+/g, " ").trim().slice(0, 34);
      if (!label) return;
      seen[s.id] = 1;
      out.push({ id: s.id, label: label });
    });
    return out;
  }
  function openActionMenu(el, anchorRect) {
    closeActionMenu();
    var link = targetLink(el);
    if (!link) { flash("Point at a button or a link first"); return; }
    var m = document.createElement("div");
    m.className = "jv-actions";
    m.setAttribute("data-noedit", "");
    var now = link.hasAttribute("data-buy") ? "popup"
            : (link.getAttribute("href") || "").charAt(0) === "#" ? "scroll" : "link";
    m.innerHTML =
      '<div class="jv-act-h">What should this button do?</div>' +
      '<button type="button" class="jv-act" data-k="popup">' + (now === "popup" ? "✓ " : "") + 'Open the pop-up</button>' +
      '<button type="button" class="jv-act" data-k="link">' + (now === "link" ? "✓ " : "") + 'Go to a link…</button>' +
      '<button type="button" class="jv-act" data-k="scroll">' + (now === "scroll" ? "✓ " : "") + 'Scroll to a section…</button>' +
      '<div class="jv-act-now">Now: ' + (now === "popup" ? "opens the pop-up" : (link.getAttribute("href") || "nothing")) + '</div>';
    document.body.appendChild(m);
    var top = (anchorRect ? anchorRect.bottom : 80) + 8, left = anchorRect ? anchorRect.left : 40;
    m.style.top = Math.min(top, window.innerHeight - 190) + "px";
    m.style.left = Math.max(8, Math.min(left, window.innerWidth - 240)) + "px";
    actionMenu = m;

    m.addEventListener("click", function (e) {
      var b = e.target.closest(".jv-act"); if (!b) return;
      e.stopPropagation(); e.preventDefault();
      var k = b.getAttribute("data-k");
      if (k === "popup") { applyAction(link, "popup"); closeActionMenu(); return; }
      if (k === "link") {
        // Chrome ignores prompt() inside a cross-origin iframe, and that is exactly
        // how the Control Center loads these pages — so the old prompt silently did
        // nothing when editing from the dashboard. Ask for the address inline instead.
        m.innerHTML =
          '<div class="jv-act-h">Link to where?</div>' +
          '<input type="text" class="jv-act-in" spellcheck="false" placeholder="trtguy.com" />' +
          '<div class="jv-act-row">' +
            '<button type="button" class="jv-act jv-act-go">Save link</button>' +
            '<button type="button" class="jv-act jv-act-x">Cancel</button>' +
          '</div>' +
          '<div class="jv-act-now">A full address (trtguy.com), a page on this site (pay.html), or an email address.</div>';
        var inp = m.querySelector(".jv-act-in");
        inp.value = link.getAttribute("href") || "";
        setTimeout(function () { inp.focus(); inp.select(); }, 0);
        // the editor blocks keys elsewhere on the page; keep this field's to itself
        ["keydown", "keypress", "keyup", "input", "mousedown", "click"].forEach(function (t) {
          inp.addEventListener(t, function (ev) { ev.stopPropagation(); }, true);
        });
        function save() {
          var v = normalizeUrl(inp.value);
          if (!v) { inp.focus(); return; }
          applyAction(link, "link", v);
          closeActionMenu();
        }
        inp.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") { ev.preventDefault(); save(); }
          if (ev.key === "Escape") { ev.preventDefault(); closeActionMenu(); }
        });
        m.addEventListener("click", function (e2) {
          if (e2.target.closest(".jv-act-go")) { e2.stopPropagation(); e2.preventDefault(); save(); }
          if (e2.target.closest(".jv-act-x"))  { e2.stopPropagation(); e2.preventDefault(); closeActionMenu(); }
        });
        return;
      }
      // scroll: replace the menu with the list of sections
      var choices = sectionChoices();
      m.innerHTML = '<div class="jv-act-h">Scroll to which section?</div>' +
        (choices.length ? choices.map(function (c) {
          return '<button type="button" class="jv-act" data-id="#' + c.id + '">' + c.label + '</button>';
        }).join("") : '<div class="jv-act-now">This page has no named sections yet.</div>');
      m.addEventListener("click", function (e2) {
        var c = e2.target.closest("[data-id]"); if (!c) return;
        e2.stopPropagation(); e2.preventDefault();
        applyAction(link, "scroll", c.getAttribute("data-id"));
        closeActionMenu();
      });
    });
  }
  document.addEventListener("click", function (e) {
    if (actionMenu && !e.target.closest(".jv-actions") && !e.target.closest(".jv-ht-link")) closeActionMenu();
  }, true);

  // ── Add a link: ⌘K / Ctrl+K, or the 🔗 Link button in the toolbar ─────────
  // Works two ways, whichever matches what you're pointing at:
  //   • text selected  → that text becomes the link
  //   • a button/link  → that button's destination changes
  function editableSelection() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var n = sel.getRangeAt(0).commonAncestorContainer;
    n = n.nodeType === 1 ? n : n.parentElement;
    if (!n || !n.closest) return null;
    if (n.closest(".jv-toolbar, .jv-actions, [data-noedit]")) return null;
    if (!n.closest('[data-etext], [contenteditable="true"]')) return null;
    var a = n.closest("a");
    return {
      mode: "selection",
      range: sel.getRangeAt(0).cloneRange(),
      current: a ? (a.getAttribute("href") || "") : "",
      rect: sel.getRangeAt(0).getBoundingClientRect()
    };
  }
  function linkTarget(snapshot) {
    var s = snapshot || editableSelection();
    if (s) return s;
    var cand = (activeEl && targetLink(activeEl)) || (hoverEl && targetLink(hoverEl)) || null;
    if (cand && !cand.closest(".jv-toolbar, [data-noedit]")) {
      return { mode: "element", el: cand, current: cand.getAttribute("href") || "",
               rect: cand.getBoundingClientRect() };
    }
    return null;
  }
  function openLinkBox(t) {
    closeActionMenu();
    var m = document.createElement("div");
    m.className = "jv-actions jv-linkbox";
    m.setAttribute("data-noedit", "");
    m.innerHTML =
      '<div class="jv-act-h">' +
        (t.mode === "selection" ? "Link this text to\u2026" : "Link this button to\u2026") +
      '</div>' +
      '<input type="text" class="jv-act-in" spellcheck="false" placeholder="Paste a link, or type trtguy.com" />' +
      '<div class="jv-act-row">' +
        '<button type="button" class="jv-act jv-act-go">Save link</button>' +
        (t.current ? '<button type="button" class="jv-act jv-act-rm">Remove</button>' : '') +
        '<button type="button" class="jv-act jv-act-x">Cancel</button>' +
      '</div>' +
      '<div class="jv-act-now">Paste and press Enter. Publish when you\u2019re done.</div>';
    document.body.appendChild(m);
    actionMenu = m;

    var r = t.rect || { bottom: 120, top: 100, left: 40 };
    var BOXH = 200, BARH = 78;                    // keep clear of the bottom toolbar
    var room = window.innerHeight - BARH;
    var top = (r.bottom || 0) + 10;
    if (top + BOXH > room) top = (r.top || 0) - BOXH - 10;   // flip above the target
    top = Math.max(8, Math.min(top, room - BOXH));
    m.style.top = top + "px";
    m.style.left = Math.max(8, Math.min((r.left || 40), window.innerWidth - 250)) + "px";

    var inp = m.querySelector(".jv-act-in");
    inp.value = t.current || "";
    setTimeout(function () { inp.focus(); inp.select(); }, 0);
    ["keydown", "keypress", "keyup", "input", "mousedown", "click"].forEach(function (evt) {
      inp.addEventListener(evt, function (ev) { ev.stopPropagation(); }, true);
    });

    function reselect() {
      if (t.mode !== "selection" || !t.range) return;
      var sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(t.range);
    }
    function finish(msg) { scheduleDraft(); closeActionMenu(); flash(msg); }
    function save() {
      var url = normalizeUrl(inp.value);
      if (!url) { inp.focus(); return; }
      pushUndo();
      if (t.mode === "element") { applyAction(t.el, "link", url); closeActionMenu(); return; }
      reselect();
      document.execCommand("createLink", false, url);
      var sel = window.getSelection();
      var node = sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
      node = node && node.nodeType === 1 ? node : (node && node.parentElement);
      var a = node && node.closest ? node.closest("a") : null;
      if (a && /^https?:/i.test(url) && url.indexOf(location.host) === -1) {
        a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener");
      }
      finish("Linked to " + url);
    }
    function remove() {
      pushUndo();
      if (t.mode === "element") { t.el.removeAttribute("href"); markAttr(t.el); finish("Link removed"); return; }
      reselect();
      document.execCommand("unlink");
      finish("Link removed");
    }
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); save(); }
      if (ev.key === "Escape") { ev.preventDefault(); closeActionMenu(); }
    });
    m.addEventListener("click", function (e2) {
      if (e2.target.closest(".jv-act-go")) { e2.stopPropagation(); e2.preventDefault(); save(); }
      if (e2.target.closest(".jv-act-rm")) { e2.stopPropagation(); e2.preventDefault(); remove(); }
      if (e2.target.closest(".jv-act-x"))  { e2.stopPropagation(); e2.preventDefault(); closeActionMenu(); }
    });
  }
  function startLinkFlow(snapshot) {
    var t = linkTarget(snapshot);
    if (!t) { flash("Select some text, or click a button first \u2014 then press \u2318K"); return; }
    openLinkBox(t);
  }
  window.__jvStartLinkFlow = startLinkFlow;
  window.__jvLinkSnapshot = editableSelection;

  document.addEventListener("keydown", function (e) {
    if (!editMode) return;
    if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== "k") return;
    if (e.target && e.target.closest && e.target.closest(".jv-act-in")) return;
    e.preventDefault(); e.stopPropagation();
    startLinkFlow(null);
  }, true);

  // ── Add a section below the block you're pointing at ─────────────────────
  // Inserting "afterend" of whatever was selected dropped new sections inside
  // cards and list items. Climb to the block that actually sits in the page's
  // flow first — the child of a <main>, <section> or .wrap — and insert after
  // that, so a new section always lands where the user is looking.
  function sectionAnchor(el) {
    var node = el;
    while (node && node.parentElement) {
      var p = node.parentElement, cls = " " + (p.className || "") + " ";
      if (p.tagName === "MAIN" || p.tagName === "BODY" || p.tagName === "SECTION" ||
          / (wrap|container|jv-wrapper) /.test(cls)) return node;
      node = p;
    }
    return el;
  }
  function addSectionBelow(el) {
    var anchor = sectionAnchor(el);
    if (!anchor) return;
    pushUndo();
    var tmp = document.createElement("div");
    tmp.innerHTML = blockHTML("section").trim();
    var node = tmp.firstElementChild;
    if (!node) return;
    tagNew(node);
    anchor.insertAdjacentElement("afterend", node);
    if (editMode) node.querySelectorAll("[data-etext]").forEach(function (e) { e.contentEditable = "true"; });
    setActive(node);
    decorateSections(); decorateInserters();
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    scheduleDraft();
    flash("Section added below — edit it, then Publish");
  }


  // ── Links ────────────────────────────────────────────────────────────────
  // Anything without a scheme is treated as a full URL unless it looks like an
  // anchor (#pricing), a path (/pay.html) or an email — otherwise "trtguy.com"
  // would resolve relative to the current page and 404.
  function normalizeUrl(raw) {
    var u = String(raw || "").trim();
    if (!u) return "";
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(u)) return u;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return "mailto:" + u;
    return "https://" + u;
  }
  function currentAnchor() {
    var n = savedRange ? savedRange.commonAncestorContainer : null;
    if (n && n.nodeType === 3) n = n.parentNode;
    return n && n.closest ? n.closest("a") : null;
  }
  // After createLink the nodes are rebuilt, so savedRange can point at a detached
  // node — read the live selection instead when looking for what was just made.
  function anchorFromSelection() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    var n = s.getRangeAt(0).commonAncestorContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    return n && n.closest ? n.closest("a") : null;
  }
  function linkSelection() {
    if (!restoreSel()) { flash("Select some text first, then click Link"); return; }
    var existing = currentAnchor();
    if (!hasTextSelection() && !existing) { flash("Select the words you want to link"); return; }
    var url = prompt("Link to where?\n\nA full address (trtguy.com), a page on this site (/pay.html),\nan anchor (#start) or an email address.",
                     existing ? existing.getAttribute("href") || "" : "");
    if (url === null) return;                       // cancelled
    url = normalizeUrl(url);
    pushUndo();
    if (!url) {                                     // cleared the box = remove the link
      restoreSel(); document.execCommand("unlink"); scheduleDraft(); flash("Link removed"); return;
    }
    if (existing && !hasTextSelection()) {
      existing.setAttribute("href", url);
    } else {
      restoreSel();
      document.execCommand("createLink", false, url);
      var a = anchorFromSelection() || currentAnchor();
      if (a) a.setAttribute("href", url);
    }
    // Off-site links open in a new tab so you don't lose the reader.
    var made = anchorFromSelection() || currentAnchor();
    if (made && /^https?:/i.test(url) && url.indexOf(location.host) === -1) {
      made.setAttribute("target", "_blank");
      made.setAttribute("rel", "noopener");
    }
    scheduleDraft();
    flash("Linked to " + url);
  }
  // The hover 🔗 works on a whole button or link rather than a text selection.
  function editHref(el) {
    var a = el && el.closest ? (el.matches("a") ? el : el.closest("a") || el.querySelector("a")) : null;
    if (!a) { flash("That block isn't a link or a button"); return; }
    var url = prompt("Where should this button go?\n\nA full address, a page on this site (/pay.html),\nan anchor (#start) or an email address.",
                     a.getAttribute("href") || "");
    if (url === null) return;
    url = normalizeUrl(url);
    if (!url) { flash("Nothing changed"); return; }
    pushUndo();
    a.setAttribute("href", url);
    a.removeAttribute("onclick");                   // drop any leftover placeholder alert
    if (/^https?:/i.test(url) && url.indexOf(location.host) === -1) {
      a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener");
    } else { a.removeAttribute("target"); a.removeAttribute("rel"); }
    markStyled(a);
    scheduleDraft();
    flash("Button now goes to " + url);
  }

  function buildHoverTools() {
    if (hoverTools) return;
    hoverTools = document.createElement("div");
    hoverTools.className = "jv-hover-tools";
    hoverTools.innerHTML =
      '<button type="button" class="jv-ht jv-ht-add" title="Add a new section directly below this">＋</button>' +
      '<button type="button" class="jv-ht jv-ht-link" title="What this button does — pop-up, link, or scroll">⚡</button>' +
      '<button type="button" class="jv-ht jv-ht-dup" title="Duplicate">⧉</button>' +
      '<button type="button" class="jv-ht jv-ht-drag" title="Drag to reorder" draggable="true">✥</button>' +
      '<button type="button" class="jv-ht jv-ht-del" title="Delete">🗑</button>';
    document.body.appendChild(hoverTools);
    hoverTools.addEventListener("mouseenter", function () { clearTimeout(hoverHideTimer); });
    hoverTools.addEventListener("mouseleave", scheduleHoverHide);
    hoverTools.querySelector(".jv-ht-link").addEventListener("click", function (e) {
      e.stopPropagation(); e.preventDefault();
      if (!hoverEl) return;
      var el = (hoverNode && hoverNode.closest && hoverNode.closest("a,button")) ? hoverNode.closest("a,button") : hoverEl;
      openActionMenu(el, hoverTools.getBoundingClientRect());
    });
    hoverTools.querySelector(".jv-ht-add").addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); if (!hoverEl) return; addSectionBelow(hoverNode || hoverEl); hideHoverTools(); });
    hoverTools.querySelector(".jv-ht-dup").addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); if (!hoverEl) return; setActive(hoverEl); duplicateActive(); hideHoverTools(); });
    hoverTools.querySelector(".jv-ht-del").addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); if (!hoverEl) return; removeActive(hoverEl, true); hideHoverTools(); });
    var dh = hoverTools.querySelector(".jv-ht-drag");
    dh.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); });   // handle is drag-only
    dh.addEventListener("dragstart", function (e) { if (!hoverEl) return; startReorderDrag(hoverEl, e, true); });
    document.addEventListener("mouseover", onHoverMove, true);
    window.addEventListener("scroll", repositionHover, true);
    window.addEventListener("resize", repositionHover);
  }

  // ── Drag-and-drop reordering ─────────────────────────────────────────────
  // Native HTML5 DnD. Two entry points, one engine:
  //   • Transformation images are draggable directly — grab one, drop on another.
  //   • Any section/card carries a ✥ drag handle in its hover bar — grab the
  //     handle to drag the whole block (the block itself stays non-draggable so
  //     its text stays selectable/editable).
  // A drop reorders within the dragged element's own parent and persists via
  // markReordered() → snapshot {reorder,eid,order} (container keeps a stable
  // runtime data-eid, so order replays deterministically on reload).
  var dragState = null, dndWired = false, DG = ".transforms-grid .transform-img, .transforms-grid img";
  function setImgDraggable(on) {
    document.querySelectorAll(DG).forEach(function (img) {
      if (on) { img.setAttribute("draggable", "true"); img.classList.add("jv-draggable"); }
      else { img.removeAttribute("draggable"); img.classList.remove("jv-draggable", "jv-dragging", "jv-drop-before", "jv-drop-after"); }
    });
  }
  function clearDropMarkers() {
    Array.prototype.forEach.call(document.querySelectorAll(".jv-drop-before, .jv-drop-after, .jv-swap-target"), function (e) { e.classList.remove("jv-drop-before", "jv-drop-after", "jv-swap-target"); });
  }
  function cleanupDrag() {
    if (dragState && dragState.el) dragState.el.classList.remove("jv-dragging");
    clearDropMarkers(); dragState = null;
  }
  // Swap two elements' positions in the DOM, leaving every other element untouched.
  function swapNodes(a, b) {
    if (a === b || !a.parentNode || !b.parentNode) return;
    var marker = document.createElement("span");
    a.parentNode.insertBefore(marker, a);   // hold a's spot
    b.parentNode.insertBefore(a, b);         // move a into b's spot
    marker.parentNode.insertBefore(b, marker); // move b into a's old spot
    marker.parentNode.removeChild(marker);
  }
  // Walk up from `node` to the direct child of `container` (the sibling-level
  // element under the cursor); null if not inside container or it's the dragged one.
  function siblingUnder(node, container) {
    var t = node;
    while (t && t.parentElement && t.parentElement !== container) t = t.parentElement;
    return (t && t.parentElement === container && t !== container) ? t : null;
  }
  function startReorderDrag(el, e, fromHandle) {
    if (!el || !el.parentElement) return;
    // Images SWAP spots (so the rest of the grid never reshuffles); sections INSERT
    // (a vertical stack reorders predictably, no swap needed).
    var swap = !!(el.closest && el.closest(".transforms-grid"));
    dragState = { el: el, container: el.parentElement, swap: swap };
    el.classList.add("jv-dragging");
    if (!fromHandle) hideHoverTools();           // handle lives in the bar — hiding it would abort the drag
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", el.getAttribute("data-eid") || "x"); } catch (_) {}
  }
  function initImageDnD() {
    if (dndWired) return; dndWired = true;
    document.addEventListener("dragstart", function (e) {
      if (!editMode || dragState) return;        // handle-initiated drags set dragState first
      var img = e.target.closest && e.target.closest(DG);
      if (img) startReorderDrag(img, e, false);
    });
    document.addEventListener("dragover", function (e) {
      if (!editMode || !dragState) return;
      var over = siblingUnder(e.target, dragState.container);
      if (over && over !== dragState.el && over.hasAttribute("data-eid")) {
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
        clearDropMarkers();
        if (dragState.swap) {
          over.classList.add("jv-swap-target");      // highlight the image you'll trade spots with
        } else {
          var r = over.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
          over.classList.add(after ? "jv-drop-after" : "jv-drop-before");
        }
      }
    });
    document.addEventListener("drop", function (e) {
      if (!editMode || !dragState) return;
      e.preventDefault();
      var over = siblingUnder(e.target, dragState.container);
      if (over && over !== dragState.el && over.hasAttribute("data-eid")) {
        pushUndo();
        if (dragState.swap) {
          swapNodes(dragState.el, over);             // trade spots — everything else stays put
          markReordered(dragState.container); scheduleDraft(); flash("Swapped — Publish to make it live");
        } else {
          var r = over.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
          if (after) over.insertAdjacentElement("afterend", dragState.el);
          else over.insertAdjacentElement("beforebegin", dragState.el);
          markReordered(dragState.container); scheduleDraft(); flash("Moved — Publish to make it live");
        }
      }
      cleanupDrag();
    });
    document.addEventListener("dragend", function () { cleanupDrag(); hideHoverTools(); });
  }

  // ── Build editor UI ──────────────────────────────────────────────────────
  var editMode = false, addMenu = null;
  function buildUI() {
    var launcher = document.createElement("button");
    launcher.className = "jv-launcher"; launcher.type = "button"; launcher.innerHTML = "✏️ Edit page";
    document.body.appendChild(launcher);

    // Floating "back to Control Center" — shown whenever you're NOT editing (e.g. after Done)
    var home = document.createElement("a");
    home.className = "jv-home-btn"; home.href = CONTROL_CENTER_URL; home.textContent = "← Control Center";
    document.body.appendChild(home);

    var bar = document.createElement("div"); bar.className = "jv-toolbar";
    bar.innerHTML =
      '<span class="jv-tb-brand">✏️ Editing</span>' +
      '<a class="jv-tb-home" href="' + CONTROL_CENTER_URL + '" title="Back to Control Center">← Control Center</a>' +

      // ── Device view toggle (preview how it looks on each) ──
      '<span class="jv-view">' +
        '<button class="jv-view-btn jv-view-d active" type="button" data-view="d" title="Desktop view (edit here)">💻</button>' +
        '<button class="jv-view-btn jv-view-m" type="button" data-view="m" title="Preview mobile">📱</button>' +
      '</span>' +
      '<span class="jv-scope-wrap" title="Where your next edits apply">' +
        '<select class="jv-scope">' +
          '<option value="all">🌐 All devices</option>' +
          '<option value="m">📱 Mobile only</option>' +
          '<option value="t">📲 Tablet only</option>' +
          '<option value="d">💻 Desktop only</option>' +
        '</select>' +
      '</span>' +

      // ── Text formatting (popover) ──
      '<div class="jv-grp">' +
        '<button class="jv-grp-btn" type="button" data-pop="text">🅰 Text</button>' +
        '<div class="jv-pop" data-pop="text">' +
          '<div class="jv-pop-row"><span class="jv-pop-lbl">Font</span><select class="jv-font" title="Font"></select></div>' +
          '<div class="jv-pop-row"><span class="jv-pop-lbl">Size</span>' +
            '<div class="jv-size-wrap"><button class="jv-step" data-d="-1" type="button">−</button>' +
            '<input class="jv-input-size" type="number" min="8" max="200" title="Font size (px)"/>' +
            '<button class="jv-step" data-d="1" type="button">+</button></div>' +
            '<button class="jv-btn jv-bold" type="button" title="Bold"><b>B</b></button>' +
            '<button class="jv-btn jv-italic" type="button" title="Italic"><i>I</i></button></div>' +
          '<div class="jv-pop-row"><span class="jv-pop-lbl">Color</span>' +
            '<span class="jv-color-wrap"><input class="jv-color" type="color" title="Text color"/><span class="jv-swatches"></span></span></div>' +
          '<div class="jv-pop-row"><span class="jv-pop-lbl">Align</span><span class="jv-aligns">' +
            '<button class="jv-btn jv-al" data-a="left" type="button" title="Align left">☰</button>' +
            '<button class="jv-btn jv-al" data-a="center" type="button" title="Align center">☷</button>' +
            '<button class="jv-btn jv-al" data-a="right" type="button" title="Align right">☲</button></span>' +
            '<button class="jv-btn jv-clear" type="button" title="Clear formatting">Clear</button></div>' +
          '<div class="jv-pop-row"><span class="jv-pop-lbl">Link</span>' +
            '<button class="jv-btn jv-link" type="button" title="Turn the selected text into a link">🔗 Link</button>' +
            '<button class="jv-btn jv-unlink" type="button" title="Remove the link from the selected text">Remove</button></div>' +
        '</div>' +
      '</div>' +

      // ── Insert block ──
      '<button class="jv-grp-btn jv-add" type="button" title="Add a block">➕ Insert</button>' +

      // ── Selected block (popover) ──
      '<div class="jv-grp">' +
        '<button class="jv-grp-btn" type="button" data-pop="block">⬚ Block</button>' +
        '<div class="jv-pop" data-pop="block">' +
          '<div class="jv-pop-row"><span class="jv-pop-lbl">Selected</span><span class="jv-selinfo" title="What\'s selected">—</span></div>' +
          '<div class="jv-pop-row">' +
            '<button class="jv-btn jv-dup" type="button" title="Duplicate selected block">⧉ Duplicate</button>' +
            '<button class="jv-btn jv-parent" type="button" title="Select the surrounding section/box">⤴ Parent</button></div>' +
          '<div class="jv-pop-row">' +
            '<button class="jv-btn jv-moveup" type="button" title="Move up">↑ Up</button>' +
            '<button class="jv-btn jv-movedown" type="button" title="Move down">↓ Down</button>' +
            '<button class="jv-btn jv-remove jv-danger" type="button" title="Delete the selected element">🗑 Remove</button></div>' +
          '<div class="jv-pop-row"><span class="jv-pop-lbl">Padding</span>' +
            '<button class="jv-btn jv-padminus" type="button">−</button><button class="jv-btn jv-padplus" type="button">+</button>' +
            '<span class="jv-pop-lbl" style="min-width:auto">Gap</span>' +
            '<button class="jv-btn jv-marminus" type="button">−</button><button class="jv-btn jv-marplus" type="button">+</button></div>' +
        '</div>' +
      '</div>' +

      // ── Sections navigator ──
      '<button class="jv-grp-btn jv-link-btn" type="button" title="Add a link to the selected text or button (⌘K)">🔗 Link</button>' +
      '<button class="jv-grp-btn jv-sections-btn" type="button" title="Reorder sections">☰ Sections</button>' +

      // ── Settings (popover) ──
      '<div class="jv-grp">' +
        '<button class="jv-grp-btn" type="button" data-pop="settings">⚙ Settings</button>' +
        '<div class="jv-pop" data-pop="settings">' +
          '<div class="jv-pop-row"><span class="jv-pop-lbl">Editing</span>' +
            '<select class="jv-variant" title="Which version of the page (A/B test)">' +
              '<option value="A">🅰 Control</option><option value="B">🅱 Variant</option></select></div>' +
          '<div class="jv-pop-sep"></div>' +
          '<div class="jv-pop-row">' +
            '<button class="jv-btn jv-synclive" type="button" title="Replace your unpublished draft with the live published version">⟳ Reload live</button>' +
            '<button class="jv-btn jv-discard" type="button">Discard draft</button></div>' +
        '</div>' +
      '</div>' +

      '<span class="jv-spacer"></span>' +
      '<span class="jv-status"></span>' +
      '<button class="jv-btn jv-undo" type="button" title="Undo (⌘Z / Ctrl+Z)" disabled>↶</button>' +
      '<button class="jv-btn jv-redo" type="button" title="Redo (⌘⇧Z / Ctrl+Shift+Z)" disabled>↷</button>' +
      '<button class="jv-btn jv-publish jv-primary" type="button">Publish</button>' +
      '<button class="jv-btn jv-done" type="button">Done</button>';
    document.body.appendChild(bar);

    // Grouped popovers: a group button opens its menu, closing the others.
    function jvClosePops() {
      bar.querySelectorAll(".jv-pop.open").forEach(function (p) { p.classList.remove("open"); });
      bar.querySelectorAll(".jv-grp-btn.active").forEach(function (b) { b.classList.remove("active"); });
    }
    bar.querySelectorAll(".jv-grp-btn[data-pop]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var name = btn.getAttribute("data-pop");
        var pop = bar.querySelector('.jv-pop[data-pop="' + name + '"]');
        var willOpen = !pop.classList.contains("open");
        jvClosePops();
        if (addMenu) addMenu.classList.remove("open");
        if (willOpen) { pop.classList.add("open"); btn.classList.add("active"); }
      });
    });
    bar.querySelectorAll(".jv-pop").forEach(function (p) { p.addEventListener("click", function (e) { e.stopPropagation(); }); });
    var linkBtn = bar.querySelector(".jv-link-btn"), linkSnap = null;
    // grab the selection on mousedown — by click time the button has taken focus
    linkBtn.addEventListener("mousedown", function () { linkSnap = window.__jvLinkSnapshot(); });
    linkBtn.addEventListener("click", function (e) {
      e.stopPropagation(); e.preventDefault(); jvClosePops();
      if (addMenu) addMenu.classList.remove("open");
      window.__jvStartLinkFlow(linkSnap); linkSnap = null;
    });
    bar.querySelector(".jv-sections-btn").addEventListener("click", function (e) { e.stopPropagation(); jvClosePops(); if (addMenu) addMenu.classList.remove("open"); toggleOutline(); });
    document.addEventListener("click", function () { jvClosePops(); });

    // Device view toggle: 💻 = edit in place, 📱 = phone-width preview of the draft.
    var viewD = bar.querySelector(".jv-view-d"), viewM = bar.querySelector(".jv-view-m");
    viewD.addEventListener("click", function () { closeMobilePreview(); });
    viewM.addEventListener("click", function () { openMobilePreview(); });
    // The Control Center hosts pages in an iframe. Hiding the view toggle there left
    // no way to switch between desktop and mobile, so it now stays put; only the real
    // nested mobile canvas (?preview=1) hides it.
    if (IN_IFRAME && /[?&]preview=1/.test(location.search)) { var vw = bar.querySelector(".jv-view"); if (vw) vw.style.display = "none"; }

    statusEl = bar.querySelector(".jv-status");
    ui.variant = bar.querySelector(".jv-variant");
    ui.variant.value = EDIT_VARIANT;
    bar.classList.toggle("jv-variant-b", EDIT_VARIANT === "B");
    ui.variant.addEventListener("change", function () {
      var want = ui.variant.value === "B" ? "B" : "A";
      if (want === EDIT_VARIANT) return;
      var go = function () {
        var u = location.pathname + "?edit=1" + (want === "B" ? "&variant=B" : "");
        location.href = u;
      };
      // Save current draft first so nothing in-progress is lost on the reload.
      try { saveDraft(); } catch (e) {}
      if (confirm("Switch to editing " + (want === "B" ? "Variant B" : "Control (A)") + "?\n\nYour current draft is saved. Each version is published separately.")) go();
      else ui.variant.value = EDIT_VARIANT;
    });
    ui.scope = bar.querySelector(".jv-scope");
    ui.scope.value = editScope;
    ui.scope.setAttribute("data-scope", editScope);
    ui.scope.addEventListener("change", function () {
      editScope = ui.scope.value;
      ui.scope.setAttribute("data-scope", editScope);   // colours the pill when scoped
      bar.classList.toggle("jv-scoped", editScope !== "all");
      var warn = (editScope !== "all" && curViewport() !== editScope)
        ? " — you're in " + scopeLabel(curViewport()).replace(" only", "") + " view; switch to " + scopeLabel(editScope).replace(" only", "") + " view to preview these"
        : "";
      flash("New edits now apply to: " + scopeLabel(editScope) + warn, true);
    });
    ui.font = bar.querySelector(".jv-font");
    ui.size = bar.querySelector(".jv-input-size");
    ui.color = bar.querySelector(".jv-color");
    ui.link = bar.querySelector(".jv-link");
    ui.unlink = bar.querySelector(".jv-unlink");
    ui.bold = bar.querySelector(".jv-bold");
    ui.italic = bar.querySelector(".jv-italic");
    ui.sel = bar.querySelector(".jv-selinfo");
    ui.align_left = bar.querySelector('.jv-al[data-a="left"]');
    ui.align_center = bar.querySelector('.jv-al[data-a="center"]');
    ui.align_right = bar.querySelector('.jv-al[data-a="right"]');

    ui.font.innerHTML = '<option value="">Font…</option>' + FONTS.map(function (f) { return '<option value="' + f.name + '">' + f.name + "</option>"; }).join("");
    bar.querySelector(".jv-swatches").innerHTML = SWATCHES.map(function (c) { return '<button class="jv-sw" type="button" data-c="' + c + '" style="background:' + c + '"></button>'; }).join("");

    // Preserve text selection when clicking toolbar buttons
    bar.querySelectorAll("button, .jv-sw").forEach(function (b) {
      b.addEventListener("mousedown", function (e) {
        e.preventDefault();
        var sel = window.getSelection();
        if (sel && sel.rangeCount) {
          var r = sel.getRangeAt(0), node = r.commonAncestorContainer;
          var el = node.nodeType === 1 ? node : node.parentElement;
          if (el && el.closest("[data-etext]") && !el.closest(".jv-toolbar")) savedRange = r.cloneRange();
        }
      });
    });

    ui.font.addEventListener("change", function () { var f = FONTS.find(function (x) { return x.name === ui.font.value; }); if (f) { loadFont(f.name); applyStyle("font-family", f.css); } });
    ui.size.addEventListener("input", function () { if (ui.size.value) applyStyle("font-size", ui.size.value + "px"); });
    bar.querySelectorAll(".jv-step").forEach(function (b) { b.addEventListener("click", function () { var cur = parseInt(ui.size.value, 10) || 16; ui.size.value = Math.max(8, Math.min(200, cur + parseInt(b.dataset.d, 10))); applyStyle("font-size", ui.size.value + "px"); }); });
    ui.color.addEventListener("input", function () { applyStyle("color", ui.color.value); });
    bar.querySelectorAll(".jv-sw").forEach(function (s) { s.addEventListener("click", function () { ui.color.value = s.dataset.c; applyStyle("color", s.dataset.c); }); });
    ui.link.addEventListener("click", function () { linkSelection(); });
    ui.unlink.addEventListener("click", function () {
      if (!restoreSel()) { flash("Select the linked text first"); return; }
      pushUndo(); document.execCommand("unlink"); scheduleDraft(); flash("Link removed");
    });
    ui.bold.addEventListener("click", function () { applyStyle("bold"); syncToolbar(); });
    ui.italic.addEventListener("click", function () { applyStyle("italic"); syncToolbar(); });
    bar.querySelectorAll(".jv-al").forEach(function (b) { b.addEventListener("click", function () { if (activeEl) { pushUndo(); setAlign(activeEl, b.dataset.a); markStyled(activeEl); scheduleDraft(); syncToolbar(); } }); });
    bar.querySelector(".jv-clear").addEventListener("click", function () {
      if (!activeEl) { flash("Click some text first"); return; }
      pushUndo();
      if (editScope !== "all") {
        var ceid = activeEl.getAttribute("data-eid");
        if (ceid && deviceRules[editScope][ceid]) { delete deviceRules[editScope][ceid]; buildDeviceCSS(); }
        scheduleDraft(); syncToolbar(); flash("Cleared " + scopeLabel(editScope) + " overrides"); return;
      }
      if (hasTextSelection()) { restoreSel(); document.execCommand("removeFormat"); }
      else { MANAGED.forEach(function (p) { activeEl.style.removeProperty(p); }); }
      scheduleDraft(); syncToolbar();
    });
    bar.querySelector(".jv-padminus").addEventListener("click", function () { adjustPad(-8); });
    bar.querySelector(".jv-padplus").addEventListener("click", function () { adjustPad(8); });
    bar.querySelector(".jv-marminus").addEventListener("click", function () { adjustMar(-8); });
    bar.querySelector(".jv-marplus").addEventListener("click", function () { adjustMar(8); });
    bar.querySelector(".jv-dup").addEventListener("click", duplicateActive);
    bar.querySelector(".jv-moveup").addEventListener("click", function () { moveActive(-1); });
    bar.querySelector(".jv-movedown").addEventListener("click", function () { moveActive(1); });
    bar.querySelector(".jv-parent").addEventListener("click", selectParent);
    bar.querySelector(".jv-remove").addEventListener("click", function () { removeActive(); });
    bar.querySelector(".jv-synclive").addEventListener("click", function () {
      if (!confirm("Reload the LIVE published version into the editor?\n\nThis throws away your current unpublished draft and starts fresh from what visitors see right now.")) return;
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      var u = location.pathname + "?edit=1&fresh=1";
      location.href = u;
    });
    bar.querySelector(".jv-discard").addEventListener("click", discardDraft);
    bar.querySelector(".jv-publish").addEventListener("click", publish);
    bar.querySelector(".jv-done").addEventListener("click", function () { setEdit(false); });
    launcher.addEventListener("click", function () { setEdit(!editMode); });

    // Undo / redo
    ui.undo = bar.querySelector(".jv-undo");
    ui.redo = bar.querySelector(".jv-redo");
    ui.undo.addEventListener("click", undo);
    ui.redo.addEventListener("click", redo);
    updateUndoBtns();
    document.addEventListener("keydown", function (e) {
      if (!editMode) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
    }, true);
    // Space/Enter inside a contenteditable <button> (e.g. FAQ questions) would ACTIVATE
    // the button instead of typing — intercept so the spacebar actually types a space.
    document.addEventListener("keydown", function (e) {
      if (!editMode) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (!t || t.tagName !== "BUTTON" || !t.isContentEditable) return;
      if (e.key === " " || e.key === "Spacebar" || e.keyCode === 32) {
        e.preventDefault();
        try { throw 0; }   // always use the reliable Range insertion below (execCommand is flaky on buttons)
        catch (err) {
          var sel = window.getSelection();
          if (sel && sel.rangeCount) { var r = sel.getRangeAt(0); r.deleteContents(); var n = document.createTextNode(" "); r.insertNode(n); r.setStartAfter(n); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
        }
        scheduleDraft();
      } else if (e.key === "Enter") {
        e.preventDefault();   // keep questions one line; don't activate the button
      }
    }, true);
    document.addEventListener("beforeinput", function (e) {
      if (!editMode) return;
      if (!(e.target.closest && e.target.closest("[data-etext]"))) return;
      if (!typingBurst) { pushUndo(); typingBurst = true; }
      clearTimeout(burstTimer); burstTimer = setTimeout(function () { typingBurst = false; }, 900);
    }, true);

    // Add-block menu
    addMenu = document.createElement("div"); addMenu.className = "jv-addmenu";
    addMenu.innerHTML =
      '<div class="jv-addgrp">Layout</div>'
      + [["section","▭ Section"],["cols1","▯ 1 column"],["cols2","▮▮ 2 columns"],["cols3","▮▮▮ 3 columns"],["cols4","▮▮▮▮ 4 columns"],["spacer","↕ Spacer"],["divider","— Divider"]]
        .map(function (b) { return '<button type="button" data-bt="' + b[0] + '">' + b[1] + "</button>"; }).join("")
      + '<div class="jv-addgrp">Content</div>'
      + [["h1","H1 Heading"],["h2","H2 Heading"],["h3","H3 Heading"],["h4","H4 Heading"],["text","¶ Text"],["button","⬚ Button"],["image","🖼 Image"],["video","🎬 Video"],["faq","❓ FAQ"]]
        .map(function (b) { return '<button type="button" data-bt="' + b[0] + '">' + b[1] + "</button>"; }).join("");
    document.body.appendChild(addMenu);
    var addBtn = bar.querySelector(".jv-add");
    addBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      jvClosePops();
      var r = addBtn.getBoundingClientRect();
      addMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 180)) + "px";
      addMenu.style.top = "auto";
      addMenu.style.bottom = (window.innerHeight - r.top + 6) + "px";   // open upward (toolbar is at the bottom)
      addMenu.classList.toggle("open");
    });
    addMenu.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { addMenu.classList.remove("open"); addBlock(b.dataset.bt); }); });
    document.addEventListener("click", function () { if (addMenu) addMenu.classList.remove("open"); });

    document.addEventListener("focusin", function (e) { var el = e.target.closest && e.target.closest("[data-eid]"); if (el) setActive(el); });
    document.addEventListener("click", function (e) {
      if (!editMode) return;
      if (e.target.closest && e.target.closest(".jv-toolbar, .jv-launcher, .jv-addmenu, .jv-faq-adder, .jv-faq-tools, .jv-hover-tools, .jv-section-tools, .jv-inserter, .jv-actions, .jv-outline, .jv-outline-toggle, .jv-preview-overlay")) return;
      var clickable = e.target.closest && e.target.closest("a, button");
      // In-page nav links (href="#section") are left ALONE so the page's own nav /
      // smooth-scroll runs and you can jump between sections while editing. We also
      // try to scroll there ourselves as a fallback.
      var navHref = clickable && clickable.tagName === "A" ? (clickable.getAttribute("href") || "") : "";
      var isNav = navHref.charAt(0) === "#" && navHref.length > 1;
      if (isNav) {
        var anyN = e.target.closest && e.target.closest("[data-eid]");
        setActive(anyN);
        try { var tg = document.querySelector(navHref); if (tg) tg.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e3) {}
        return;   // don't preventDefault/stopPropagation — let the page navigate
      }
      // For an EDITABLE button/link (FAQ questions are <button data-etext>) don't
      // preventDefault — that blocks the text caret. stopPropagation still stops the
      // button from activating / the link from navigating.
      if (clickable) { e.stopPropagation(); if (!clickable.isContentEditable) e.preventDefault(); }
      var leaf = e.target.closest && e.target.closest("[data-etext]");
      var any = e.target.closest && e.target.closest("[data-eid]");
      setActive(leaf || any);
      // A <button> doesn't receive a text caret on click even when contenteditable —
      // so typing does nothing. Place a caret at the click point ourselves.
      if (leaf && leaf.tagName === "BUTTON" && leaf.isContentEditable) {
        try {
          leaf.focus();
          var cr = null;
          if (document.caretRangeFromPoint) cr = document.caretRangeFromPoint(e.clientX, e.clientY);
          else if (document.caretPositionFromPoint) { var cp = document.caretPositionFromPoint(e.clientX, e.clientY); if (cp) { cr = document.createRange(); cr.setStart(cp.offsetNode, cp.offset); cr.collapse(true); } }
          var s = window.getSelection();
          if (cr && leaf.contains(cr.startContainer)) { s.removeAllRanges(); s.addRange(cr); }
          else { var er = document.createRange(); er.selectNodeContents(leaf); er.collapse(false); s.removeAllRanges(); s.addRange(er); }
        } catch (ce) {}
      }
    }, true);
    document.addEventListener("input", function (e) {
      if (!editMode) return;
      if (e.target.closest && e.target.closest(".jv-toolbar")) return;
      if (e.target.closest && e.target.closest("[data-etext]")) scheduleDraft();
    });
  }

  function setEdit(on) {
    editMode = on;
    document.body.classList.toggle("jv-editing", on);
    document.body.classList.toggle("jv-editing", !!on);
    editable().forEach(function (el) { el.contentEditable = on ? "true" : "false"; });
    var launcher = document.querySelector(".jv-launcher"); if (launcher) launcher.style.display = on ? "none" : "";
    var home = document.querySelector(".jv-home-btn"); if (home) home.style.display = on ? "none" : "";   // floating one only when not editing
    if (!on && addMenu) addMenu.classList.remove("open");
    setImgDraggable(on);
    if (on) { decorateFaqs(); decorateSections(); decorateInserters(); flash("Edit mode — each section is outlined & labeled with ✥ Move / ⧉ Duplicate / 🗑 · drag an image onto another to SWAP spots · Publish when done", true); }
    else { removeFaqDecor(); removeSectionDecor(); removeInserters(); hideHoverTools(); toggleOutline(false); closeMobilePreview(); }
  }

  function discardDraft() {
    if (!confirm("Discard your unpublished draft and reload the live version?")) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    location.reload();
  }

  function showResult(msg, type) {
    var ex = document.getElementById("jv-result"); if (ex) ex.remove();
    var d = document.createElement("div"); d.id = "jv-result"; d.className = "jv-result " + (type || "");
    d.innerHTML = "<span>" + msg + "</span><button type='button' class='jv-result-x'>×</button>";
    document.body.appendChild(d);
    d.querySelector(".jv-result-x").addEventListener("click", function () { d.remove(); });
    if (type === "ok") setTimeout(function () { if (d.parentNode) d.remove(); }, 6000);
  }
  function publish() {
    saveDraft();
    // Sites flagged noAuth publish without a password — the server-side
    // publish_content() skips the check for these site keys, so never prompt.
    var pw = localStorage.getItem(PW_KEY) || "";
    if (!pw && !cfg.noAuth) { pw = prompt("Enter your dashboard admin password to publish:"); if (!pw) return; }
    var btn = document.querySelector(".jv-publish");
    if (btn) { btn.disabled = true; btn.textContent = "Publishing…"; }
    fetch(endpointFor(activePage), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw, edits: snapshot() }) })
      .then(function (r) {
        if (r.status === 401) { localStorage.removeItem(PW_KEY); showResult(cfg.noAuth
          ? "❌ The server rejected this publish. Nothing was saved."
          : "❌ Wrong password — nothing was saved. Click Publish and enter it again.", "err"); return null; }
        if (!r.ok) { return r.json().catch(function () { return {}; }).then(function (e) { showResult("❌ Couldn't publish (" + (e.error || r.status) + "). Try again.", "err"); return null; }); }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        localStorage.setItem(PW_KEY, pw);
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
        showResult("✅ Published! Your changes are now live for everyone.", "ok");
      })
      .catch(function () { showResult("❌ Network error — changes were not saved.", "err"); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = "Publish"; } });
  }

  // Decide which variant this load is, set activePage / ENDPOINT / DRAFT_KEY / trackKey,
  // then load that variant's edits (seeding B from Control the first time it's edited).
  function loadForVariant(exp) {
    var active = !!(exp && exp.active);
    if (EDIT_ENABLED) activeVariant = EDIT_VARIANT;          // editing A or B explicitly
    else if (active) activeVariant = bucket(exp.split);      // visitor → sticky 50/50 bucket
    else activeVariant = "A";
    activePage = (activeVariant === "B") ? VARIANT_B_PAGE : CONTROL_PAGE;
    ENDPOINT = endpointFor(activePage);
    DRAFT_KEY = "jv-draft:" + SITE + ":" + activeVariant + ":" + activePage;
    trackKey = active ? (SITE + "::" + activeVariant) : SITE;

    // Visitors (not editing, not in the dashboard iframe) log an exposure view.
    if (!EDIT_ENABLED && !inIframe()) beacon(trackKey, "view");

    return loadPage(activePage).then(function (d) {
      var hasEdits = d && Array.isArray(d.edits) && d.edits.length;
      if (hasEdits) { applyEdits(d.edits); return; }
      // Variant B is empty → seed it from Control so B starts as a copy of A.
      if (activeVariant === "B") {
        return loadPage(CONTROL_PAGE).then(function (c) {
          if (c && Array.isArray(c.edits)) applyEdits(c.edits);
          seededFromControl = true;
        });
      }
    });
  }

  function init() {
    var _p = new URLSearchParams(location.search);
    loadExperiment()
      .then(function (exp) {
        // ?fresh=1 / ?reset=1 wipes the LOCAL draft (after DRAFT_KEY is variant-correct).
        return loadForVariant(exp).then(function () {
          if (_p.get("fresh") === "1" || _p.get("reset") === "1") { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
        });
      })
      .catch(function () {})
      .then(function () {
        // Reveal ONLY after the published edits (and, in edit mode, the draft) are applied,
        // so the body never paints the original/old source content. The body stays hidden
        // (dark) for the brief fetch window; the index.html safety-net is the only fallback.
        // Mobile-preview iframe: apply the unpublished draft on top of published,
        // then reveal with NO editor chrome — a true rendering at whatever width the
        // iframe is (the parent sizes it to a phone). Same-origin → same draft store.
        if (PREVIEW_MODE) {
          try { var pd = readDraft(); if (pd) applyEdits(pd); } catch (e) {}
          reveal();
          // Inside an overlay iframe the body's opacity transition can stall at 0,
          // leaving a black screen. Force it visible immediately (no flash to worry
          // about in a preview anyway).
          try { document.documentElement.classList.remove("jv-pending"); document.body.style.transition = "none"; document.body.style.opacity = "1"; } catch (e) {}
          return;
        }
        if (!EDIT_ENABLED) { reveal(); wireConversionTracking(); return; }
        try {
          buildUI();
          buildHoverTools();
          initImageDnD();
          buildOutline();
          pristineContentHTML = captureContent();   // baseline for undo (pristine + published)
          var draft = readDraft();
          if (draft) applyEdits(draft);
          setEdit(true);
          if (ME_CANVAS) setupMobileCanvasBridge();   // expose the API for the big-screen toolbar
          reveal();   // ← edits + draft now applied → no flash of old content
          if (draft) flash("Unpublished draft restored", true);
          else if (seededFromControl) flash("Variant B started as a copy of Control — edit it, then Publish", true);
        } catch (e) {
          reveal();   // failsafe: never leave the page hidden if the editor UI throws
          try { console.error("[jv-editor] init error:", e); } catch (e2) {}
        }
      });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
