export const REVIEW_LIVE_MAPS = Object.freeze({
  'image-generation': Object.freeze({
    id: 'image-generation',
    title: '生图流程拆解',
    summaryRef: 'Pasted image 20260620133330.png',
    roots: ['image-process'],
    nodes: Object.freeze({
      'image-process': {
        title: '生图过程拆解',
        children: ['style-master', 'specific-frame'],
      },
      'style-master': {
        title: '确定风格母图',
        children: ['visual-language'],
        detail: '先用一张画面确定整支视频的低饱和、水彩纸张与自然语言生成基准。',
        media: ['assets/review-media/003-Pasted image 20260619162326.png'],
      },
      'visual-language': {
        title: '感受 · 模糊画面 · 自然语言交互生成',
        children: ['followup-generation', 'extract-style-prompt'],
      },
      'followup-generation': {
        title: '后续垫图生成',
        detail: '把风格母图继续作为后续画面的视觉参考。',
      },
      'extract-style-prompt': {
        title: '提取结构提示词',
        detail: '提取母图的风格特征，形成后续提示词的统一视觉前缀。',
      },
      'specific-frame': { title: '生成具体画面', children: ['spatial-logic'] },
      'spatial-logic': {
        title: '空间逻辑的具体问题',
        children: ['text-prompt', 'visual-reference', 'reset-camera'],
      },
      'text-prompt': { title: '文字提示词', children: ['separate-object'] },
      'separate-object': {
        title: '把关键物件拆出来单独处理',
        detail: '先明确近景、远景与关键物件的位置，再组合成完整画面。',
        media: [
          'assets/review-media/004-Pasted image 20260619154519.png',
          'assets/review-media/005-Pasted image 20260619154546.png',
        ],
      },
      'visual-reference': {
        title: '直观的空间参考',
        children: ['photo-reference', 'sketch-reference'],
      },
      'photo-reference': {
        title: '用现实照片固定构图关系',
        detail: '用现实照片给模型一个更稳定的空间参考。',
        media: [
          'assets/review-media/006-Pasted image 20260619155425.png',
          'assets/review-media/009-61251164-f605-4c01-b1f7-0df5ea0d272a 1.png',
        ],
      },
      'sketch-reference': {
        title: '用草图固定构图关系',
        detail: '把空间关系先画成草图，再让模型沿草图生成。',
        media: ['assets/review-media/008-Pasted image 20260619222441.png'],
      },
      'reset-camera': { title: '重置镜头逻辑', children: ['new-chat', 'rethink-shot'] },
      'new-chat': {
        title: '新开一个聊天框',
        detail: '清除前面失败结果形成的上下文污染。',
      },
      'rethink-shot': {
        title: '重新审视镜头本身',
        detail: '如果反复调整仍然失败，就重新判断这个镜头是否成立。',
      },
    }),
  }),
  'video-generation': Object.freeze({
    id: 'video-generation',
    title: '视频流程拆解',
    summaryRef: 'Pasted image 20260716151430.png',
    roots: ['video-process'],
    nodes: Object.freeze({
      'video-process': {
        title: '视频流程拆解',
        children: ['motion-design', 'video-prompt', 'frame-bridging'],
      },
      'motion-design': {
        title: '选图与设计运动',
        children: ['motion-from-image', 'high-precision-motion'],
      },
      'motion-from-image': {
        title: '图片',
        children: ['image-expectation'],
      },
      'image-expectation': {
        title: '风格统一 · 视角成立 · 符合预期',
        detail: '先判断静态画面能否承载运动：风格、视角和空间关系必须在动起来之前成立。',
        media: ['assets/review-media/025-Pasted image 20260620175930.png'],
      },
      'high-precision-motion': {
        title: '高精度动作设计',
        children: ['high-generation-cost'],
      },
      'high-generation-cost': {
        title: '预期高抽卡成本',
        children: ['motion-necessity', 'rewrite-result', 'split-tasks', 'iterate-prompt'],
      },
      'motion-necessity': {
        title: '判断动作是否真的需要被完整展示',
        detail: '复杂动作不一定都要被完整呈现，先确认它是否真的服务叙事。',
      },
      'rewrite-result': {
        title: '把动作过程改写为动作结果',
        detail: '当过程难以稳定生成时，用清晰的结果状态代替冗长过程。',
      },
      'split-tasks': {
        title: '拆掉镜头里的多重任务',
        detail: '一个镜头只承担一个主要动作，降低模型同时处理多个目标的压力。',
      },
      'iterate-prompt': {
        title: '调整提示词和继续生成',
        detail: '把失败结果当作新的约束证据，逐步收窄动作描述。',
      },
      'video-prompt': {
        title: '视频提示词、生成与筛选',
        children: ['simple-motion', 'complex-motion'],
      },
      'simple-motion': {
        title: '简单 / 平常',
        children: ['positive-negative-prompt'],
      },
      'positive-negative-prompt': {
        title: '正向描述 · 负向描述 · 避免过多抽象词汇',
        detail: '正向描述画面怎样运动，反向描述保护人物、视角与空间关系。',
        media: ['assets/review-media/013-Pasted image 20260620160734.png'],
      },
      'complex-motion': {
        title: '复杂 / 反复不理想',
        children: ['second-by-second-prompt'],
      },
      'second-by-second-prompt': {
        title: '细致提示词：几秒～几秒承担动作',
        detail: '把动作拆成时间段，写清稳定、开始、完成和最终停留状态。',
        media: ['assets/review-media/014-Pasted image 20260620161558.png'],
      },
      'frame-bridging': {
        title: '首尾帧衔接和过渡帧补充',
        children: ['first-last-frame', 'transition-frame'],
      },
      'first-last-frame': {
        title: '首尾帧',
        children: ['separate-frame-motion', 'continue-last-frame'],
      },
      'separate-frame-motion': {
        title: '分别做新图产生运动',
        detail: '明确首帧与尾帧的目标画面，让模型在两张图之间生成运动。',
        media: [
          'assets/review-media/015-9c986860-16c4-44c2-89ed-797674a42c6f.png',
          'assets/review-media/016-3789431f-f263-45d4-961e-9eeaf77d40cc 1.png',
        ],
      },
      'continue-last-frame': {
        title: '尾帧续写',
        children: ['keep-video-texture'],
      },
      'keep-video-texture': {
        title: '保持视频画面质感一致',
        detail: '使用上一段视频的最后一帧作为下一段起点，避免回跳到原图质感。',
        media: ['assets/review-media/018-屏幕录制 2026-06-20 165924.mp4'],
      },
      'transition-frame': {
        title: '过渡帧',
        children: ['split-large-change'],
      },
      'split-large-change': {
        title: '把跨度太大的变化拆解',
        children: ['transition-from-frames', 'nine-grid-transition'],
      },
      'transition-from-frames': {
        title: '基于首尾帧图片生成过渡帧',
        detail: '在跨度太大的两个状态之间补一张关键中间画面。',
        media: ['assets/review-media/022-Pasted image 20260620172404.png'],
      },
      'nine-grid-transition': {
        title: '基于场景生成九宫格逐帧变化图',
        detail: '先把变化拆成连续阶段，再选择最合适的中间帧。',
        media: ['assets/review-media/025-Pasted image 20260620175930.png'],
      },
    }),
  }),
  editing: Object.freeze({
    id: 'editing',
    title: '剪辑流程拆解',
    summaryRef: 'Pasted image 20260716153618.png',
    roots: ['general-process', 'specific-details'],
    nodes: Object.freeze({
      'general-process': { title: '一般流程', children: ['edit-while-generating'] },
      'edit-while-generating': {
        title: '边生成边精剪',
        children: ['keep-flexibility', 'allow-incomplete'],
      },
      'keep-flexibility': {
        title: '有意识地给前期剪辑保留弹性',
        detail: '先确认镜头位置和大致长度，不急于把每一个节奏点修到极致。',
      },
      'allow-incomplete': {
        title: '允许不完整地停留在时间线中',
        detail: '为仍可能改变的段落保留调整空间。',
      },
      'specific-details': {
        title: '具体细节',
        children: ['transition-black', 'music-rhythm', 'sound-effect'],
      },
      'transition-black': {
        title: '转场与黑场',
        children: ['visual-transition', 'dissolve', 'black-frame'],
      },
      'visual-transition': {
        title: '画面设计层面的转场',
        detail: '延续相似动作、元素、构图或视觉效果。',
        media: [
          'assets/review-media/027-4 1.png',
          'assets/review-media/028-fe0efbc4-3df0-4491-9fd4-e0059b5cceee 3.png',
        ],
      },
      dissolve: {
        title: '转场特效：叠化',
        detail: '通过短暂交叠让两个镜头柔和衔接。',
      },
      'black-frame': {
        title: '黑场',
        detail: '用停顿分隔节奏，并为前后情绪提供缓冲。',
      },
      'music-rhythm': {
        title: '音乐节奏',
        children: ['rhythm-expectation', 'rhythm-response'],
      },
      'rhythm-expectation': {
        title: '画面给予模糊的预期',
        detail: '音乐先让观众预感画面应如何变化。',
      },
      'rhythm-response': {
        title: '停顿、切换、密度和动作回应节奏',
        detail: '所有匹配最终都必须服务叙事。',
      },
      'sound-effect': {
        title: '音效',
        children: ['world-relation', 'world-feedback'],
      },
      'world-relation': {
        title: '补充画面里事物之间的联系',
        detail: '声音让画面中的动作、空间与物件真正发生关系。',
      },
      'world-feedback': {
        title: '呈现动作对世界产生的反馈',
        detail: '脚步、衣料和环境声让动作拥有重量。',
      },
    }),
  }),
});

export function resolveReviewMap(ref = '') {
  return Object.values(REVIEW_LIVE_MAPS).find((map) => map.summaryRef === ref) ?? null;
}

export function visibleReviewMapNodes(map, expanded = new Set()) {
  const visible = new Set(map?.roots ?? []);
  const visit = (id) => {
    if (!expanded.has(id)) return;
    for (const child of map.nodes[id]?.children ?? []) {
      visible.add(child);
      visit(child);
    }
  };
  [...visible].forEach(visit);
  return [...visible];
}
