(function () {
  "use strict";

  var scriptTag = document.currentScript;
  var API_URL = scriptTag.getAttribute("data-api");
  if (!API_URL) {
    console.error("[velora-chat-widget] missing data-api attribute on script tag");
    return;
  }
  var RESERVE_URL = API_URL.replace(/\/api\/chat$/, "/api/reserve");

  var MAX_HISTORY_TURNS = 6;
  var STORAGE_KEY = "velora_chat_history_v2";
  var NUDGE_DELAY_MS = 9000;

  var css =
    "#vd-chat-launcher{position:fixed;right:24px;bottom:24px;width:60px;height:60px;border-radius:50%;" +
    "background:linear-gradient(145deg,#d9b876,#a9803f);border:1px solid rgba(255,255,255,.18);cursor:pointer;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 0 0 rgba(217,184,118,.55);z-index:999998;display:flex;" +
    "align-items:center;justify-content:center;transition:transform .18s ease;animation:vdPulseRing 2.6s ease-out infinite;}" +
    "#vd-chat-launcher:hover{transform:scale(1.08);}" +
    "#vd-chat-launcher svg{width:27px;height:27px;fill:#0b0b0b;}" +
    "@keyframes vdPulseRing{0%{box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 0 0 rgba(217,184,118,.45);}" +
    "70%{box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 0 14px rgba(217,184,118,0);}" +
    "100%{box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 0 0 rgba(217,184,118,0);}}" +
    "#vd-chat-nudge{position:fixed;right:92px;bottom:38px;background:#151511;color:#f1e9d8;padding:10px 14px;" +
    "border-radius:10px;border:1px solid #2c2c26;font-family:Arial,sans-serif;font-size:12.5px;max-width:190px;" +
    "z-index:999997;box-shadow:0 6px 20px rgba(0,0,0,.4);opacity:0;transform:translateY(6px);" +
    "transition:opacity .35s ease,transform .35s ease;pointer-events:none;}" +
    "#vd-chat-nudge.vd-show{opacity:1;transform:translateY(0);pointer-events:auto;cursor:pointer;}" +
    "#vd-chat-nudge:after{content:'';position:absolute;right:-6px;bottom:16px;width:10px;height:10px;" +
    "background:#151511;border-right:1px solid #2c2c26;border-bottom:1px solid #2c2c26;transform:rotate(-45deg);}" +
    "#vd-chat-panel{position:fixed;right:24px;bottom:96px;width:370px;max-width:calc(100vw - 32px);" +
    "height:540px;max-height:calc(100vh - 140px);background:#0e0e0e;border:1px solid #2a2a2a;" +
    "border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.65);z-index:999999;display:none;" +
    "flex-direction:column;overflow:hidden;font-family:Georgia,'Cormorant Garamond',serif;" +
    "opacity:0;transform:translateY(14px) scale(.97);transition:opacity .22s ease,transform .22s ease;}" +
    "#vd-chat-panel.vd-open{display:flex;}" +
    "#vd-chat-panel.vd-visible{opacity:1;transform:translateY(0) scale(1);}" +
    "#vd-chat-header{padding:16px 18px;background:linear-gradient(180deg,#141410,#101008);" +
    "border-bottom:1px solid #23231f;display:flex;align-items:center;justify-content:space-between;}" +
    "#vd-chat-header .vd-title{color:#e7dcc4;letter-spacing:.08em;text-transform:uppercase;font-size:14.5px;}" +
    "#vd-chat-header .vd-sub{color:#3fbf85;font-size:11px;font-family:Arial,sans-serif;margin-top:3px;}" +
    "#vd-chat-close{background:none;border:none;color:#c9a463;font-size:21px;cursor:pointer;line-height:1;}" +
    "#vd-chat-actions{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid #1e1e1a;background:#101008;}" +
    "#vd-chat-actions button{flex:1;background:#1a1a14;color:#d9b876;border:1px solid #2c2c22;border-radius:8px;" +
    "padding:8px 6px;font-family:Arial,sans-serif;font-size:11.5px;cursor:pointer;transition:background .15s;}" +
    "#vd-chat-actions button:hover{background:#22221a;}" +
    "#vd-chat-messages{flex:1;overflow-y:auto;padding:14px;background:" +
    "radial-gradient(circle at 20% 0%,rgba(63,191,133,.07),transparent 42%),#0b0b0b;}" +
    ".vd-msg{margin-bottom:12px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.5;" +
    "max-width:88%;padding:10px 12px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word;" +
    "opacity:0;transform:translateY(6px);animation:vdFadeIn .28s ease forwards;}" +
    "@keyframes vdFadeIn{to{opacity:1;transform:translateY(0);}}" +
    ".vd-msg.vd-user{margin-left:auto;background:#1c1c1c;color:#f1e9d8;border:1px solid #2c2c2c;}" +
    ".vd-msg.vd-bot{margin-right:auto;background:#14201a;color:#dfeee6;border:1px solid #1f3327;}" +
    ".vd-msg.vd-error{margin-right:auto;background:#241414;color:#f0c9c9;border:1px solid #3a1f1f;}" +
    "#vd-chat-inputrow{display:flex;gap:8px;padding:12px;border-top:1px solid #23231f;background:#111;}" +
    "#vd-chat-input{flex:1;resize:none;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;" +
    "color:#f1e9d8;padding:9px 10px;font-family:Arial,sans-serif;font-size:13px;max-height:80px;}" +
    "#vd-chat-input:focus{outline:1px solid #c9a463;}" +
    "#vd-chat-send{background:linear-gradient(145deg,#d9b876,#a9803f);color:#0b0b0b;border:none;border-radius:8px;" +
    "padding:0 14px;font-family:Arial,sans-serif;font-weight:bold;cursor:pointer;}" +
    "#vd-chat-send:disabled{opacity:.5;cursor:default;}" +
    ".vd-typing{display:flex;gap:4px;padding:8px 4px;}" +
    ".vd-typing span{width:6px;height:6px;border-radius:50%;background:#3fbf85;animation:vdBlink 1.2s infinite ease-in-out;}" +
    ".vd-typing span:nth-child(2){animation-delay:.2s;} .vd-typing span:nth-child(3){animation-delay:.4s;}" +
    "@keyframes vdBlink{0%,80%,100%{opacity:.25;}40%{opacity:1;}}" +
    ".vd-form{font-family:Arial,sans-serif;font-size:12.5px;color:#dfeee6;background:#14201a;" +
    "border:1px solid #1f3327;border-radius:10px;padding:12px;margin-bottom:12px;opacity:0;transform:translateY(6px);" +
    "animation:vdFadeIn .28s ease forwards;}" +
    ".vd-form h4{margin:0 0 8px;color:#f1e9d8;font-size:13px;letter-spacing:.03em;}" +
    ".vd-form label{display:block;margin:8px 0 3px;color:#a9c9b8;font-size:11px;}" +
    ".vd-form input,.vd-form select,.vd-form textarea{width:100%;box-sizing:border-box;background:#0e0e0e;" +
    "border:1px solid #2c2c22;border-radius:6px;color:#f1e9d8;padding:7px 8px;font-family:Arial,sans-serif;" +
    "font-size:12.5px;}" +
    ".vd-form textarea{resize:vertical;min-height:44px;}" +
    ".vd-form-row{display:flex;gap:8px;}" +
    ".vd-form-row>div{flex:1;}" +
    ".vd-form-submit{margin-top:12px;width:100%;background:linear-gradient(145deg,#d9b876,#a9803f);" +
    "color:#0b0b0b;border:none;border-radius:7px;padding:9px;font-weight:bold;cursor:pointer;font-size:12.5px;}" +
    ".vd-form-submit:disabled{opacity:.5;cursor:default;}" +
    ".vd-form-error{color:#f0a3a3;font-size:11px;margin-top:6px;}";

  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var launcher = document.createElement("button");
  launcher.id = "vd-chat-launcher";
  launcher.setAttribute("aria-label", "Chat with Velora Dune");
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M12 3C6.48 3 2 6.94 2 11.7c0 2.62 1.4 4.96 3.6 6.53-.16 1.15-.6 2.6-1.44 3.85 1.66-.2 3.32-.9 4.6-1.86 1 .27 2.1.42 3.24.42 5.52 0 10-3.94 10-8.94S17.52 3 12 3z"/></svg>';
  document.body.appendChild(launcher);

  var nudge = document.createElement("div");
  nudge.id = "vd-chat-nudge";
  nudge.textContent = "Have a question about the menu or a reservation? Chat with us.";
  document.body.appendChild(nudge);

  var panel = document.createElement("div");
  panel.id = "vd-chat-panel";
  panel.innerHTML =
    '<div id="vd-chat-header">' +
    '<div><div class="vd-title">Velora Dune</div><div class="vd-sub">Menu &amp; reservations, answered instantly</div></div>' +
    '<button id="vd-chat-close" aria-label="Close chat">&times;</button>' +
    "</div>" +
    '<div id="vd-chat-actions">' +
    '<button id="vd-quick-reserve" type="button">Reserve a table</button>' +
    '<button id="vd-quick-menu" type="button">Ask about the menu</button>' +
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
  var quickReserveBtn = panel.querySelector("#vd-quick-reserve");
  var quickMenuBtn = panel.querySelector("#vd-quick-menu");

  var history = loadHistory();
  history.forEach(function (turn) {
    renderMessage(turn.role, turn.content, false);
  });
  if (history.length === 0) {
    renderMessage(
      "assistant",
      "Ahlan! I can help with our menu, hours, dining experiences, and reservations at Velora Dune. What would you like to know?",
      false
    );
  }

  var hasOpened = false;
  var nudgeTimer = setTimeout(function () {
    if (!hasOpened) nudge.classList.add("vd-show");
  }, NUDGE_DELAY_MS);

  function openPanel() {
    hasOpened = true;
    clearTimeout(nudgeTimer);
    nudge.classList.remove("vd-show");
    panel.classList.add("vd-open");
    requestAnimationFrame(function () {
      panel.classList.add("vd-visible");
    });
    inputEl.focus();
  }

  function closePanel() {
    panel.classList.remove("vd-visible");
    setTimeout(function () {
      panel.classList.remove("vd-open");
    }, 200);
  }

  launcher.addEventListener("click", function () {
    if (panel.classList.contains("vd-open")) {
      closePanel();
    } else {
      openPanel();
    }
  });
  nudge.addEventListener("click", openPanel);
  closeBtn.addEventListener("click", closePanel);

  quickMenuBtn.addEventListener("click", function () {
    inputEl.value = "What's on the menu?";
    send();
  });
  quickReserveBtn.addEventListener("click", function () {
    renderReservationForm();
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

    renderMessage("user", text, true);
    var typingEl = renderTyping();

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: history.slice(-MAX_HISTORY_TURNS * 2) }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Request failed");
          return data;
        });
      })
      .then(function (data) {
        typingEl.remove();
        renderMessage("assistant", data.answer, true);
      })
      .catch(function () {
        typingEl.remove();
        renderMessage(
          "assistant",
          "Sorry, I'm having trouble responding right now. Please try again, or call us at +971 4 555 8899.",
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

  function renderMessage(role, content, persist) {
    var el = document.createElement("div");
    el.className = "vd-msg " + (role === "user" ? "vd-user" : "vd-bot");
    el.textContent = content;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (persist) {
      history.push({ role: role === "user" ? "user" : "assistant", content: content });
      saveHistory();
    }
  }

  function renderReservationForm() {
    var wrap = document.createElement("div");
    wrap.className = "vd-form";
    wrap.innerHTML =
      "<h4>Reserve a table</h4>" +
      '<label>Name</label><input type="text" data-f="name" maxlength="100" />' +
      '<div class="vd-form-row">' +
      '<div><label>Email</label><input type="email" data-f="email" maxlength="120" /></div>' +
      '<div><label>Phone</label><input type="tel" data-f="phone" maxlength="30" /></div>' +
      "</div>" +
      '<div class="vd-form-row">' +
      '<div><label>Guests</label><select data-f="guests">' +
      [1, 2, 3, 4, 5, "6+"].map(function (n) { return '<option value="' + n + '">' + n + "</option>"; }).join("") +
      "</select></div>" +
      '<div><label>Date</label><input type="date" data-f="date" /></div>' +
      '<div><label>Time</label><input type="time" data-f="time" /></div>' +
      "</div>" +
      "<label>Special request (optional)</label>" +
      '<textarea data-f="specialRequest" maxlength="500" placeholder="Occasion, dietary needs, seating preference..."></textarea>' +
      '<button class="vd-form-submit" type="button">Submit request</button>' +
      '<div class="vd-form-error" style="display:none;"></div>';

    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    var submitBtn = wrap.querySelector(".vd-form-submit");
    var errEl = wrap.querySelector(".vd-form-error");

    submitBtn.addEventListener("click", function () {
      var payload = {};
      wrap.querySelectorAll("[data-f]").forEach(function (el) {
        payload[el.getAttribute("data-f")] = el.value;
      });

      errEl.style.display = "none";
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";

      fetch(RESERVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || "Could not submit reservation.");
            return data;
          });
        })
        .then(function (data) {
          wrap.remove();
          renderMessage("assistant", data.answer, true);
        })
        .catch(function (err) {
          errEl.textContent = err.message || "Something went wrong — please try again.";
          errEl.style.display = "block";
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit request";
        });
    });
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
