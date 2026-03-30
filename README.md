# 双人联机贪吃蛇

一个基于 `Node.js + ws + 原生前端` 的双人联机贪吃蛇项目。

## 功能

- 单机模式
- 双人房间联机
- 房间码加入
- 邀请链接复制
- 实时方向同步
- 房间聊天

## 本地运行

PowerShell 如果拦截了 `npm` 脚本，请使用 `npm.cmd`。

```powershell
npm.cmd install
npm.cmd start
```

浏览器打开：

```text
http://localhost:3000
```

健康检查地址：

```text
http://localhost:3000/health
```

## 部署到 Railway

### 1. 初始化并提交 Git

如果当前目录还没有远程仓库，可以先本地初始化：

```powershell
git init
git add .
git commit -m "Initial online snake game"
```

### 2. 推送到 GitHub

在 GitHub 创建一个空仓库后，执行：

```powershell
git remote add origin <你的仓库地址>
git branch -M main
git push -u origin main
```

### 3. 在 Railway 部署

1. 登录 Railway
2. 选择 `New Project`
3. 选择 `Deploy from GitHub repo`
4. 选择这个仓库
5. 等待 Railway 自动构建并启动

项目已包含：

- `package.json` 启动脚本
- `railway.json` 部署配置
- `PORT` 兼容
- `/health` 健康检查

### 4. 部署后验证

打开：

```text
https://你的域名/health
```

如果看到类似：

```json
{"ok":true,"rooms":0}
```

说明服务已正常启动。

## 联机测试方法

1. 玩家 A 打开网站，输入昵称，创建房间
2. 玩家 A 复制邀请链接发给玩家 B
3. 玩家 B 打开链接后加入房间
4. 双方点击准备
5. 房主点击开始

## 注意事项

- 当前房间数据保存在服务进程内存中
- 部署时先保持单实例，不要开启多副本扩容
- 如果服务重启，当前房间会丢失

## 后续可扩展

- 断线重连
- Redis 房间持久化
- 自动匹配
- 排行榜
- 观战模式
