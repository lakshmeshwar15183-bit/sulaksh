// Minimal multipart/form-data parser for Workers. Uploads are capped at
// MAX_FILE_SIZE_MB so we buffer the whole body, find the boundaries, and
// extract one file plus any text fields.
// Returns { fields: {name: value}, file: {...} | null }.

export function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('Malformed multipart request.');
  const boundary = '--' + (m[1] || m[2]).trim();
  const delim = new TextEncoder().encode(boundary);

  // Locate every boundary occurrence in the body.
  const pos = [];
  outer:
  for (let i = 0; i <= body.length - delim.length; i++) {
    for (let j = 0; j < delim.length; j++) {
      if (body[i + j] !== delim[j]) continue outer;
    }
    pos.push(i);
  }
  // Ensure we stop before the trailing "--\r\n".
  const segments = [];
  for (let k = 0; k < pos.length - 1; k++) {
    let start = pos[k] + delim.length;
    if (body[start] === 0x0d) start++;
    if (body[start] === 0x0a) start++;
    const end = pos[k + 1];
    // Skip the terminating CRLF that precedes the next boundary.
    let realEnd = end;
    if (realEnd >= 2 && body[realEnd - 2] === 0x0d && body[realEnd - 1] === 0x0a) realEnd -= 2;
    segments.push(body.slice(start, realEnd));
  }

  const fields = {};
  let file = null;

  for (const seg of segments) {
    const headerEnd = findHeaderEnd(seg);
    if (headerEnd < 0) continue;
    const header = new TextDecoder('latin1').decode(seg.slice(0, headerEnd));
    const content = seg.slice(headerEnd + 4);

    const cd = /content-disposition:\s*form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?/i.exec(header);
    if (!cd) continue;
    const name = cd[1];
    const filename = cd[2];
    const ctype = /content-type:\s*([^\r\n]+)/i.exec(header);

    if (filename !== undefined) {
      file = {
        fieldname: name,
        originalname: filename,
        mimetype: ctype ? ctype[1].trim() : 'application/octet-stream',
        buffer: content,
        size: content.length,
      };
    } else {
      fields[name] = new TextDecoder().decode(content);
    }
  }

  return { fields, file };
}

function findHeaderEnd(seg) {
  for (let i = 0; i + 3 < seg.length; i++) {
    if (seg[i] === 0x0d && seg[i + 1] === 0x0a && seg[i + 2] === 0x0d && seg[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}