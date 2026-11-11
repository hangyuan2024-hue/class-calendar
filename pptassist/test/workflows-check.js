// 拿真的 ComfyUI 核对工作流：节点在不在、参数名和取值对不对（ComfyUI 收到 /prompt 会先整张图校验一遍）。
// 不需要显卡、不需要真的模型：在 ComfyUI/models 下放同名的空文件就能过校验，校验过了就马上取消，不真的跑。
//   node test/workflows-check.js http://127.0.0.1:8188
// 换 ComfyUI 或插件的版本以后跑一下。
"use strict";
const W = require("../core/workflows");

const base = (process.argv[2] || "http://127.0.0.1:8188").replace(/\/+$/, "");
const file = (k) => W.MODELS[k].name;

async function upload(name, buf, type) {
  const fd = new FormData();
  fd.append("image", new Blob([buf], { type }), name);
  fd.append("overwrite", "true");
  const r = await fetch(base + "/upload/image", { method: "POST", body: fd });
  if (!r.ok) throw new Error("上传失败 " + r.status);
  return (await r.json()).name;
}
function wav(sec) {
  const n = 16000 * sec, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
// 1×1 的 png
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201" + "e5274ade0000000049454e44ae426082", "hex");

(async () => {
  const info = await (await fetch(base + "/object_info")).json();
  const photo = await upload("check.png", PNG, "image/png");
  const audio = await upload("check.wav", wav(2), "audio/wav");
  const graphs = {
    "portrait（快）": W.portrait({ photo, style: "toy", batch: 4, fast: true }, file),
    "portrait（慢、更细）": W.portrait({ photo, style: "anime", fast: false }, file),
    "variant mouthOpen": W.variant({ image: photo, kind: "mouthOpen" }, file),
    "talk 12G": W.talk({ image: photo, audio, seconds: 2, act: "wave", vramGB: 12 }, file),
    "talk 24G": W.talk({ image: photo, audio, seconds: 2, act: "point", vramGB: 24 }, file),
  };
  let bad = 0;
  for (const [name, g] of Object.entries(graphs)) {
    const miss = W.classesOf(g).filter((c) => !info[c]);
    if (miss.length) { bad++; console.log("✗", name, "没有这些节点：", miss.join("、")); continue; }
    const r = await fetch(base + "/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: g, client_id: "check" }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.prompt_id) {
      console.log("✓", name);
      await fetch(base + "/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [j.prompt_id] }) });
      await fetch(base + "/interrupt", { method: "POST" });
    } else { bad++; console.log("✗", name, JSON.stringify(j.node_errors || j.error || j).slice(0, 1500)); }
  }
  for (const c of W.CORE_NODES) if (!info[c]) { bad++; console.log("✗ ComfyUI 本体没有", c); }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
