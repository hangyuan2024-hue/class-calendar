// 列出要搬到国内存储（腾讯云 COS）的大文件：整合包、模型、插件。给 .github/workflows/ai-mirror.yml 用。
//   node scripts/mirror-list.js comfyui,portrait,talk,nodes,gsv,hy3d  → 标准输出一行 JSON：[{ id, group, url, key, name, size, ver }]
// 模型和插件从 core/workflows.js 里读（软件里用的就是这些，只维护一份）；整合包查各自最新的发布版。
"use strict";
const W = require("../core/workflows");

const GH_API = "https://api.github.com";
const HF = "https://huggingface.co";
const gh = async (p) => {
  const r = await fetch(GH_API + p, { headers: { accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: "Bearer " + process.env.GITHUB_TOKEN } : {}) } });
  if (!r.ok) throw new Error(`GitHub ${p} → ${r.status}`);
  return r.json();
};
const hfTree = async (repo, folder = "") => {
  const r = await fetch(`${HF}/api/models/${repo}/tree/main${folder ? "/" + folder : ""}`);
  if (!r.ok) throw new Error(`HF ${repo} → ${r.status}`);
  return (await r.json()).filter((x) => x.type === "file");
};
const sizeOf = (x) => (x.lfs && x.lfs.size) || x.size || 0;
const base = (p) => p.split("/").pop();

async function models(keys) {
  const out = [];
  for (const k of keys) {
    const m = W.MODELS[k];
    if (!m.pick) {
      // 大小要用 Hugging Face 上的真实大小（workflows.js 里的只是估计，拿来校验会报「大小不对」）
      const dir = m.path.includes("/") ? m.path.slice(0, m.path.lastIndexOf("/")) : "";
      const hit = (await hfTree(m.repo, dir).catch(() => [])).find((x) => x.path === m.path);
      out.push({ id: k, url: `${HF}/${m.repo}/resolve/main/${m.path}`, key: `ai/models/${m.dir}/${m.name}`, name: m.name, size: hit ? sizeOf(hit) : 0, model: k });
      continue;
    }
    // 有好几种量化：每个显存档位挑的第一个都搬（软件按老师的显存挑）
    const files = (await hfTree(m.repo, m.folder)).filter((x) => x.path.endsWith(m.ext));
    const seen = new Set();
    for (const tier of Object.keys(m.pick)) {
      const hit = m.pick[tier].map((w) => files.find((x) => base(x.path).includes(w))).find(Boolean);
      if (!hit || seen.has(hit.path)) continue;
      seen.add(hit.path);
      const name = base(hit.path);
      out.push({ id: k + "-" + name.replace(/[^\w.-]/g, "_"), url: `${HF}/${m.repo}/resolve/main/${hit.path}`, key: `ai/models/${m.dir}/${name}`, name, size: sizeOf(hit), model: k });
    }
  }
  return out;
}

const GROUPS = {
  // ComfyUI 官方 Windows 整合包（NVIDIA 版）
  async comfyui() {
    const rel = await gh("/repos/comfyanonymous/ComfyUI/releases/latest");
    const a = rel.assets.find((x) => /^ComfyUI_windows_portable_nvidia\.7z$/i.test(x.name)) || rel.assets.find((x) => /windows_portable.*nvidia.*\.7z$/i.test(x.name));
    if (!a) throw new Error("ComfyUI 最新版里没有 Windows 整合包");
    return [{ id: "comfyui", url: a.browser_download_url, key: `ai/pkg/comfyui-${rel.tag_name}/${a.name}`, name: a.name, size: a.size, ver: rel.tag_name, pkg: "comfyui" }];
  },
  portrait: () => models(W.NEEDS.portrait),
  talk: () => models(W.NEEDS.talk),
  // ComfyUI 插件：固定版本的 zip
  async nodes() {
    return W.NODE_PACKS.map((p) => ({ id: "node-" + p.dir, url: `https://codeload.github.com/${p.repo}/zip/${p.commit}`, key: `ai/nodes/${p.dir}-${p.commit}.zip`, name: `${p.dir}-${p.commit}.zip`, size: 0, node: p.dir, commit: p.commit }));
  },
  // GPT-SoVITS 官方 Windows 整合包（最新的一个；50 系显卡有单独的一版）
  async gsv() {
    const files = (await hfTree("lj1995/GPT-SoVITS-windows-package")).filter((x) => /\.(7z|zip)$/i.test(x.path));
    if (!files.length) throw new Error("GPT-SoVITS 整合包的仓库里没有压缩包");
    const date = (x) => (/(20\d{6})/.exec(x.path) || [0, "0"])[1];
    files.sort((a, b) => date(b).localeCompare(date(a)) || b.path.localeCompare(a.path));
    const d = date(files[0]);
    const pick = files.filter((x) => date(x) === d).slice(0, 3);
    return pick.map((x) => ({ id: "gsv-" + base(x.path).replace(/[^\w.-]/g, "_"), url: `${HF}/lj1995/GPT-SoVITS-windows-package/resolve/main/${x.path}`, key: `ai/pkg/gsv-${d}/${base(x.path)}`, name: base(x.path), size: sizeOf(x), ver: d, pkg: /nvidia50|50x0|blackwell/i.test(x.path) ? "gsv50" : "gsv" }));
  },
  // AI 助手（对话改 PPT）的本地大模型：通义千问 Qwen3-VL-4B（Apache-2.0），主模型 + 看图用的 mmproj
  async llm() {
    const L = require("../core/llm").MODEL;
    const files = await hfTree(L.repo);
    const out = [];
    for (const [k, key] of [["main", "llmMain"], ["mmproj", "llmMmproj"]]) {
      const c = files.filter((x) => L[k].test(x.path));
      const hit = L[k].prefer.map((w) => c.find((x) => x.path.includes(w))).find(Boolean) || c[0];
      if (!hit) throw new Error(L.repo + " 里没找到 " + k);
      out.push({ id: "llm-" + k, url: `${HF}/${L.repo}/resolve/main/${hit.path}`, key: `ai/llm/${base(hit.path)}`, name: base(hit.path), size: sizeOf(hit), model: key });
    }
    return out;
  },
  // 捞捞算力「答题数据工厂」的出题老师：通义千问 Qwen3-8B（GGUF Q4_K_M，Apache-2.0）
  async gridllm() {
    const repo = "Qwen/Qwen3-8B-GGUF";
    const hit = (await hfTree(repo)).find((x) => /Q4_K_M\.gguf$/i.test(x.path));
    if (!hit) throw new Error(repo + " 里没找到 Q4_K_M");
    return [{ id: "gridllm", url: `${HF}/${repo}/resolve/main/${hit.path}`, key: `ai/llm/${base(hit.path)}`, name: base(hit.path), size: sizeOf(hit), model: "gridTeacher" }];
  },
  // 捞捞算力训练答题大脑的底子：Qwen3-VL-4B-Instruct（Hugging Face 格式，Apache-2.0）：整个文件夹
  async qabase() {
    const repo = "Qwen/Qwen3-VL-4B-Instruct";
    const files = (await hfTree(repo)).filter((x) => !/(^|\/)(\.gitattributes|README\.md)$/i.test(x.path) && !x.path.includes("/"));
    if (!files.some((x) => x.path.endsWith(".safetensors"))) throw new Error(repo + " 里没有 safetensors");
    return files.map((x) => ({ id: "qabase-" + x.path.replace(/[^\w.-]/g, "_"), url: `${HF}/${repo}/resolve/main/${x.path}`, key: `ai/qabase/Qwen3-VL-4B-Instruct/${x.path}`, name: x.path, size: sizeOf(x), model: "qaBase" }));
  },
  // Hunyuan3D-2 WinPortable（可能分成好几卷：.7z.001、.7z.002……）
  async hy3d() {
    const rel = await gh("/repos/YanWenKun/Hunyuan3D-2-WinPortable/releases/latest");
    const parts = rel.assets.filter((x) => /\.(7z|zip)(\.\d{3})?$/i.test(x.name));
    if (!parts.length) throw new Error("Hunyuan3D-2 WinPortable 最新版里没有压缩包");
    return parts.map((a) => ({ id: "hy3d-" + a.name.replace(/[^\w.-]/g, "_"), url: a.browser_download_url, key: `ai/pkg/hy3d-${rel.tag_name}/${a.name}`, name: a.name, size: a.size, ver: rel.tag_name, pkg: "hy3d" }));
  },
};

async function list(groups) {
  const out = [];
  for (const g of groups) {
    if (!GROUPS[g]) throw new Error("没有这一组：" + g);
    for (const it of await GROUPS[g]()) out.push({ group: g, ...it });
  }
  return out;
}

module.exports = { list, GROUPS };
if (require.main === module) {
  const groups = String(process.argv[2] || "comfyui,portrait,talk,nodes").split(",").map((s) => s.trim()).filter(Boolean);
  list(groups).then((x) => process.stdout.write(JSON.stringify(x))).catch((e) => { console.error(e.message); process.exit(1); });
}
