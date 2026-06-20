(function () {
  function devicePid() {
    let pid = localStorage.getItem('moorcraft-pid');
    if (!pid) {
      pid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem('moorcraft-pid', pid);
    }
    return pid;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let overlay;

  function close() {
    if (overlay) overlay.classList.add('hidden');
  }

  function openModal() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'feedback-overlay';
      overlay.className = 'feedback-overlay hidden';
      overlay.innerHTML =
        '<div class="feedback-panel" role="dialog" aria-labelledby="feedback-title">' +
        '<div class="inv-title" id="feedback-title">Feedback &amp; bugs</div>' +
        '<p class="muted-note">Tell me what went wrong or what tha&rsquo;d like improved. I&rsquo;ll get the page URL and browser details with it.</p>' +
        '<div class="feedback-kind">' +
        '<label><input type="radio" name="fb-kind" value="bug" checked> Bug</label>' +
        '<label><input type="radio" name="fb-kind" value="feedback"> Feedback</label>' +
        '</div>' +
        '<input class="seed" id="fb-email" type="email" maxlength="120" placeholder="Email (optional, if tha wants a reply)">' +
        '<textarea class="seed feedback-msg" id="fb-message" maxlength="2000" rows="6" placeholder="What happened? Steps to reproduce help for bugs."></textarea>' +
        '<div class="login-err" id="fb-err"></div>' +
        '<div class="request-ok hidden" id="fb-ok"></div>' +
        '<button type="button" class="mc" id="fb-send">Send to t&rsquo; parish ledger</button>' +
        '<button type="button" class="mc" id="fb-cancel">Cancel</button>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      overlay.querySelector('#fb-cancel').addEventListener('click', close);
      overlay.querySelector('#fb-send').addEventListener('click', send);
    }
    overlay.querySelector('#fb-err').textContent = '';
    overlay.querySelector('#fb-ok').classList.add('hidden');
    overlay.querySelector('#fb-message').value = '';
    overlay.classList.remove('hidden');
    overlay.querySelector('#fb-message').focus();
  }

  async function send() {
    const errEl = overlay.querySelector('#fb-err');
    const okEl = overlay.querySelector('#fb-ok');
    const message = overlay.querySelector('#fb-message').value.trim();
    const email = overlay.querySelector('#fb-email').value.trim().toLowerCase();
    const kind = overlay.querySelector('input[name="fb-kind"]:checked')?.value || 'feedback';
    if (message.length < 8) {
      errEl.textContent = 'A bit more detail, love — at least a sentence.';
      return;
    }
    errEl.textContent = 'Sending...';
    okEl.classList.add('hidden');
    try {
      const res = await fetch('/dash/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pid: devicePid(),
          kind,
          message,
          email,
          name: '',
          context: { page: 'about', url: location.href, ua: navigator.userAgent.slice(0, 240) },
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        errEl.textContent = d.err || 'That didn\u2019t work.';
        return;
      }
      errEl.textContent = '';
      okEl.classList.remove('hidden');
      okEl.textContent = d.msg || 'Thanks — noted on t\u2019 parish ledger.';
      overlay.querySelector('#fb-message').value = '';
    } catch {
      errEl.textContent = 'Can\u2019t reach t\u2019 parish ledger — try again later.';
    }
  }

  for (const btn of document.querySelectorAll('[data-feedback-open]')) {
    btn.addEventListener('click', e => { e.preventDefault(); openModal(); });
  }
})();
