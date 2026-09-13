# 一分 · 表达练习室

## 👉 [点击打开手机版表达练习室](https://lixinyan1025-commits.github.io/yifen-expression-studio/)

[![打开网站](https://img.shields.io/badge/%E7%82%B9%E5%87%BB%E6%89%93%E5%BC%80-%E4%B8%80%E5%88%86%E8%A1%A8%E8%BE%BE%E7%BB%83%E4%B9%A0%E5%AE%A4-e53935?style=for-the-badge)](https://lixinyan1025-commits.github.io/yifen-expression-studio/)

手机网络受限时优先使用 GitHub Pages 入口。输入访问密码后，网站会自动解密并载入“01-智慧”的 60 篇笔记；同时支持学习、常见话题、计时、录音、边讲边转写、结束后自动生成基础复盘、回听、Markdown 导入和当前浏览器历史记录。Pages 版不再连接不存在的项目后端；实时转写使用浏览器 Web Speech API，最新版 Chrome / Edge 支持较好，但浏览器厂商的语音服务仍可能需要网络。完整 AI 语义分析需要另行配置安全后端。

GitHub Pages 版本通过仓库的 `main` 分支和 `.github/workflows/deploy-pages.yml` 自动发布。“01-智慧”的 60 篇笔记使用 PBKDF2-SHA256（250,000 次）派生密钥和 AES-256-GCM 加密，输入访问密码后只在当前浏览器解密并写入 IndexedDB；仓库和构建产物只有密文，不含明文密码、笔记或录音。

知识库有更新时，在本机临时设置 `YIFEN_BUNDLE_PASSWORD` 后运行 `npm.cmd run bundle:knowledge`，再提交新生成的 `pages-public/knowledge.enc.json`。脚本只读取 `.env` 中配置的 `OBSIDIAN_WISDOM_PATH`，不会修改 Obsidian 原文件，也不要把访问密码写入 `.env` 或提交记录。

面向 Obsidian 用户的中文表达训练网站：**十分钟学习 → 现实场景题 → 一分钟演讲 → 证据复盘 → 同题再练**。

## 手机在线版实时转写（2026-09-13 更新）

- 开始录音后同步启动中文实时转写，界面持续显示原始已确认文本和临时识别文本，并即时统计字数、填充词和连续重复线索。
- 停止录音后自动保存 WAV、原始转写和基础复盘，无需再点击分析。基础复盘只依据 WAV 低音量区间和转写中的明确文本，标记填充词、连续重复及待核对停顿；不会用预设分数冒充逻辑、切题或观点分析。
- 浏览器实时识别没有可靠词级时间戳，文字定位采用识别结果返回时刻的近似值；停顿定位来自真实 WAV。报告中的每项都可点击回听核对。
- 浏览器不支持或语音服务断网时，录音、倒计时、保存和回听仍可使用，并明确提示本次未生成转写及复盘。建议手机使用最新版 Chrome；iOS / Safari 的支持情况取决于系统版本。

## 密码保护的在线版与手机优先流程（2026-09-11 更新）

完整后端版允许公网打开，但必须输入站点访问密码。服务端只保存 PBKDF2 密码哈希，验证成功后签发 12 小时有效的 HttpOnly、Secure、SameSite=Strict 签名 Cookie；付费 API 全部在服务端再次校验会话。GitHub 仓库按其他网页项目的格式公开展示，但不包含密码、私人笔记、录音或本机 `.env`。当前尚未配置真实转写 / AI 密钥。

训练无需先导入笔记。话题从 12 个常见生活、社交、学习与工作场景中随机抽取，避免紧接着重复上一题；不读取笔记标题、标签或正文进行匹配。默认先阅读三条话题相关的简短背景信息，学习结束后再揭晓具体问题。可提前结束学习；准备模式仍可先看题目。资料为明确标注的编辑情境信息，提供背景而非标准答案、整篇笔记或讲稿。AI 出题仅接收随机主题和问题种子，同时生成简短背景信息，不接收个人笔记。

知识库作为个人储备保留，允许自选最多 3 篇笔记，只在授权后的复盘中作为关联启发；不要求回答使用笔记。手机界面提供底部导航、大字号背景卡片与主要操作按钮。录音与历史依然保存在当前浏览器，跨设备不自动共享。

在线版不能读取电脑的 `D:` 盘，也不会自动上传本机智慧笔记、录音或 `.env`；请在手机或电脑上批量导入所需 `.md`。以下 Obsidian 直连说明仅适用于本地版。

部署构建：`npm.cmd run build:site`，输出到被 Git 忽略的 `.site-build/dist`。入口是 `server/index.js`（标准 Fetch Worker），静态资源在 `client`，部署元数据在 `.openai/hosting.json`。必须先推送精确的源码提交，再从该提交构建、保存版本并部署；`SITE_PASSWORD_HASH` 与 `SITE_SESSION_SECRET` 仅配置为 Sites 加密环境变量。

## 已连接本机 Obsidian 智慧目录

当前本机 `.env` 已设置 `OBSIDIAN_WISDOM_PATH`，连接 Obsidian 当前打开的知识库：

`D:\obsidianbiji\obsidianbiji\obsidianbiji\obsidianbiji\01-智慧`

本次核对共 **60 篇 Markdown**，包括“入世”“出世”与入口页。打开网站时自动只读同步，页面「同步更新」可重新读取修改；每篇笔记显示相对来源路径。同步不向 AI 上传内容，不写入或删除 Obsidian 文件。

服务器只读取 `.env` 指定目录，忽略隐藏目录、非 Markdown 文件和目录联接 / 符号链接，不接受浏览器传入任意路径。原文件新增、修改或删除后，同步会更新网站中直连笔记的缓存；手动导入的其他笔记保留。缓存删除不影响原文，下一次同步会重新读取仍存在的直连笔记。系统选择训练材料时优先避开入口 / 索引页。

读取失败时保留已有缓存，显示错误。浏览器仍按本机 origin 保存笔记与训练记录；原文件与网站缓存不是双向编辑同步。

## 在本机启动

日常使用：双击项目中的 **`打开表达练习室.cmd`**，自动启动本地服务并打开浏览器。也可运行 `npm.cmd run open`。重复打开会复用已运行的网站，不会重复启动；服务日志保存在 Git 忽略的 `.local/website.log` 与 `.local/website-error.log`。

电脑重启后需要再次双击启动文件；本项目没有设置开机自启。启动器优先运行已有生产构建，修改代码后请先重新构建，再重启本项目的网站服务；开发时使用下面的 `dev` 命令。

需要 Node.js 22.12+（本机使用 Node 24）。在本项目目录运行：

```powershell
npm.cmd install
npm.cmd run dev
```

打开 **http://localhost:4317**。请保持这个地址和端口固定；`127.0.0.1` 与 `localhost` 的浏览器存储也相互独立。

生产构建仍供本机运行：

```powershell
npm.cmd run build
npm.cmd start
```

网页不依赖外部字体、图片或 CDN。手机尺寸已适配；在真实手机上录音需要 HTTPS 和单独配置的服务部署，当前服务器有意只监听本机。当前版本没有账号与公网鉴权，不应直接暴露到互联网。

## 真实语音和分析服务

未配置时，可以导入、阅读、计时、使用内置场景题、录音、回听和保存历史。**没有随机分析、演示分数或预设复盘。**

1. 本机已有 `.env` 时直接编辑，保留 `OBSIDIAN_WISDOM_PATH`。新环境才需要复制 `.env.example` 为 `.env`。
2. 在本机文件中填写 `AI_API_KEY` 和 `STT_API_KEY`，不必把密钥发到聊天中。STT 密钥留空时使用 AI 密钥。
3. 可分别配置 AI / STT 的 Base URL 与模型。
4. 重启本项目的 Node 网站服务，在「服务与隐私」刷新状态。无需关闭或重启 Codex。
5. 勾选用途说明，授权本次内容上传，开始训练。已有录音可在复盘中重试转写与分析。

接口约定：

- 出题：`POST /chat/completions`，文本输入与 JSON 文本输出。默认 `gpt-4o-mini`。
- 转写：`POST /audio/transcriptions`，multipart WAV，`language=zh`、`response_format=verbose_json`、`timestamp_granularities[]=segment`。默认 `whisper-1`；兼容服务必须提供真实分段时间戳。
- 分析：`POST /chat/completions`，同时输入未润色转写、声学事实和 `input_audio: {data, format:"wav"}`，`modalities:["text"]`。默认 `gpt-audio`，可改为服务支持的音频输入模型；普通纯文本模型不能替代。音频模型不强制 structured outputs，返回 JSON 由 Zod 与证据校验器检查。
- `AI_BASE_URL`、`STT_BASE_URL` 只由后端 `.env` 读取。远程服务须用 HTTPS；本地兼容服务可用 HTTP loopback 地址。
- HTTP 401 / 403 / 429 / 5xx、断网、超时、JSON 或时间戳不兼容均显示错误，保留已完成步骤。转写成功、分析失败后只重试分析。

接口参考已核实：[OpenAI 转写文档](https://developers.openai.com/api/docs/guides/speech-to-text)、[音频输入文档](https://developers.openai.com/api/docs/guides/audio)、[GPT-Audio 模型文档](https://developers.openai.com/api/docs/models/gpt-audio)。实际可用模型以配置服务和账号权限为准。

## 页面与使用

- **今日练习**：默认先阅读三条话题相关的简短背景信息，再揭晓问题。准备模式先展示问题再学习；两种模式都先学习再演讲，不要求导入笔记。
- **我的知识库**：批量导入 `.md`，保留完整原文件、YAML 标题和标签、正文和行内标签；支持查看、搜索、选择、删除、完全重复文件跳过。每篇 1 MB、每批 300 篇。导入解析失败时整批不写入，避免部分导入不明确。双链仅显示文字，附件仅显示名称；不主动请求笔记中的远程图片。
- **演讲**：收起所有学习资料和报告，点击开始后才请求麦克风。录音启动事件同步计时，60 秒停止，也可提前结束。页面隐藏或麦克风中断会提前停止并标记中断；浏览器强制关闭前未成功保存的录音无法保证恢复。
- **复盘**：录音、时间戳转写、问题、优点、四个表达维度、2–3 个优先练习、保留原意的口头示例、复盘笔记关联。所有 AI 问题默认疑似，支持确认、忽略与恢复。同题再练沿用题目与阈值，可比较两次已确认 / 疑似事件和原文。
- **练习记录**：按日期查看与删除录音、转写和报告。删除笔记不改原始文件，也不追溯删除旧报告引用。
- **服务与隐私**：显示服务配置状态（配置存在不等于已验证服务可用）、用途说明、停顿阈值 0.5–5 秒、本机存储范围与持久存储申请。

学习时可以暂停、继续计时或退出本次学习。知识库支持按「入世 / 出世 / 手动导入」筛选、隐藏入口页，以及在已选列表中取消或清空材料。训练模式、出题偏好、停顿阈值和所选笔记会在同一浏览器中保留；上传授权每次打开仍默认关闭。已打开页面发现本地服务断开时，会显示启动说明与重新检测入口。

内置题为编辑整理的常见现实场景，独立于知识库随机抽取。AI 题从同类生活主题生成，并标为 AI 场景题；出题不传笔记，失败可以重试或选择内置题。

## 证据链与分析边界

1. 浏览器 MediaRecorder 保存原始 WebM/MP4；Web Audio 解码后按同一时间轴转换为 24 kHz 单声道、16-bit PCM WAV。不剪除停顿，不变速，不润色文本。
2. WAV 同时用于播放器、转写和音频 AI。服务器对 WAV 做 SHA-256；分析请求的转写必须携带同一哈希，避免拿另一段录音分析。
3. 服务端重新解析 WAV 并以 20 ms 帧计算 RMS。低音量门限为 `max(0.004,min(0.02,peak*0.035))`，区间达到用户时长阈值后成为停顿候选。它是能量检测，不是语音识别或思路中断检测；背景噪声、轻声说话、开头结尾留白都可能影响结果。
4. ASR 分段原样保留；空内容、无有效段、明显无语音概率、乱序 / 越界时间戳会被拒绝。ASR 仍可能遗漏语气词或产生幻觉，因此原音频始终保留供核验。
5. 音频模型实际接收 WAV，结合原话判断卡壳、填充词、无效重复、逻辑、思路中断和停顿语境。无语义的纯停顿不得单独计为思路中断。
6. 每条语义问题必须引用真实分段中的连续原话。纯停顿必须引用实际停顿 ID。无法核验的条目被过滤，过滤数量可见。整体维度评价引文错误时拒绝整份报告；引文存在不等于观点判断一定正确。
7. 定位按 ASR 分段，播放前留 0.25 秒、后留 0.4 秒。不会把段级时间伪装为词级时间。同一段内重复相同引文会保守合并；粗分段可能低估多次事件，显示的是可核验事件数，并非临床级或逐字精确的口语计量。
8. 先逐项确认疑似事件，再看同题变化。比较次数不自动生成“进步百分比”或分数；时长、阈值差异会提示。

## 数据与隐私

- IndexedDB：`yifen-expression`，对象仓库 `notes` / `sessions`。保存在当前浏览器用户配置目录内，而非项目文件夹或 Obsidian 原文件。
- localStorage：`yifen-preferences` 保存训练偏好和所选笔记 ID，不保存密钥或上传授权。
- 保存范围仅当前 origin，跨浏览器、设备、端口不共享。清除网站数据、隐私窗口关闭或空间回收可能删除数据。可申请浏览器持久保存，重要录音可下载 WAV。
- 上传默认关闭。AI 出题只发送常见主题与问题种子；转写发送本次 WAV；分析发送同一 WAV、题目、原始转写、声学事实及所选最多 3 篇复盘笔记（每篇前 8,000 字符、标题和标签）。知识库中的笔记原文展示完整，训练学习页仅显示背景信息。
- 本机服务器仅只读访问已配置的智慧目录，不把接收到的笔记和音频另行落盘，也不记录请求内容日志。连接路径与用户手动填写的密钥保存在本机 `.env`，由 Git 忽略；`.local/` 同样被忽略。第三方服务的数据留存由其政策决定，本机删除不能撤回已上传内容。
- 后端只接受本机 Host、同源 Origin 和带自定义头的 JSON POST，避免其他网页跨站调用个人服务。没有公网多用户权限系统。

## 开源复用

按照 GitHub 优先开发进行检索，关键词：`github react-markdown remarkjs license markdown react`、`github jakearchibald idb IndexedDB license`。检查了 README、许可证与对应入口代码：

- [remarkjs/react-markdown](https://github.com/remarkjs/react-markdown)，作者 Espen Hovlandsdal，MIT；复用安全 Markdown 渲染组件（`lib/index.js`）。不启用原始 HTML。
- [jakearchibald/idb](https://github.com/jakearchibald/idb)，作者 Jake Archibald，ISC；复用 IndexedDB Promise / transaction 接口（`src/entry.ts`）。
- [FileShot/FileShotZKE](https://github.com/FileShot/FileShotZKE)，FileShot 维护，MIT；参考其“浏览器原生 Web Crypto、PBKDF2 派生密钥、AES-256-GCM 客户端解密”的零知识文件思路。本项目按自身知识库数据结构独立实现，没有引入其代码或依赖。
- [JamesBrill/react-speech-recognition](https://github.com/JamesBrill/react-speech-recognition)，作者 James Brill，MIT；核实其对 Web Speech API 的连续识别、临时结果与 Chrome 支持说明。本项目沿用现有 React 架构，自行封装浏览器原生接口，没有增加该依赖。
- [ggerganov/whisper.cpp](https://github.com/ggml-org/whisper.cpp)，作者 Georgi Gerganov 与贡献者，MIT；评估过其 WebAssembly 本机转写方案。移动端首次需要加载较大模型且一分钟音频分析耗时明显，本版没有引入，避免影响手机打开和录音流程。
- 云端部署检索关键词：`site:github.com ".openai/hosting.json"`。核实 [openai/sites](https://github.com/openai/sites) 的 README、模板部署配置、打包插件源码与 MIT 许可证（OpenAI，2026）。参考其 `dist/server`、`dist/client` 和 `dist/.openai/hosting.json` 产物格式，自行编写适配现有 Vite 7 项目的 Fetch Worker 与打包脚本，保留现有 React 前端。运行时采用标准 Web Crypto、Request / Response 和 Fetch API。
- 启动器参考 [nodejs/node 的 child_process 官方文档](https://github.com/nodejs/node/blob/main/doc/api/child_process.md)，作者 Node.js contributors，[MIT](https://github.com/nodejs/node/blob/main/LICENSE)。检索关键词：`site:github.com/nodejs/node child_process detached Windows`、`site:github.com/nodejs/node LICENSE MIT`。采用 Node 内置的 `spawn` / `detached` / `unref` / `windowsHide`，本项目自行实现健康检查和启动逻辑，未增加第三方进程管理依赖。

训练流程、场景匹配、音频处理、证据校验、复盘界面为本项目实现。其余包通过 npm 使用，锁定版本见 `package-lock.json`；完整直接依赖许可证保留于 `THIRD_PARTY_NOTICES.md`，依赖包原许可证仍在安装包内。

## 验证

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
```

浏览器测试优先使用本机 Chrome；没有 Chrome 时请运行 `npx.cmd playwright install chromium`。测试配置会为每个测试创建独立浏览器上下文，使用测试专用合成音源与测试服务响应，不会导入你的笔记或读取你的浏览器数据。

详见 `VERIFICATION.md`，明确区分真实浏览器录音机制验证、测试服务验证和待配置服务的真实中文语音验证。
