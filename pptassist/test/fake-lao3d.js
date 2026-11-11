// 测试用的假「形象工坊」：按命令吐几行 @@ 消息
const a = process.argv.slice(2), cmd = a[a.indexOf("lao3d.run") + 1];
const say = (o) => process.stdout.write("@@" + JSON.stringify(o) + "\n");
console.log("一行普通日志");
if (cmd === "check") { say({ stage: "check", p: 0.5, msg: "看一看" }); say({ stage: "check", p: 1, done: true, info: { ok: true, hy: a.includes("--hy") } }); }
else if (cmd === "bad") { console.error("Traceback: 炸了"); say({ stage: "bad", error: "显存不够了" }); process.exit(1); }
else if (cmd === "silent") { console.error("什么都没说就退出了"); process.exit(3); }
else if (cmd === "slow") { say({ stage: "slow", p: 0.1, msg: "慢慢来" }); setTimeout(() => {}, 60000); }
