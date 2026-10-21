# 版式与节奏

下表对应实际基础 template_id；可用格数以本机 template list 的 JSON 为准，不能凭名称猜可用性。基础配方来自 manga-blueprint-studio，本插件只精简其用途说明，来源见 NOTICE。

```shell
soda-storyboard template list --panels 5 --json
```

| template_id | 更适合什么 | 给用户怎么解释 |
| --- | --- | --- |
| `balanced-grid` | 普通对话、日常、说明 | 读起来稳定，先看清发生什么 |
| `vertical-rhythm` | 安静推进、连续时间 | 一条一条往下读；四格时是四条等高横格 |
| `horizontal-rhythm` | 动作分解、并排比较 | 同一段里的几个瞬间并排看，最多四格 |
| `hero-top` | 场景交代、人物登场、开场冲击 | 先让一张大画面把人带进去 |
| `hero-bottom` | 揭示、情绪高潮、收尾 | 上面慢慢铺垫，最后一格落下来 |
| `hero-right` | 纵向人物登场，再看反应 | 大格放在最先读的一侧；LTR 时镜像到左边 |
| `dialogue-stagger` | 对话切换、听者反应 | 宽窄交替，别让两个人一直同样说话 |
| `action-step` | 动作逐渐加速 | 前面小步推进，后面让关键动作放大 |
| `detail-payoff` | 线索、悬念、发现 | 先看几个细节，再看完整答案 |
| `quiet-build` | 犹豫、安静的情绪积累 | 变化不大，最后多留一点停顿 |
| `wide-middle` | 地点转换、动作中继 | 用中间的宽画面把前后接起来 |
| `ladder` | 动作来回、非对称节奏 | 左右宽度轮换，视线像踩台阶 |
| `three-band` | 起因、发展、落点 | 上中下各承担一段信息 |
| `cinematic-stack` | 风景、情绪、慢节奏 | 横格高低不同，像电影镜头换气 |

默认候选最多六个，同一 family 只取一个，因此不会把这十四种全部列出来；增大 candidates 也不会突破家族数。要比较同家族的其他配方，用 pick 精确指定 id。先向用户解释节奏，再等其选，不能让排名代替选择。

## 斜切什么时候用

紧张、冲撞、急转、情绪失衡时，可以用斜线加强方向感；安静谈话、细微犹豫不必都倾斜。斜格与矩形对比才明显。不要把每一格独立扭斜，邻格需要共用平行分割线，保持窄而均匀的留白。

```shell
soda-storyboard layout suggest --panels 5 --candidates 6 --preview-dir my-story/previews/candidates --json
soda-storyboard layout suggest --panels 5 --skew 0 --json
soda-storyboard layout suggest --panels 5 --skew 10 --json
soda-storyboard layout suggest --panels 5 --pick hero-top-skew --json
soda-storyboard page skew my-story/pages/page-01.json --panels p1,p2 --angle 8 --json
```

不写 skew 时混合展示；0 只给矩形；非零角度只给斜切候选。斜切变体 id 带 `-skew` 后缀，基于同一个基础 family。page skew 只适用于选中的同一完整行或列的相邻矩形，不能漏掉夹在中间的格子；它会直接写回，使用前先确认目标。默认 cut 编译不要求 MOSS 自己画斜边。

跨格人物用 overlays，不要故意制造两个面板重叠来绕过校验。出血、嵌套等其他几何不是现成模板参数；不要因为术语存在就声称工具已支持自动生成。
