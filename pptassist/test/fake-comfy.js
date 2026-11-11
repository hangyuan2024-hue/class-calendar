// 假的 ComfyUI（测试用）：/system_stats、/object_info、/upload/image、/prompt、/history、/view、/ws（发几条进度）、
// 还有假的 Hugging Face（/api/models/.../tree、/.../resolve/...，支持断点续传）和假的 GitHub zip。
"use strict";
const http = require("http");
const crypto = require("crypto");
const W = require("../core/workflows");

function frame(obj) {
  const b = Buffer.from(JSON.stringify(obj));
  const head = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]);
  return Buffer.concat([head, b]);
}

function start(opt = {}) {
  const st = { uploads: {}, prompts: [], history: {}, interrupted: 0, deleted: [], rangeAsked: [], failNext: opt.failNext || 0, fail: opt.fail || null, files: opt.files || {}, ws: [] };
  const known = new Set([...W.CORE_NODES, "UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly", "TextEncodeQwenImageEditPlus", "KSampler", "VAEDecode", "VAEEncode", "SaveImage", "LoadImage", "FluxKontextImageScale", "LoadAudio", "ImageScale", "CLIPVisionLoader",
    ...(opt.noPacks ? [] : ["WanVideoBlockSwap", "WanVideoLoraSelect", "MultiTalkModelLoader", "WanVideoModelLoader", "WanVideoVAELoader", "WanVideoTextEncodeCached", "Wav2VecModelLoader", "MultiTalkWav2VecEmbeds", "WanVideoClipVisionEncode", "WanVideoImageToVideoMultiTalk", "WanVideoSampler", "WanVideoPassImagesFromSamples", "VHS_VideoCombine"])]);
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const body = await new Promise((ok) => { const a = []; req.on("data", (d) => a.push(d)); req.on("end", () => ok(Buffer.concat(a))); });
    const json = (o, c = 200) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/system_stats") return json({ system: { comfyui_version: "0.45.0" }, devices: [{ name: "cuda:0 NVIDIA GeForce RTX 4060 Ti : cudaMallocAsync", type: "cuda", vram_total: 16 * 1073741824 }] });
    if (u.pathname === "/object_info") return json(Object.fromEntries([...known].map((k) => [k, {}])));
    if (u.pathname === "/upload/image") {
      const m = /filename="([^"]+)"/.exec(body.toString("latin1"));
      st.uploads[m[1]] = body.length;
      return json({ name: m[1], subfolder: "", type: "input" });
    }
    if (u.pathname === "/prompt" && req.method === "POST") {
      const p = JSON.parse(body.toString());
      const bad = Object.values(p.prompt).filter((n) => !known.has(n.class_type));
      if (bad.length) return json({ error: { type: "prompt_outputs_failed_validation" }, node_errors: { x: bad[0].class_type } }, 400);
      const id = crypto.randomUUID();
      st.prompts.push({ id, prompt: p.prompt, client: p.client_id });
      for (const s of st.ws) { s.write(frame({ type: "executing", data: { node: Object.keys(p.prompt)[0], prompt_id: id } })); s.write(frame({ type: "progress", data: { value: 2, max: 4, node: Object.keys(p.prompt)[0], prompt_id: id } })); }
      const delay = opt.delay || 50;
      setTimeout(() => {
        if (st.fail) { st.history[id] = { status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "KSampler", exception_message: st.fail }]] }, outputs: {} }; return; }
        const outs = {};
        for (const [k, n] of Object.entries(p.prompt)) {
          if (n.class_type === "SaveImage") outs[k] = { images: [0, 1].map((i) => ({ filename: `${n.inputs.filename_prefix.split("/").pop()}_${i}.png`, subfolder: "laolao", type: "output" })) };
          if (n.class_type === "VHS_VideoCombine") outs[k] = { gifs: [{ filename: "talk_00001.mp4", subfolder: "laolao", type: "output", format: "video/h264-mp4" }] };
        }
        st.history[id] = { status: { status_str: "success", completed: true, messages: [] }, outputs: outs };
      }, delay);
      return json({ prompt_id: id, number: 1, node_errors: {} });
    }
    if (u.pathname.startsWith("/history/")) { const id = u.pathname.slice(9); return json(st.history[id] ? { [id]: st.history[id] } : {}); }
    if (u.pathname === "/view") { const fn = u.searchParams.get("filename"); res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end((opt.view && opt.view(fn)) || Buffer.from("FILE:" + fn)); }
    if (u.pathname === "/interrupt") { st.interrupted++; return json({}); }
    if (u.pathname === "/queue") { st.deleted.push(...(JSON.parse(body.toString() || "{}").delete || [])); return json({}); }
    // 假的 Hugging Face
    const tree = /^\/api\/models\/(.+?)\/tree\/main(?:\/(.*))?$/.exec(u.pathname);
    if (tree) { const list = (opt.trees || {})[tree[1] + (tree[2] ? "/" + tree[2] : "")]; return list ? json(list) : json({ error: "nope" }, 404); }
    const rs = /\/resolve\/main\/(.+)$/.exec(u.pathname) || /\/archive\/(.+)\.zip$/.exec(u.pathname);
    if (rs) {
      if (st.failNext > 0) { st.failNext--; res.writeHead(500); return res.end(); }
      const data = st.files[rs[1]] || Buffer.alloc(opt.size || 5000, 7);
      const range = /bytes=(\d+)-/.exec(req.headers.range || "");
      if (range) { st.rangeAsked.push(+range[1]); const from = +range[1]; res.writeHead(206, { "content-length": data.length - from, "content-range": `bytes ${from}-${data.length - 1}/${data.length}` }); return res.end(data.subarray(from)); }
      // 第一次下一半就断掉（测续传）
      if (opt.cutFirst && !st.cut) { st.cut = true; res.writeHead(200, { "content-length": data.length }); res.write(data.subarray(0, data.length >> 1)); return setTimeout(() => res.destroy(), 30); }
      res.writeHead(200, { "content-length": data.length }); return res.end(data);
    }
    res.writeHead(404); res.end();
  });
  srv.on("upgrade", (req, sock) => {
    const key = req.headers["sec-websocket-key"];
    const acc = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
    sock.write(frame({ type: "status", data: { status: { exec_info: { queue_remaining: 0 } } } }));
    st.ws.push(sock);
    sock.on("error", () => {}); sock.on("close", () => { st.ws = st.ws.filter((s) => s !== sock); });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${srv.address().port}`, st, close: () => { for (const s of st.ws) s.destroy(); srv.close(); } })));
}

module.exports = { start };
