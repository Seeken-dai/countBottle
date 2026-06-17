# CountBottle 运维与管理手册 (DevOps Manual)

本手册专为你（系统的超级管理员及拥有者）编写，用于了解 CountBottle V1.2.0 系统在云端是如何运行的，以及遇到需要管理域名、服务器状态、数据库时该去哪里操作。

---

## 1. 域名与服务器管理 (Hosting & Cloud Run)

由于我们采用了最先进的 **Serverless (无服务器)** 架构，所以你不需要像传统运维那样去管理 Linux 服务器的 CPU、内存和磁盘。Google 会根据访问人数自动为你扩缩容。

### 怎么查看和修改我的域名？
所有的域名托管管理都在 **Firebase Console (控制台)** 中完成。
1. 浏览器访问并登录 [Firebase Console](https://console.firebase.google.com/)。
2. 点击进入 `countbottle-web` 项目。
3. 在左侧边栏（Build / 构建 下拉菜单里），点击 **Hosting (托管)**。
4. 进入 Hosting 面板后，你会看到：
   - **Domains (域名)**：这里明确列出了系统分配给你的那两个默认免费域名（`countbottle-web.web.app` 等）。
   - **自定义域名 (Add custom domain)**：如果你未来在阿里云或腾讯云买了自己的专属域名（比如 `www.countbottle.com`），点击这个按钮，按照提示做一下 DNS 解析映射，就能直接绑定使用你的新域名！

### 为什么在 Google Cloud Run 里找不到我的服务？
虽然底层跑在 Cloud Run 上，但有时候刚接触 Cloud Run 会找不到服务位置，通常是因为以下 3 个原因：
1. **项目选错了**：Google Cloud 控制台左上角的项目下拉菜单经常会默认选中其他老项目，请务必确保手动选中了 `countbottle-web` 项目。
2. **区域 (Region) 被过滤了**：我们在配置文件中把你的服务器设定在了 `asia-east1` (台湾机房，亚洲访问最快)。请确保 Cloud Run 列表顶部的区域筛选器没有把你过滤掉。
3. **前缀命名**：Firebase Web Frameworks 自动为你创建的服务名通常是以 `ssr-` 或者是 `firebase-frameworks-` 开头的（比如 `ssr-countbottle-web`），可以直接在搜索框搜索 `ssr` 寻找。
- **看日志**：点进这个服务后，切换到 "Logs (日志)" 标签，就可以看到真实的用户访问请求和系统报错日志了。

---

## 2. 数据库与用户管理 (Database & Auth)

你系统里产生的所有数据（用户注册信息、群组数据、账单记录）都存在 Google Firestore 云数据库里。

### 如何查看和修改具体数据？
1. 在 Firebase Console 的左侧菜单，点击 **Firestore Database**。
2. 在 **Data (数据)** 面板中，你可以像看文件夹一样，点开 `Users`、`Groups`、`Members` 和 `Records` 集合。
3. 这里可以可视化地随意增加、删除或修改任意一条数据（比如帮某个加错群的用户强制删除记录）。

### 如何管理系统注册的账号？
1. 在 Firebase Console 左侧菜单，点击 **Authentication (身份验证)**。
2. 在 **Users (用户)** 列表中，你可以：
   - 看到所有用邮箱/Google注册的账号列表。
   - **禁用账号 (Disable)**：如果有人恶意捣乱，你可以点右侧三个点，一键封禁他的账号。
   - **重置密码 (Reset Password)**：给用户发送重置密码的邮件。

---

## 3. 自动化部署流水线 (CI/CD)

现在系统的发布已经完全实现了自动化，不需要任何繁杂的服务器 SSH 登录与重启操作。

### 部署流程原理
1. 你在本地电脑修改了代码。
2. 双击运行我为你写的 `deploy.bat`，它会把代码打包发送给 **GitHub**。
3. **GitHub Actions** 收到代码后，会自动开启一台云端构建机，帮你跑 `npm run build`。
4. 构建成功后，它会自动通过专线把压缩包推给 **Firebase Hosting**，一秒钟完成无缝切换发布。

### 发布失败了去哪里看原因？
如果某次你双击 `deploy.bat` 后，发现网站没更新：
1. 登录 [GitHub](https://github.com/Seeken-dai/countBottle)。
2. 点击顶部的 **Actions** 标签。
3. 找到那个前面带 ❌ 的红色的任务记录，点进去就能看到具体是哪一行代码导致了云端打包失败。

---

> [!TIP]
> **日常运维建议**
> 1. **不要轻易泄露 Firebase Console 的登录权限**，因为这是你整个系统的“总电闸”。
> 2. 对于游戏群、旅游团账目的日常纠纷，尽量使用我们之前编写的**系统前端网页自带的【👑 超管后台】**来处理，只有当涉及到系统级崩溃或账号注销时，再进入 Firebase 后台操作。
> 3. 目前 Firebase 的免费额度（Spark 计划）对于几百人日常使用的流量来说完全绰绰有余，如果将来某一天爆火，你只需要在后台绑一张信用卡升级为按量付费即可（依然很便宜）。
