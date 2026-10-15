把首页「作品展映」要播放的视频和封面图放在这个文件夹里。
· 视频：mp4（H.264 编码），横屏 16:9，建议每个不超过 15MB
· 封面：jpg / png，和视频同样比例
然后打开网站根目录的 site-config.js，在 showcase 里加一行，例如：
  { type: "video", src: "media/team-intro.mp4", poster: "media/team-intro.jpg", title: "团队介绍", desc: "我们是谁，为什么做捞捞", tag: "视频" },
