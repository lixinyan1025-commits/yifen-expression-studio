import type { AudioFacts, Issue, Report, Topic, Transcript } from './types';

const fillers = /嗯+|呃+|额+|怎么说呢/g;
const hesitantRepeat = /([^哈呵嘿啊哦呀哎])\1{2,}/gu;

export function liveSignals(text: string) {
  return {
    characters: [...text.replace(/\s/g, '')].length,
    fillers: [...text.matchAll(fillers)].length,
    repeats: [...text.matchAll(hesitantRepeat)].length,
  };
}

export function localReport(input: {
  transcript: Transcript;
  facts: AudioFacts;
  topic: Topic;
}): Report {
  const { transcript, facts } = input;
  const issues: Issue[] = [];
  let sequence = 0;
  for (const segment of transcript.segments) {
    for (const match of segment.text.matchAll(fillers))
      issues.push({
        id: `local-${sequence++}`,
        kinds: ['口头禅'],
        segmentIds: [segment.id],
        quote: match[0],
        pauseId: null,
        start: segment.start,
        end: segment.end,
        status: 'suspected',
        explanation: '实时转写捕捉到填充表达；浏览器识别可能有误，请点击回听确认。',
        suggestion: '再次练习时，想好下一句再开口，允许短暂停顿代替填充词。',
      });
    for (const match of segment.text.matchAll(hesitantRepeat))
      issues.push({
        id: `local-${sequence++}`,
        kinds: ['卡壳', '无意义重复'],
        segmentIds: [segment.id],
        quote: match[0],
        pauseId: null,
        start: segment.start,
        end: segment.end,
        status: 'suspected',
        explanation: '原始转写出现连续三次以上的同字重复，可能是反复起头，也可能是强调。',
        suggestion: '回听这一段；若确为卡壳，尝试停半秒后直接说完整短句。',
      });
  }
  for (const pause of facts.pauses.filter(
    (item) => item.start > 0.4 && item.end < facts.duration - 0.4,
  ))
    issues.push({
      id: `local-${sequence++}`,
      kinds: ['长停顿'],
      segmentIds: [],
      quote: '',
      pauseId: pause.id,
      start: pause.start,
      end: pause.end,
      status: 'suspected',
      explanation: `WAV 在这里有 ${pause.duration.toFixed(2)} 秒低音量。它可能是正常思考或强调，也可能影响连贯，需要回听判断。`,
      suggestion: '如果这段停顿打断了意思，下次先用一句过渡语说明接下来要讲的理由。',
    });
  const signals = liveSignals(transcript.text);
  const priorities: Report['priorities'] = [];
  if (signals.fillers)
    priorities.push({
      focus: '减少填充词线索',
      exercise: `本次转写捕捉到 ${signals.fillers} 处填充词线索。下一次只练习用安静停顿替代“嗯、呃、额”。`,
    });
  if (signals.repeats)
    priorities.push({
      focus: '完整说出起头句',
      exercise: `本次有 ${signals.repeats} 处连续重复线索。先在心里形成五到十个字的短句，再一次说完。`,
    });
  if (issues.some((issue) => issue.kinds.includes('长停顿')))
    priorities.push({
      focus: '核对较长停顿',
      exercise: '点击每个停顿时间回听，只确认真正影响意思衔接的片段，再针对那一句重说。',
    });
  if (priorities.length < 2)
    priorities.push({
      focus: '核对实时转写',
      exercise: '对照录音逐段检查原话；浏览器漏掉或改错的内容以实际回听为准。',
    });
  if (priorities.length < 2)
    priorities.push({
      focus: '保留清楚的停顿',
      exercise: '再次挑战时继续完整说完一分钟，区分有意停顿和让句意断开的停顿。',
    });
  return {
    summary: `已根据 ${facts.duration.toFixed(1)} 秒真实 WAV 和实时转写完成本机基础复盘，捕捉到 ${signals.characters} 个字、${issues.length} 个待回听线索。`,
    strengths: [],
    issues,
    assessments: (['切题', '核心观点', '理由', '连贯性'] as const).map((dimension) => ({
      dimension,
      feedback: '本机规则不能可靠判断这一语义维度；请先结合题目与原音频自行核对。',
      quote: '',
    })),
    priorities: priorities.slice(0, 3),
    improved: transcript.text,
    connections: [],
    alternatives: [],
    limitations: [
      '这是基于真实 WAV、浏览器原始转写和明确规则的基础分析，没有随机分数或预设表扬。',
      '浏览器 Web Speech API 不提供可靠的词级音频时间戳；转写片段时间是结果返回时的近似位置，回听时请以前后原音为准。',
      '本机规则只标记可核验的低音量、填充词和连续重复，不判断逻辑、切题、观点质量或思路中断。',
      'Chrome 等浏览器的实时识别可能把音频交给浏览器厂商的语音服务处理，准确率和可用性受浏览器与网络影响。',
    ],
    discarded: 0,
  };
}
