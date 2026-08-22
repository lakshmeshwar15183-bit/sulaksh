/* Sulaksh Ad Gate — shows an ad interstitial when a user clicks View / Download,
 * then opens the file from the user's "Continue" tap (fresh gesture => no popup block).
 *
 * SETUP after AdSense approval:
 *   1. Put your AdSense <script> tag in the <head> of your pages.
 *   2. Fill ADSENSE.client ('ca-pub-XXXXXXXXXXXXXXXX') and ADSENSE.slot below.
 * Until configured, a neutral placeholder box is shown instead of a live ad.
 */
(function () {
  'use strict';

  var ADSENSE = { client: '', slot: '' };
  var GATE_EVERY = 3; // 1 = every View/Download click; set to e.g. 3 to gate only every 3rd click

  var clicks = 0;
  var els = null;
  var pending = null;

  var CSS = ''
    + '#sgOverlay{position:fixed;inset:0;background:rgba(10,20,40,.62);display:none;'
    + 'align-items:center;justify-content:center;z-index:9999;padding:18px;}'
    + '#sgOverlay.open{display:flex;}'
    + '.sg-box{background:#fff;color:#1A2433;width:min(430px,94vw);border-radius:16px;'
    + 'box-shadow:0 24px 70px rgba(0,0,0,.35);padding:22px 22px 18px;position:relative;'
    + 'font-family:Inter,-apple-system,sans-serif;text-align:center;animation:sgPop .18s ease;}'
    + '@keyframes sgPop{from{transform:scale(.94);opacity:0}to{transform:scale(1);opacity:1}}'
    + '.sg-close{position:absolute;top:10px;right:12px;font-size:20px;line-height:1;'
    + 'color:#5B6B80;background:none;border:none;cursor:pointer;padding:6px;}'
    + '.sg-title{font-family:Sora,Inter,sans-serif;font-size:19px;font-weight:800;margin-bottom:6px;}'
    + '.sg-sub{font-size:13.5px;color:#5B6B80;line-height:1.55;margin-bottom:14px;}'
    + '.sg-ad{min-height:250px;border-radius:12px;background:#F6F8FC;border:1px dashed #C9D4E4;'
    + 'display:flex;align-items:center;justify-content:center;margin-bottom:14px;overflow:hidden;}'
    + '.sg-ad-ph{font-size:12px;letter-spacing:1.5px;font-weight:700;color:#9AAAC2;text-transform:uppercase;}'
    + '.sg-btn{width:100%;background:#0C2340;color:#fff;border:none;border-radius:11px;'
    + 'padding:13px 16px;font-size:15px;font-weight:700;cursor:pointer;transition:background .2s;}'
    + '.sg-btn:hover{background:#1E5FFF;}'
    + '.sg-note{font-size:11.5px;color:#8FA0B8;margin-top:9px;}';

  function build() {
    if (els) return els;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var ov = document.createElement('div');
    ov.id = 'sgOverlay';
    ov.innerHTML = ''
      + '<div class="sg-box" role="dialog" aria-modal="true">'
      + '  <button class="sg-close" aria-label="Close">✕</button>'
      + '  <div class="sg-title">Almost there! 🙂</div>'
      + '  <div class="sg-sub">एक छोटा सा विज्ञापन — फिर आपकी फ़ाइल खुल जाएगी।<br>A quick ad keeps Sulaksh free for everyone.</div>'
      + '  <div class="sg-ad" id="sgAd"><span class="sg-ad-ph">Advertisement</span></div>'
      + '  <button class="sg-btn">▶ Open File | फ़ाइल खोलें</button>'
      + '  <div class="sg-note">🙏 Thanks for supporting free study material</div>'
      + '</div>';
    document.body.appendChild(ov);

    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.sg-close').addEventListener('click', close);
    ov.querySelector('.sg-btn').addEventListener('click', proceed);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    els = { ov: ov, ad: ov.querySelector('#sgAd') };
    return els;
  }

  function renderAd(container) {
    container.innerHTML = '';
    if (!ADSENSE.client || !ADSENSE.slot) {
      container.innerHTML = '<span class="sg-ad-ph">Advertisement</span>';
      return;
    }
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      var ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', ADSENSE.client);
      ins.setAttribute('data-ad-slot', ADSENSE.slot);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      container.appendChild(ins);
      window.adsbygoogle.push({});
    } catch (e) {
      container.innerHTML = '<span class="sg-ad-ph">Advertisement</span>';
    }
  }

  function open(cb) {
    clicks += 1;
    if (GATE_EVERY > 1 && (clicks - 1) % GATE_EVERY !== 0) { cb(); return; }
    pending = cb;
    var e = build();
    renderAd(e.ad);
    e.ov.classList.add('open');
  }

  function proceed() {
    close();
    if (pending) { var fn = pending; pending = null; fn(); }
  }

  function close() {
    pending = null;
    if (els) els.ov.classList.remove('open');
  }

  window.adGate = { open: open };
})();
