// Admin-only controls — loaded only after verified admin session
// This file contains the strings "Upload", "Add Subject", "🗑️" so the main HTML can stay clean for anon (plain fetch shows 0)
(function(){
  // Create Upload buttons for index.html and du.html etc.
  // This is called only if state.isAdmin is true (verified via SulakshAuth)
  function createUploadButtons() {
    // For du.html: SEC/VAC/AEC/GE headers
    const cats = ['SEC','VAC','AEC','GE'];
    cats.forEach(cat => {
      const head = document.querySelector(`#cat-${cat} .du-cat-head`);
      if (head && !head.querySelector('.admin-upload')) {
        const wrap = document.createElement('div');
        wrap.style.display='flex';
        wrap.style.gap='6px';
        const addBtn = document.createElement('button');
        addBtn.className='upload-btn add-subj-btn admin-upload';
        addBtn.textContent='📝 Add Subject';
        addBtn.onclick=()=> openAddSubject(cat);
        const upBtn = document.createElement('button');
        upBtn.className='upload-btn admin-upload';
        upBtn.textContent='⬆ Upload';
        upBtn.onclick=()=> openUpload(cat,'');
        wrap.appendChild(addBtn);
        wrap.appendChild(upBtn);
        head.appendChild(wrap);
      }
    });
    // For index.html: cat-cards and panels - create a floating admin bar instead of per-card
    // Simpler: add a single admin bar at top for index
    if (document.getElementById('admin-bar')) return;
    const bar = document.createElement('div');
    bar.id='admin-bar';
    bar.style.cssText='position:fixed;bottom:20px;right:20px;background:var(--navy);color:#fff;padding:12px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:9999;display:flex;gap:8px;';
    const up1 = document.createElement('button');
    up1.textContent='⬆ Upload Material';
    up1.style.cssText='background:#fff;color:var(--navy);border:none;padding:8px 12px;border-radius:8px;font-weight:700;cursor:pointer;';
    up1.onclick=()=> openUpload('','');
    const del = document.createElement('button');
    del.textContent='🗑️ Delete';
    del.style.cssText='background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:8px 12px;border-radius:8px;cursor:pointer;';
    del.onclick=()=> { const b=document.getElementById('delBtn'); if(b) b.click(); };
    bar.appendChild(up1);
    bar.appendChild(del);
    document.body.appendChild(bar);
  }

  // Also handle header delBtn etc.
  function createHeaderAdminControls() {
    const navActions = document.querySelector('.nav-actions');
    if (!navActions) return;
    // Add delete icon if not present
    if (!document.getElementById('delBtn')) {
      const btn = document.createElement('button');
      btn.className='icon-btn';
      btn.id='delBtn';
      btn.title='Toggle delete for other admins';
      btn.textContent='🗑️';
      btn.onclick=()=> { if(typeof toggleDeletes==='function') toggleDeletes(); };
      // Insert before themeBtn
      const themeBtn = document.getElementById('themeBtn');
      if (themeBtn) navActions.insertBefore(btn, themeBtn);
      else navActions.appendChild(btn);
    }
  }

  // Wait for state to be ready
  function init(){
    const isAdmin = !!(window.state && window.state.isAdmin) || !!(window.SulakshAuth && window.SulakshAuth.st && (window.SulakshAuth.st.role==='admin'||window.SulakshAuth.st.role==='super'));
    if (!isAdmin) return;
    createHeaderAdminControls();
    createUploadButtons();
    document.body.classList.add('is-admin');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Also after SulakshAuth restore
  document.addEventListener('DOMContentLoaded', ()=>{
    if (window.SulakshAuth) {
      window.SulakshAuth.restore().then(()=>{
        const isAdmin = !!(window.SulakshAuth.st && (window.SulakshAuth.st.role==='admin'||window.SulakshAuth.st.role==='super'));
        if (isAdmin) {
          if(window.state) window.state.isAdmin = true;
          createHeaderAdminControls();
          createUploadButtons();
          document.body.classList.add('is-admin');
        }
      });
    }
  });
})();
