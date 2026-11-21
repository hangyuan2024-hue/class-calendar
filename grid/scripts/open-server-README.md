# 捞捞算力 通用版 · 调度中心搭建说明

捞捞算力能把几台电脑连成一台「训练机」：每台电脑空闲时领任务，一台关机了，下一台从最近的存档接着算。
通用版让你用**自己的服务器**搭一个训练网，和捞捞团队的训练网完全分开。

一个训练网由三部分组成：

| 部分 | 放在哪 | 做什么 |
|---|---|---|
| 调度中心 | 你的云服务器（这个压缩包） | 派活、记账、存进度、控制中心网页 |
| 管理员命令行 | 你自己的电脑（`tools/grid.js`） | 生成签名密钥、发邀请链接、签名配方、建任务 |
| 捞捞算力 通用版 | 每台出力的电脑（Windows 安装包） | 粘贴邀请链接加入，空闲时领任务、跑配方 |

## 1. 准备一台服务器

- Linux 云服务器，2 核 2G 就够（Ubuntu 22.04 以上、Debian 12、CentOS Stream 9 都可以）
- 在云服务商的控制台 → 防火墙，放行端口 **8787**
- 有域名的话推荐用 HTTPS：先把域名解析到这台服务器，放行 **80 和 443**

## 2. 装调度中心（在服务器上）

把压缩包传到服务器上（网页控制台的「上传文件」或 `scp` 都行），然后：

```bash
sudo mkdir -p /opt/laolao-grid-open
sudo unzip LaolaoGrid-Open-Server.zip -d /opt/laolao-grid-open
sudo bash /opt/laolao-grid-open/laolao-grid/server/deploy.sh
```

有域名时用这一行代替最后一行（自动申请 HTTPS 证书）：

```bash
sudo DOMAIN=grid.你的域名.cn bash /opt/laolao-grid-open/laolao-grid/server/deploy.sh
```

装完会打印：

- **调度中心地址**（`http://服务器IP:8787` 或 `https://你的域名`）
- **控制中心**：地址后面加 `/admin/`
- **管理员口令**：只留给自己，不要发给任何人、不要截图

脚本会自动装 Node.js 22，并把调度中心设成开机自启（服务名 `laolao-grid`）。
数据放在 `/var/lib/laolao-grid`（一个 SQLite 文件 + 大家上传的存档）。

## 3. 管理员的电脑：生成签名密钥、发邀请

在你自己的电脑上装 [Node.js 22](https://nodejs.org/zh-cn) 以上，把压缩包解压，进到 `laolao-grid` 文件夹：

```bash
node tools/grid.js login https://grid.你的域名.cn 管理员口令
```

这一步会在你电脑上生成**配方签名的私钥**（存在你用户目录的 `.laolao-grid` 里，不会上传），只把公钥告诉调度中心。
以后每个要在别人电脑上运行的配方，都必须用这把私钥签名；签名不对，客户端就不运行。
**就算调度中心被人攻破，也没法让大家的电脑运行别的代码。**

发邀请链接（每个人一条）：

```bash
node tools/grid.js invite 张三
```

控制中心网页里也能发邀请、看每台电脑实时跑到哪一行。

## 4. 出力的电脑：装客户端、加入

每台电脑装「捞捞算力 通用版」（官网下载），打开后粘贴邀请链接、勾选同意，按「任务向导」一步一步来：
体检 → 一键装训练环境（Python 3.11 + PyTorch）→ 跑通测试 → 设置什么时候算。

默认「自己点开始才算」；主人一用电脑就让出显卡；显卡太热会自动放慢；随时可以暂停、退出。

## 5. 试运行

```bash
node tools/grid.js job plans/demo.json
```

会建 4 个示例任务：测每台电脑的显卡、生成 + 人工审核、接力训练（关掉一台看下一台接着算）、多台一起训练（DiLoCo）。

## 6. 写你自己的配方

配方就是一个 Python 文件，用 `lg` 和调度中心打交道（参考 `recipes/demo_relay.py`）：

```python
# requires: numpy                    ← 要的包（客户端自动装）
import lg
t = lg.task()                        # 输入、任务参数、上次存档
for step in range(total):
    lg.metric(step, loss=loss)       # 曲线（客户端、控制中心实时画）
    lg.progress(step / total)
    if step % 100 == 0:
        save("ckpt.pt"); lg.checkpoint("ckpt.pt", step)   # 存档：换电脑后从这里接着算
lg.done(ckpt="final.pt", loss=loss)  # 结果里的文件自动上传
```

然后写一个计划 JSON（参考 `plans/demo.json`），`node tools/grid.js job 你的计划.json` 就会自动签名、上传、建任务。
分法有三种：`map`（拆成很多小任务，谁空谁领）、`relay`（接力，一次一台）、`diloco`（多台一起训练，每轮合并）。

## 7. 更新调度中心

下载新版压缩包，解压覆盖原来的文件夹，然后：

```bash
sudo systemctl restart laolao-grid
```

任务、租约、存档都在 SQLite 里，重启后原样接着算；各台电脑连不上的那几秒会自动重试。

## 安全建议

- 管理员口令、配方私钥只在你自己手里；服务器上的密钥只在服务器上输入，不要发到聊天里
- 有域名尽量用 HTTPS（第 2 步的 `DOMAIN=`）
- 训练文件默认存在服务器硬盘上。要放对象存储（腾讯云 COS 等），在服务器上编辑 `/etc/laolao-grid.env`（只有 root 能看），填 `GRID_COS_*`，再 `sudo systemctl restart laolao-grid`
- 只邀请你认识的人；不用的邀请可以在控制中心撤回
