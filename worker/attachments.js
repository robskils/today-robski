// File attachments for blocks (notes, task cards, table rows).
//
// Bytes live in R2 (env.ATTACHMENTS); the per-block list of {id,name,type,size}
// lives in the block's props.attachments. Everything sits behind the same auth
// gate as the rest of /api, so the browser fetches bytes with its Bearer token
// and turns them into blob: URLs - the token never goes in a URL.

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

const keyFor = (blockId, attId) => `att/${blockId}/${attId}`;

// Scoped to the signed-in user: attachments hang off a block, so a user may only
// touch attachments on a block they own. A non-owned (or missing) id reads null,
// and the handler bails before it ever reaches R2.
async function loadProps(env, id) {
  const row = await env.DB.prepare('SELECT props FROM blocks WHERE id = ? AND user_id = ?').bind(id, env.uid).first();
  if (!row) return null;
  try { return row.props ? JSON.parse(row.props) : {}; } catch { return {}; }
}

async function saveProps(env, id, props) {
  await env.DB.prepare('UPDATE blocks SET props = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(props), new Date().toISOString(), id, env.uid).run();
}

export async function handleAttachments(request, env, url, json, err) {
  if (!env.ATTACHMENTS) return err('attachments storage is not enabled', request, 501);
  const path = url.pathname;

  // Upload: POST /api/blocks/:id/attachments  (raw bytes; name & type in query)
  const up = path.match(/^\/api\/blocks\/([\w-]+)\/attachments$/);
  if (up && request.method === 'POST') {
    const blockId = up[1];
    const props = await loadProps(env, blockId);
    if (props === null) return err('block not found', request, 404);
    const name = (url.searchParams.get('name') || 'file').slice(0, 200);
    const type = url.searchParams.get('type') || request.headers.get('content-type') || 'application/octet-stream';
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return err('empty file', request);
    if (buf.byteLength > MAX_BYTES) return err('file too large (max 25 MB)', request, 413);
    const attId = crypto.randomUUID();
    await env.ATTACHMENTS.put(keyFor(blockId, attId), buf, {
      httpMetadata: { contentType: type },
      customMetadata: { name },
    });
    const att = { id: attId, name, type, size: buf.byteLength, uploaded_at: new Date().toISOString() };
    // With ?col=, the attachment belongs to a table cell (props.values[col] list);
    // otherwise it's a block-level attachment (props.attachments).
    const col = url.searchParams.get('col');
    if (col) {
      props.values = props.values && typeof props.values === 'object' ? props.values : {};
      const arr = Array.isArray(props.values[col]) ? props.values[col] : [];
      props.values[col] = [...arr, att];
    } else {
      props.attachments = [...(Array.isArray(props.attachments) ? props.attachments : []), att];
    }
    await saveProps(env, blockId, props);
    return json(att, request, 201);
  }

  // Fetch / delete: /api/attachments/:blockId/:attId
  const one = path.match(/^\/api\/attachments\/([\w-]+)\/([\w-]+)$/);
  if (one && request.method === 'GET') {
    const obj = await env.ATTACHMENTS.get(keyFor(one[1], one[2]));
    if (!obj) return err('not found', request, 404);
    const h = new Headers();
    obj.writeHttpMetadata(h);
    h.set('Cache-Control', 'private, max-age=3600');
    const ct = obj.httpMetadata?.contentType || 'application/octet-stream';
    const name = (obj.customMetadata?.name || 'file').replace(/["\\\r\n]/g, '');
    const disp = (/^image\//.test(ct) || ct === 'application/pdf') ? 'inline' : 'attachment';
    h.set('Content-Disposition', `${disp}; filename="${name}"`);
    return new Response(obj.body, { headers: h });
  }
  if (one && request.method === 'DELETE') {
    const [, blockId, attId] = one;
    await env.ATTACHMENTS.delete(keyFor(blockId, attId));
    const props = await loadProps(env, blockId);
    if (props) {
      const col = url.searchParams.get('col');
      if (col && props.values && Array.isArray(props.values[col])) {
        props.values[col] = props.values[col].filter((a) => a.id !== attId);
      } else {
        props.attachments = (props.attachments || []).filter((a) => a.id !== attId);
      }
      await saveProps(env, blockId, props);
    }
    return json({ ok: true }, request);
  }

  return err('bad attachment route', request, 404);
}
