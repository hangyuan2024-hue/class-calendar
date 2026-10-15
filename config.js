// 部署配置：换服务器/换学校时只需要改这个文件，index.html 不用动。
// 匿名密钥只能「读取」班级事项（数据库已设置只读权限），可以公开。
window.APP_CONFIG = {
  SUPABASE_URL: "https://br-brave-deer-5873ae6f.supabase2.aidap-global.cn-beijing.volces.com",
  // 海外中转线路（Cloudflare Worker 地址，例 "https://laolao-relay.xxx.workers.dev"）。
  // 海外的同学连不上上面的国内服务器时，网页会自动换到这条线路；留空就只用国内线路。部署方法见「5.7.0 海外线路」说明。
  SUPABASE_URL_ALT: "https://laolao-relay.hangyuan2024.workers.dev",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNzEwOTUyNjksInJvbGUiOiJhbm9uIn0.WaD9_FSQy0vUU7Vi6H-PtzC-kTU8wNvE5R9yVJU5Mhk",
};
