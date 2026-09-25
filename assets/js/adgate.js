/* Sulaksh file opener (formerly "Ad Gate").
 *
 * The interstitial popup ("Almost there!" + ad box + Open File button) was
 * retired: files now open directly on click. This shim keeps the exact same
 * window.adGate.open(cb) API so all existing callers (du.html, index.html,
 * syllabus.html, notes.html, imp.html, pyq.html) keep working untouched.
 *
 * Behaviour: opens a blank tab synchronously inside the user's click gesture
 * (so popup blockers allow it) and hands it to the callback, which navigates
 * it to the file — identical to the old gated path, minus the modal.
 */
(function () {
  'use strict';

  function open(cb) {
    var win = null;
    try { win = window.open('', '_blank'); } catch (e) { win = null; }
    try {
      cb(win);
    } catch (e) {
      try { if (win && !win.closed) win.close(); } catch (_) {}
    }
  }

  window.adGate = { open: open };
})();
