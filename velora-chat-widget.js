/**
 * Velora Dune chat widget — self-contained, no dependencies.
 *
 * Usage: add this once, near the end of <body>, on velora-dune.vercel.app:
 *
 *   <script src="/velora-chat-widget.js" data-api="https://velora-dune-rag.<subdomain>.workers.dev/api/chat"></script>
 *
 * It renders a floating chat bubble (bottom-right) and never modifies any
 * existing element on the page. All model output is rendered as escaped
 * text (never innerHTML'd raw), and the Anthropic/Cloudflare secrets never
 * touch this file — it only ever talks to the Worker's public /api/chat.
 */
(function () {
  "use strict";

  var scriptTag = document.currentScript;
  var API_URL = scriptTag.getAttribute("data-api");
  if (!API_URL) {
    console.error("[velora-chat-widget] missing data-api attribute on script tag");
    return;
  }

  var MAX_HISTORY_TURNS = 6; // kept in sync with the Worker's own cap
  var STORAGE_KEY = "velora_chat_history_v1";

  var css =
    "#vd-chat-launcher{position:fixed;right:24px;bottom:24px;width:58px;height:58px;border-radius:50%;" +
    "background:linear-gradient(145deg,#c9a463,#a9803f);border:1px solid rgba(255,255,255,.15);cursor:pointer;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.45);z-index:999998;display:flex;align-items:center;justify-content:center;" +
    "transition:transform .15s ease;}" +
    "#vd-chat-launcher:hover{transform:scale(1.06);}" +
    "#vd-chat-launcher svg{width:26px;height:26px;fill:#0b0b0b;}" +
    "#vd-chat-panel{position:fixed;right:24px;bottom:96px;width:360px;max-width:calc(100vw - 32px);" +
    "height:520px;max-height:calc(100vh - 140px);background:#0e0e0e;border:1px solid #2a2a2a;" +
    "border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);z-index:999999;display:none;" +
    "flex-direction:column;overflow:hidden;font-family:'Georgia','Cormorant Garamond',serif;}" +
    "#vd-chat-panel.vd-open{display:flex;}" +
    "#vd-chat-header{padding:16px 18px;background:#111;border-bottom:1px solid #23231f;" +
    "display:flex;align-items:center;justify-content:space-between;}" +
    "#vd-chat-header .vd-title{color:#e7dcc4;letter-spacing:.08em;text-transform:uppercase;font-size:14px;}" +
    "#vd-chat-header .vd-sub{color:#0f9d63;font-size:11px;font-family:Arial,sans-serif;margin-top:2px;}" +
    "#vd-chat-close{background:none;border:none;color:#c9a463;font-size:20px;cursor:pointer;line-height:1;}" +
    "#vd-chat-messages{flex:1;overflow-y:auto;padding:14px;background:" +
    "radial-gradient(circle at 20% 0%,rgba(15,157,99,.06),transparent 40%),#0b0b0b;}" +
    ".vd-msg{margin-bottom:12px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.5;" +
    "max-width:88%;padding:10px 12px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word;}" +
    ".vd-msg.vd-user{margin-left:auto;background:#1c1c1c;color:#f1e9d8;border:1px solid #2c2c2c;}" +
    ".vd-msg.vd-bot{margin-right:auto;background:#14201a;color:#dfeee6;border:1px solid #1f3327;}" +
    ".vd-msg.vd-error{margin-right:auto;background:#241414;color:#f0c9c9;border:1px solid #3a1f1f;}" +
    ".vd-sources{font-family:Arial,sans-serif;font-size:10.5px;color:#0f9d63;margin-top:6px;opacity:.85;}" +
    "#vd-chat-inputrow{display:flex;gap:8px;padding:12px;border-top:1px solid #23231f;background:#111;}" +
    "#vd-chat-input{flex:1;resize:none;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;" +
    "color:#f1e9d8;padding:9px 10px;font-family:Arial,sans-serif;font-size:13px;max-height:80px;}" +
    "#vd-chat-input:focus{outline:1px solid #c9a463;}" +
    "#vd-chat-send{background:#c9a463;color:#0b0b0b;border:none;border-radius:8px;padding:0 14px;" +
    "font-family:Arial,sans-serif;font-weight:bold;cursor:pointer;}" +
    "#vd-chat-send:disabled{opacity:.5;cursor:default;}" +
    ".vd-typing{display:flex;gap:4px;padding:8px 4px;}" +
    ".vd-typing span{width:6px;height:6px;border-radius:50%;background:#0f9d63;animation:vdBlink 1.2s infinite ease-in-out;}" +
    ".vd-typing span:nth-child(2){animation-delay:.2s;} .vd-typing span:nth-child(3){animation-delay:.4s;}" +
    "@keyframes vdBlink{0%,80%,100%{opacity:.25;}40%{opacity:1;}}";

  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var launcher = document.createElement("button");
  launcher.id = "vd-chat-launcher";
  launcher.setAttribute("aria-label", "Chat with Velora Dune");
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M12 3C6.48 3 2 6.94 2 11.7c0 2.62 1.4 4.96 3.6 6.53-.16 1.15-.6 2.6-1.44 3.85 1.66-.2 3.32-.9 4.6-1.86 1 .27 2.1.42 3.24.42 5.52 0 10-3.94 10-8.94S17.52 3 12 3z"/></svg>';
  document.body.appendChild(launcher);

  var panel = document.createElement("div");
  panel.id = "vd-chat-panel";
  panel.innerHTML =
    '<div id="vd-chat-header">' +
    '<div><div class="vd-title">Velora Dune</div><div class="vd-sub">Ask about the menu, hours &amp; reservations</div></div>' +
    '<button id="vd-chat-close" aria-label="Close chat">&times;</button>' +
    "</div>" +
    '<div id="vd-chat-messages"></div>' +
    '<div id="vd-chat-inputrow">' +
    '<textarea id="vd-chat-input" rows="1" maxlength="500" placeholder="Ask a question..."></textarea>' +
    '<button id="vd-chat-send">Send</button>' +
    "</div>";
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector("#vd-chat-messages");
  var inputEl = panel.querySelector("#vd-chat-input");
  var sendBtn = panel.querySelector("#vd-chat-send");
  var closeBtn = panel.querySelector("#vd-chat-close");

  var history = loadHistory();
  history.forEach(function (turn) {
    renderMessage(turn.role, turn.content, null, false);
  });
  if (history.length === 0) {
    renderMessage(
      "assistant",
      "Ahlan! I can help with our menu, hours, dining experiences, and reservations at Velora Dune. What would you like to know?",
      null,
      false
    );
  }

  launcher.addEventListener("click", function () {
    panel.classList.toggle("vd-open");
    if (panel.classList.contains("vd-open")) inputEl.focus();
  });
  closeBtn.addEventListener("click", function () {
    panel.classList.remove("vd-open");
  });

  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", send);

  function send() {
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    sendBtn.disabled = true;

    renderMessage("user", text, null, true);
    var typingEl = renderTyping();

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: history.slice(-MAX_HISTORY_TURNS * 2),
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Request failed");
          return data;
        });
      })
      .then(function (data) {
        typingEl.remove();
        renderMessage("assistant", data.answer, data.sources, true);
      })
      .catch(function () {
        typingEl.remove();
        renderMessage(
          "assistant",
          "Sorry, I'm having trouble responding right now. Please try again, or call us at +971 4 555 8899.",
          null,
          false
        );
      })
      .finally(function () {
        sendBtn.disabled = false;
      });
  }

  function renderTyping() {
    var el = document.createElement("div");
    el.className = "vd-msg vd-bot";
    el.innerHTML = '<div class="vd-typing"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function renderMessage(role, content, sources, persist) {
    var el = document.createElement("div");
    el.className = "vd-msg " + (role === "user" ? "vd-user" : "vd-bot");
    el.textContent = content; // never innerHTML — content is always plain text
    if (false) {
      var srcEl = document.createElement("div");
      srcEl.className = "vd-sources";
      srcEl.textContent =
        "Source: " + sources.map(function (s) { return s.section + " — p." + s.page; }).join(" · ");
      el.appendChild(srcEl);
    }
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (persist) {
      history.push({ role: role === "user" ? "user" : "assistant", content: content });
      saveHistory();
    }
  }

  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY_TURNS * 2)));
    } catch (e) {
      /* storage unavailable — chat still works, just without persistence */
    }
  }
})();
