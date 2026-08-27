import type { Lesson, ServoLessonSection } from '../../data/challenges/lessons';
import type { AppLocale } from '../preferences/localization';
import { buildConceptQuestion } from './lessonAssessments';
import { isCourseLocale, localizeInternationalServoLesson } from './internationalLessonLocalization';

type FourLines = readonly [string, string, string, string];

interface LocalizedServoSeed {
  name: string;
  description: string;
  goal: string;
  concepts: FourLines;
  activities: FourLines;
}

const ZH_CN_SERVO_SEEDS: Readonly<Record<string, LocalizedServoSeed>> = {
  'lesson-1-first-cut': {
    name: '1 · 第一次切割',
    description: '所有舵机都从 90° 开始。只需一条 X 轴命令即可完成第一次切割。',
    goal: '确认 X、Y、Z、B、E 均显示 90°，再将 X · 底座偏航设为 120°。',
    concepts: [
      '舵机角度是绝对目标值。120° 表示让 X 移到 120°，不是在当前角度上增加 120°。',
      'X · 底座偏航会带动整条机械臂绕头部旋转。',
      '校准后的全 90° Home 姿势与头部保持安全距离，适合完成这次短扫掠。',
      'X 已经位于 90°，再次发送 90° 不会产生移动。',
    ],
    activities: [
      '先预测 X 从 90° 移到 120° 时的运动方向。',
      '执行一个积木块，只观察实时 X 数值的变化。',
      '找出并修正控制了错误舵机的积木块。',
      '只用一个启用的源积木块完成目标。',
    ],
  },
  'lesson-2-clear-the-head': {
    name: '2 · 继续扫掠',
    description: '仍从全 90° Home 开始，让 X 比上一课多扫掠 10°。',
    goal: '将 X · 底座偏航设为 130°，并与第一课切除的体素进行比较。',
    concepts: [
      '起点同为 90° 时，较大的 X 绝对目标值会形成更长的扫掠。',
      'X 轴会改变水平覆盖范围，不会改变 Y、Z 或 B。',
      '目标预览会标出较长扫掠新增覆盖的边界。',
      '同时改变多个舵机会掩盖额外切割的真正原因。',
    ],
    activities: [
      '预测从 120° 增加到 130° 时，哪一侧会多切除体素。',
      '单步执行 X 命令，并读取实时角度值。',
      '修正仍停在上一课 120° 终点的程序。',
      '只用一条 X 命令达到 100 完成度。',
    ],
  },
  'lesson-3-shoulder': {
    name: '3 · 十体素扫掠',
    description: '再改变 5°，切刀会完整扫过一条十体素带。',
    goal: '让 Y、Z、B 保持 Home 90°，并将 X · 底座偏航设为 135°。',
    concepts: [
      '连续扫掠时，小幅角度变化也可能跨过多个体素边界。',
      'Y · 肩部保持 90°；Home 是真实命令值，不是隐藏姿势。',
      '目标体素由模拟切刀实际经过的路径测量得出。',
      '如果停在 130°，目标带仍会留下一部分。',
    ],
    activities: [
      '预测超过 130° 后会跨过哪一条新边界。',
      '单步执行，并比较 X 遥测值与末端执行器坐标。',
      '修正误用了上一课终点的程序。',
      '只用一个准确的绝对目标角度完成任务。',
    ],
  },
  'lesson-4-elbow': {
    name: '4 · 找到边缘',
    description: '十体素带之外还有最后一个边缘体素。',
    goal: '将 X · 底座偏航设为 145°，其他舵机保持 90°。',
    concepts: [
      '目标边缘由切刀扫过的体积决定，不能只凭相机画面估计。',
      '本课应以实时 X 数值作为舵机目标的准确信息。',
      '整个移动过程仍需满足关节限制和头部碰撞检查。',
      '在到达边缘前停止，会留下一个目标体素。',
    ],
    activities: [
      '先判断 140° 能否到达最后一个体素。',
      '单步执行 X，并观察扫掠边缘附近的目标轮廓。',
      '修正提前 5° 停止的程序。',
      '不改变 Y、Z、B，只用 X 达到 100 完成度。',
    ],
  },
  'lesson-5-wrist': {
    name: '5 · 肘部工作带',
    description: '先用 Z · 肘部选择较低的三体素带，再执行扫掠。',
    goal: '先将 Z · 肘部设为 95°，再将 X · 底座偏航设为 135°。',
    concepts: [
      'Z · 肘部负责选择切刀的工作带，X 负责扫掠。',
      '将 Z 调整 5° 后，切刀会进入由三个体素组成的较低工作带。',
      'Z 必须先完成移动，整段 X 扫掠才会保持在同一工作带。',
      '如果 Z 留在 90°，切刀会超出这个狭窄目标。',
    ],
    activities: [
      '预测 Z = 95° 会怎样改变末端执行器高度。',
      '先单步执行 Z，并确认 X 仍为 90°。',
      '修正两条命令顺序颠倒的程序。',
      '只用一条 Z 设置命令和一条 X 扫掠命令完成目标。',
    ],
  },
  'lesson-6-stop-short': {
    name: '6 · 腕部工作带',
    description: '用 B · 腕部选择较高的三体素带。',
    goal: '先将 B · 腕部设为 105°，再将 X · 底座偏航扫掠到 135°。',
    concepts: [
      'B · 腕部会改变工具朝向，不会改变肘部关节。',
      '新的工具朝向会把切刀移到另一条三体素工作带。',
      '如果仍使用 Home 工作带的十体素扫掠，完成度会因误切而降低。',
      '改用 Z 会到达另一条工作带，无法命中本课目标。',
    ],
    activities: [
      '预测 B = 105° 时的工具朝向。',
      '先单步执行 B，观察实时 B 数值，再执行 X。',
      '修正误改 Z 而不是 B 的程序。',
      '用两条命令只切除较高的工作带。',
    ],
  },
  'lesson-7-narrow-band': {
    name: '7 · 在较低工作带及时停止',
    description: '较低工作带很窄，X 的终点决定切除两个还是三个体素。',
    goal: '先将 Z · 肘部设为 95°，再让 X · 底座偏航停在 130°。',
    concepts: [
      '同一条 Z 工作带可以通过不同 X 终点形成不同目标。',
      '停在 130° 会切除较低工作带中的两个体素。',
      '继续到 135° 会多切一个体素，因此属于误切。',
      '设置动作和终点都必须准确，才能获得精确评分。',
    ],
    activities: [
      '预测停在 130° 时，较低工作带的哪一侧会保留下来。',
      '比较 X = 130° 与 X = 135° 的测试得分。',
      '利用目标预览找出多切的一个体素。',
      '准确切除较低工作带中的两个体素。',
    ],
  },
  'lesson-8-full-cut': {
    name: '8 · 两条工作带',
    description: '从全 90° Home 开始，组合较低的 Z 工作带与较高的 B 工作带。',
    goal: '用 Z = 95°、X = 135° 切除较低工作带。将 X 和 Z 复位到 90°，再设置 B = 105°，最后让 X 再次扫掠到 135°。',
    concepts: [
      '处理多条工作带时，需要明确安排各个绝对舵机状态之间的过渡。',
      '将 X 恢复到 90°，可以为第二次扫掠建立正确起点。',
      '将 Z 恢复到 90°，可以避免第二次 B 设置继承较低工作带。',
      '跳过复位或改变复位顺序，都会改变切刀路径与切割结果。',
    ],
    activities: [
      '把程序分成较低工作带扫掠、Home 过渡和较高工作带扫掠三部分。',
      '使用单步执行，确认每一条 90° 复位命令。',
      '修正只能到达其中一条工作带的程序。',
      '建立完整的六命令程序，并确认六个目标体素都被切除。',
    ],
  },
};

const SECTION_TITLES = [
  '为什么要学', '学习目标', '绝对角度', '关节作用', '安全与评分', '常见错误',
  '查看初始姿势', '检查实时数值', '找出使用的舵机', '预测动作', '建立第一次尝试',
  '使用“单步执行”', '使用“测试”', '只改一个变量', '读取运行证据', '调试练习',
  '独立挑战', '用自己的话解释', '准备最终检查', '评分检查点',
] as const;

const JOINT_LABELS: Readonly<Record<string, string>> = {
  baseYaw: 'X · 底座偏航', shoulder: 'Y · 肩部', elbow: 'Z · 肘部', wrist: 'B · 腕部',
};

const TRADITIONAL_PHRASES: readonly (readonly [string, string])[] = [
  ['舵机', '伺服馬達'], ['程序', '程式'], ['积木块', '積木塊'], ['实时', '即時'],
  ['运行', '執行'], ['调试', '除錯'], ['复位', '重設'], ['遥测', '遙測'],
  ['机械臂', '機械臂'], ['目标', '目標'], ['头发', '頭髮'], ['工作带', '工作帶'],
  ['底座偏航', '底座偏航'], ['单步执行', '單步執行'],
];

const TRADITIONAL_CHARACTERS: Readonly<Record<string, string>> = {
  '学': '學', '习': '習', '机': '機', '从': '從', '开': '開', '条': '條',
  '轴': '軸', '显': '顯', '将': '將', '设': '設', '为': '為', '绝': '絕',
  '对': '對', '让': '讓', '当': '當', '带': '帶', '动': '動', '绕': '繞',
  '头': '頭', '转': '轉', '准': '準', '后': '後', '势': '勢', '与': '與',
  '离': '離', '适': '適', '产': '產', '较': '較', '长': '長', '扫': '掃',
  '过': '過', '个': '個', '边': '邊', '界': '界', '标': '標', '预': '預',
  '测': '測', '哪': '哪', '侧': '側', '实': '實', '时': '時', '值': '值',
  '变': '變', '错': '錯', '误': '誤', '达': '達', '仅': '僅', '续': '續',
  '额': '額', '轮': '輪', '廓': '廓', '关': '關', '节': '節', '限': '限',
  '碰': '碰', '检': '檢', '查': '查', '该': '該', '确': '確', '信': '訊',
  '会': '會', '留': '留', '狭': '狹', '窄': '窄', '顺': '順',
  '颠': '顛', '观': '觀', '复': '復', '位': '位', '继': '繼',
  '尝': '嘗', '试': '試', '删': '刪', '暂': '暫', '运': '運', '证': '證',
  '据': '據', '读': '讀', '说': '說', '这': '這', '么': '麼', '响': '響',
  '课': '課', '处': '處', '发': '發', '数': '數', '进': '進',
  '组': '組', '两': '兩', '还': '還', '间': '間', '结': '結',
  '果': '果', '择': '擇', '无': '無', '线': '線', '护': '護',
};

function toTraditionalChinese(value: string): string {
  let result = value;
  for (const [simplified, traditional] of TRADITIONAL_PHRASES) {
    result = result.replaceAll(simplified, traditional);
  }
  return [...result].map((character) => TRADITIONAL_CHARACTERS[character] ?? character).join('');
}

function localizePose(value: string): string {
  return value
    .replaceAll('X · Base Yaw', JOINT_LABELS.baseYaw)
    .replaceAll('Y · Shoulder', JOINT_LABELS.shoulder)
    .replaceAll('Z · Elbow', JOINT_LABELS.elbow)
    .replaceAll('B · Wrist', JOINT_LABELS.wrist);
}

function localizeSection(
  section: ServoLessonSection,
  index: number,
  seed: LocalizedServoSeed,
  lesson: Lesson,
): ServoLessonSection {
  const activeJoints = [...new Set(lesson.solution.map(({ jointId }) => JOINT_LABELS[jointId] ?? jointId))].join('、');
  const bodies = [
    seed.description,
    seed.goal,
    ...seed.concepts,
    localizePose(section.body),
    '在检查器中找到所有初始角度，并判断哪些数值已经符合目标设置。',
    `本课只需分析这些舵机：${activeJoints}。添加积木块前，先说明每个舵机的作用。`,
    seed.activities[0],
    '建立你认为能到达目标的最短程序，并按预期执行顺序排列命令。',
    seed.activities[1],
    '按“测试”，将完成度、目标轮廓和碰撞消息与你的预测进行比较。',
    '重置后只改变一个角度或一条命令的位置，让分数变化有明确原因。',
    '结合舵机实时数值、积木块高亮和事件日志，说明程序实际做了什么。',
    seed.activities[2],
    seed.activities[3],
    `说明这条规则为什么会影响本课：${seed.concepts[1]}`,
    '重置到本课初始状态，删除误加的积木块，并在暂不运行的情况下建立最终答案。',
    '自行建立最终程序并按“测试”。达到 100 完成度后，才能完成本课并解锁下一课。',
  ];
  return { ...section, title: SECTION_TITLES[index] ?? section.title, body: bodies[index] ?? section.body };
}

export function localizeServoLesson(lesson: Lesson, locale: AppLocale): Lesson {
  if (locale === 'en') return lesson;
  if (isCourseLocale(locale)) return localizeInternationalServoLesson(lesson, locale);
  const seed = ZH_CN_SERVO_SEEDS[lesson.id];
  if (!seed) return lesson;
  const localized = {
    ...lesson,
    name: seed.name,
    description: seed.description,
    goal: seed.goal,
    assessments: {
      multipleChoice: {
        ...buildConceptQuestion(
          seed.name,
          seed.concepts[0],
          lesson.assessments.multipleChoice.correctOptionIndex,
          [
            '每条舵机命令都会在当前角度上增加一个偏移量，而不是设置绝对目标。',
            '同时改变多个关节，一定更容易判断分数变化的原因。',
          ],
        ),
        question: `关于“${seed.name}”，下列哪项说法正确？`,
      },
      practicalPrompt: '请自行建立 Blockly 程序，按“测试”并达到 100 完成度。',
    },
    sections: lesson.sections.map((section, index) => localizeSection(section, index, seed, lesson)),
  };
  if (locale === 'zh-CN') return localized;
  return {
    ...localized,
    name: toTraditionalChinese(localized.name),
    description: toTraditionalChinese(localized.description),
    goal: toTraditionalChinese(localized.goal),
    assessments: {
      multipleChoice: {
        ...localized.assessments.multipleChoice,
        question: toTraditionalChinese(localized.assessments.multipleChoice.question),
        options: localized.assessments.multipleChoice.options.map(toTraditionalChinese) as [string, string, string],
      },
      practicalPrompt: toTraditionalChinese(localized.assessments.practicalPrompt),
    },
    sections: localized.sections.map((section) => ({
      ...section,
      title: toTraditionalChinese(section.title),
      body: toTraditionalChinese(section.body),
    })),
  };
}

export function localizeServoLessons(lessons: readonly Lesson[], locale: AppLocale): readonly Lesson[] {
  return lessons.map((lesson) => localizeServoLesson(lesson, locale));
}
