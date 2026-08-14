/**
 * materials-api.js
 * Drop this file next to your existing SULAKSH index.html and include it with:
 *   <script src="materials-api.js"></script>
 *
 * It does NOT change any existing markup or styling. It only gives you two
 * functions to wire up to whatever "View" / "Download" buttons you add to
 * your material listing UI later.
 */

// Point this at wherever the backend is deployed (e.g. https://api.sulaksh.com)
const SULAKSH_API_BASE = 'http://localhost:4000';

/**
 * Fetch a filtered list of materials (metadata only — lightweight).
 * e.g. fetchMaterials({ exam: 'UPSC', category: 'Prelims' })
 */
async function fetchMaterials(filters = {}) {
  const params = new URLSearchParams(filters);
  const res = await fetch(`${SULAKSH_API_BASE}/api/materials?${params}`);
  if (!res.ok) throw new Error('Could not load materials.');
  const data = await res.json();
  return data.materials;
}

/**
 * Open or download a material's PDF. Requests a short-lived presigned URL
 * from the backend just-in-time, then hands the browser off to R2 directly
 * — the file never passes through your app server.
 *
 * mode: 'view' opens inline in a new tab, 'download' forces a save-as.
 */
async function openMaterial(materialId, mode = 'view') {
  const disposition = mode === 'download' ? 'attachment' : 'inline';
  const res = await fetch(`${SULAKSH_API_BASE}/api/materials/${materialId}/download?disposition=${disposition}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Could not open this file. Please try again.');
    return;
  }
  const { url } = await res.json();
  // Presigned URL — valid for a few minutes only, so fetch it right before use.
  window.open(url, '_blank');
}

/*
Example usage once you add material cards to the existing homepage:

  const materials = await fetchMaterials({ exam: 'UPSC' });
  materials.forEach(m => {
    // render m.title, m.subject, m.year, m.file_size, etc. in your existing card styles
    // wire a button: <button onclick="openMaterial('${m.id}', 'view')">View</button>
  });
*/
