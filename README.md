# UII Agent Hub

联影智能 Agent Hub — 把影像 AI 能力变成院内智能体可以直接调用的标准化外部服务。

**在线预览**: https://ruanrrn.github.io/uii-skills-hub/

## 项目结构

```
├── index.html          # 主页
├── app.js              # 技能数据 & 渲染逻辑
├── styles.css          # 样式
├── assets/             # 静态资源（图标、Logo）
└── vitallens/          # vitallens-rppg skill 源码
```

## Skills

| 名称           | 类型  | 说明                                             |
| -------------- | ----- | ------------------------------------------------ |
| vitallens-rppg | Skill | 用摄像头无接触采集约 12 秒视频，返回心率与呼吸率 |

## 本地开发

纯静态站点，用任意 HTTP 服务器启动即可：

```bash
# 方式一：Python
python -m http.server 8080

# 方式二：Node.js
npx serve .
```

然后访问 `http://localhost:8080`。

## 部署

本项目通过 GitHub Actions 自动部署到 GitHub Pages，推送到 `main` 分支即自动更新。

## License

© 2026 UII Agent Hub
