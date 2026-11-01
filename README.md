# ON AIR

一个本地的「深夜电台访谈」界面：你打中文提问，模型用英文回答，TTS 把英文念出来，屏幕上是一颗光球、几圈轨道，和一群在拼图里各干各事的小人。

> A local, voice-driven interview UI for any Anthropic-compatible model, voiced by BreezeBlue TTS.

## 它是什么

- 提问 → 回答 → 语音，全部在一个页面里完成，不需要打开别的窗口
- **光球**是核心：外面五圈倾角各异的椭圆轨道缓慢转动；说话时每个重音都会从核心推出一圈声波，最内圈和光点同时提亮；等待回答时轨道淡出，换成一面对着的钟
- **回答**按句合成、逐句播放，英文大字配中文副标，播完 1.8 秒淡出
- **大屏/全屏**时自动切成横屏：左栏回答像歌词一样往上滚，右栏是放大的光球
- **背景**是一整张拼图，正中缺一块、光球落在缺口里；发送提问时背景慢慢糊掉，回答播完再回来

## 快速开始

需要 Node 18+，无第三方依赖。

```bash
cp config.example.json config.json      # Windows: copy config.example.json config.json
```

编辑 `config.json`，至少填四处：

| 字段 | 填什么 |
| --- | --- |
| `brain.baseUrl` | Anthropic 兼容接口地址 |
| `brain.apiKey` | 对应的 key |
| `brain.model` | 模型名 |
| `voice.apiKey` | BreezeBlue 的 `brz_...` |
| `voice.voiceId` | 英文音色的 `voc_...`（回答是英文，要用英文音色） |

然后：

```bash
node server.mjs
```

打开 http://localhost:7788 。

**Windows 上**还可以双击 `ON AIR.vbs`：后台起服务，开一个没有地址栏的独立窗口。

## 配置项

| 字段 | 说明 |
| --- | --- |
| `brain.system` | 系统提示词，规定回答语速、句数、返回的 JSON 结构 |
| `brain.maxTokens` | 输出预算。带思考过程的模型要留够，太小会被思考吃光 |
| `voice.instructions` | 导演指令，描述说话方式（语速、情绪、录音质感） |
| `voice.proxy` | 语音请求走的代理，例如 `http://127.0.0.1:7890`。大陆直连 BreezeBlue 会被限流，报 429 或连接超时 |
| `voice.voiceSettings` | 透传给 TTS 的参数，如 `speed`、`stability` |

## 费用

每问一次：一次语言模型调用 + 回答里每句一次 TTS 请求。BreezeBlue 大约 1 credit ≈ 10 字符（中文按 2 字符计），一轮三五句通常在十几 credits 量级。

## 目录

```
server.mjs          Node 服务，无第三方依赖
config.example.json 配置模板
public/             前端（index.html / app.js / style.css / puzzle-bg.js）
design/             设计过程的小样（拼图、小人、脚印、轨道等方向）
ON AIR.vbs          Windows 启动器：无黑窗起服务 + 独立窗口
```

## 已知限制

- **BreezeBlue 地域限制**：从中国大陆直连会被限流（429 / 连接超时），用 `voice.proxy` 指到境外出口
- **浏览器要求**：页面用容器查询单位做等比缩放，需要 Chrome/Edge 105+、iOS Safari 16+
- 回答内容与音频会经过你配置的模型与 TTS 服务商，注意各自的隐私条款

## License

MIT
