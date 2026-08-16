/* Sulaksh upload optimizer — client-side file optimization before upload.
 * Images (JPG/PNG/WebP): resize + iterative compression, target ~150 KB.
 * PDFs: safe pdf-lib round-trip (readability & structure preserved), keep
 * original if it cannot be safely reduced. Runs entirely in the browser;
 * the optimized blob is what gets uploaded to the existing backend.
 */
(function () {
  'use strict';

  var KB = 1024;
  var MB = KB * 1024;
  var TARGET = 150 * KB;
  var MAX_DIM = 2048;
  var MIN_Q = 0.55;
  var MIN_SCALE = 0.5;

  function sizeLabel(bytes) {
    if (bytes >= MB) return (bytes / MB).toFixed(2) + ' MB';
    return Math.round(bytes / KB) + ' KB';
  }

  function isImage(type) {
    return /^image\/(jpe?g|png|webp)$/i.test(type || '');
  }
  function isPdf(type) {
    return (type || '').toLowerCase() === 'application/pdf';
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read the image.')); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, q) {
    return new Promise(function (resolve) {
      try { canvas.toBlob(resolve, mime, q); }
      catch (e) { resolve(null); }
    });
  }

  // Encode the image at a given scale + quality. Returns a Blob or null.
  function encodeImage(img, w, h, mime, q) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return canvasToBlob(c, mime, q);
  }

  // Core loop: quality sweep at native scale, then scale-down sweep. Returns
  // the best readable result (targeted ≤ TARGET).
  async function optimizeImageCore(img, fileType) {
    var w0 = img.naturalWidth, h0 = img.naturalHeight;
    var scale = Math.min(1, MAX_DIM / Math.max(w0, h0));
    // WebP is preferred for PNG (keeps alpha) and usually smaller for
    // text-heavy captures; JPEG is a reliable fallback everywhere.
    var encoders = /png/i.test(fileType) ? ['image/webp', 'image/jpeg'] : ['image/jpeg', 'image/webp'];
    var best = null;

    function tryEncode(s, q) {
      var w = Math.max(1, Math.round(w0 * s));
      var h = Math.max(1, Math.round(h0 * s));
      return Promise.all(encoders.map(function (mime) {
        return encodeImage(img, w, h, mime, q).then(function (blob) {
          if (blob && (!best || blob.size < best.blob.size)) {
            best = { blob: blob, mime: mime, q: q, s: s };
          }
        });
      }));
    }

    // Phase A: reduce quality first (keeps full resolution readable).
    for (var q = 0.92; q >= MIN_Q; q -= 0.07) {
      await tryEncode(scale, q);
      if (best && best.blob.size <= TARGET) break;
    }

    // Phase B: only shrink dimensions if still over the target.
    if (!best || best.blob.size > TARGET) {
      for (var s = Math.max(MIN_SCALE, scale * 0.85); s >= scale * MIN_SCALE; s -= 0.1) {
        await tryEncode(Math.max(MIN_SCALE, s), 0.82);
        await tryEncode(Math.max(MIN_SCALE, s), 0.66);
        if (best && best.blob.size <= TARGET) break;
      }
    }

    if (!best) return { ok: false, error: 'Could not optimize this image.' };
    var note = best.blob.size <= TARGET
      ? 'Optimized to ≤ 150 KB.'
      : 'Optimized for readability; 150 KB target not possible without significant quality loss.';
    return { ok: true, blob: best.blob, changed: true, size: best.blob.size, mime: best.mime, note: note };
  }

  function optimizeImage(file) {
    if (file.size <= TARGET) {
      return Promise.resolve({
        ok: true, blob: file, changed: false, size: file.size,
        note: 'Already ≤ 150 KB — uploaded unchanged.',
      });
    }
    return loadImage(file).then(function (img) {
      return optimizeImageCore(img, file.type);
    });
  }

  var _pdfLibPromise = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!_pdfLibPromise) {
      _pdfLibPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'assets/js/vendor/pdf-lib.min.js';
        s.onload = function () {
          if (window.PDFLib) resolve(window.PDFLib);
          else reject(new Error('PDF library failed to load.'));
        };
        s.onerror = function () { reject(new Error('PDF library could not be loaded.')); };
        document.head.appendChild(s);
      });
    }
    return _pdfLibPromise;
  }

  function optimizePdf(file) {
    if (file.size <= TARGET) {
      return Promise.resolve({
        ok: true, blob: file, changed: false, size: file.size,
        note: 'Already ≤ 150 KB — uploaded unchanged.',
      });
    }
    return loadPdfLib()
      .then(function (PDFLib) {
        return file.arrayBuffer().then(function (buf) {
          return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
        }).then(function (doc) {
          return doc.save({ useObjectStreams: true });
        }).then(function (bytes) {
          if (bytes.byteLength < file.size) {
            var blob = new Blob([bytes], { type: 'application/pdf' });
            var note = blob.size <= TARGET
              ? 'Optimized to ≤ 150 KB.'
              : 'Optimized for readability; 150 KB target not possible without significant quality loss.';
            return { ok: true, blob: blob, changed: true, size: blob.size, note: note };
          }
          return {
            ok: true, blob: file, changed: false, size: file.size,
            note: 'Kept original — safe optimization could not reduce the size without risking readability.',
          };
        });
      })
      .catch(function () {
        return {
          ok: true, blob: file, changed: false, size: file.size,
          note: 'Could not optimize PDF safely — uploaded original unchanged.',
        };
      });
  }

  function optimizeFile(file) {
    var type = (file.type || '').toLowerCase();
    if (isImage(type)) return optimizeImage(file);
    if (isPdf(type)) return optimizePdf(file);
    return Promise.resolve({
      ok: true, blob: file, changed: false, size: file.size,
      note: 'Format not optimized — uploaded unchanged.',
    });
  }

  function prepare(file) {
    return optimizeFile(file).then(function (res) {
      res.file = file;
      res.original = file.size;
      return res;
    });
  }

  // ---- UI binding: live "Original → Optimizing → Optimized" panel ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render(status, res) {
    if (!res || !res.file) { status.innerHTML = ''; return; }
    var name = escapeHtml(res.file.name);
    var orig = sizeLabel(res.file.size);
    if (res.optimizing) {
      status.innerHTML =
        '<div class="up-opt">' +
        '<div class="up-opt-line">File selected: <b>' + name + '</b></div>' +
        '<div class="up-opt-line">Original: <b>' + orig + '</b></div>' +
        '<div class="up-opt-line up-opt-running">Optimizing…</div>' +
        '</div>';
      return;
    }
    var savedPct = res.original && res.size != null ? Math.round((1 - res.size / res.original) * 100) : 0;
    var saved = savedPct > 0 ? '<span class="up-opt-saved">Saved: ' + savedPct + '%</span>' : '';
    var note = res.note ? '<div class="up-opt-note">' + escapeHtml(res.note) + '</div>' : '';
    var line = res.ok
      ? '<div class="up-opt-line">Optimized: <b>' + sizeLabel(res.size) + '</b> ' + saved + '</div>'
      : '<div class="up-opt-line up-opt-err">Optimization failed: ' + escapeHtml(res.error || '') + '</div>';
    status.innerHTML =
      '<div class="up-opt">' +
      '<div class="up-opt-line">File selected: <b>' + name + '</b></div>' +
      '<div class="up-opt-line">Original: <b>' + orig + '</b></div>' +
      line +
      note +
      '</div>';
  }

  function bind(fileId, statusId) {
    var input = document.getElementById(fileId);
    var status = document.getElementById(statusId);
    if (!input || !status) return;
    var cache = new WeakMap();

    input.addEventListener('change', function () {
      var file = input.files[0];
      cache.delete(input);
      if (!file) { render(status, null); return; }
      render(status, { file: file, optimizing: true });
      SulakshOptimizer.prepare(file).then(function (res) {
        cache.set(input, res);
        render(status, res);
      });
    });

    // Hook used by the page's doUpload() to grab the optimized blob (awaiting
    // it if the admin clicked Upload before optimization finished).
    input.__getOptimized = function () {
      var file = input.files[0];
      if (!file) return Promise.resolve(null);
      var cached = cache.get(input);
      if (cached && cached.file === file) return Promise.resolve(cached);
      return SulakshOptimizer.prepare(file).then(function (res) {
        cache.set(input, res);
        render(status, res);
        return res;
      });
    };
  }

  // Inject the status-panel styles (uses the page's CSS variables).
  var css = '' +
    '.up-opt{margin:10px 0 4px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg);font-size:12.5px;line-height:1.7;}' +
    '.up-opt-line{color:var(--muted);}' +
    '.up-opt-running{color:var(--blue);font-weight:600;}' +
    '.up-opt-ok{color:var(--green);}' +
    '.up-opt-err{color:#d64545;}' +
    '.up-opt-note{font-weight:600;margin-top:2px;}' +
    '.up-opt-saved{color:var(--green);font-weight:700;}';
  var style = document.createElement('style');
  style.textContent = css;
  if (document.head) document.head.appendChild(style);

  window.SulakshOptimizer = {
    optimizeFile: optimizeFile,
    prepare: prepare,
    bind: bind,
    sizeLabel: sizeLabel,
    // Exposed for debugging/testing the core loop.
    optimizeImageCore: optimizeImageCore,
    encodeImage: encodeImage,
  };
})();