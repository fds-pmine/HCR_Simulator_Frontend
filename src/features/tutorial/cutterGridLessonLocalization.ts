import type { AppLocale } from '../preferences/localization';
import type {
  CutterGridLesson,
  CutterGridLessonSection,
} from './cutterGridLessons';
import { buildConceptQuestion } from './lessonAssessments';
import { isCourseLocale, localizeInternationalGridLesson } from './internationalLessonLocalization';

type FourLines = readonly [string, string, string, string];

interface LocalizedGridSeed {
  name: string;
  description: string;
  goal: string;
  concepts: FourLines;
  activities: FourLines;
}

const ZH_TW_GRID_SEEDS: Readonly<Record<string, LocalizedGridSeed>> = {
  'cutter-grid-fixed-axes': {
    name: 'Grid 1 · 固定世界座標軸',
    description: '認識固定世界座標系中的六個移動方向。',
    goal: '使用 Right（+X）、Up（+Y）和 Forward（−Z）。座標軸不會隨機械臂旋轉。',
    concepts: [
      'Right/Left 改變世界 X，Up/Down 改變世界 Y，Forward/Backward 改變世界 Z。',
      '網格固定在世界座標中。無論機械臂或相機怎樣轉動，每個方向代表的座標軸都不會改變。',
      '每個 Move 的終點都必須位於認證網格內，而且規劃器必須能找到連通、安全的動作。',
      '常見錯誤是依照相機畫面判斷 Forward，而不是使用固定的 −Z 軸。',
    ],
    activities: [
      '把 Right 換成 Left，先預測哪一個座標的正負號會改變。',
      '轉動相機後再次執行同一個積木塊，確認它仍會改變同一條世界座標軸。',
      '找出路徑中互換了 Forward 和 Backward 的錯誤。',
      '建立一條涵蓋三條軸的路徑，讓終點在每條軸上都距離原點一格。',
    ],
  },
  'cutter-grid-distance': {
    name: 'Grid 2 · 移動距離',
    description: '用一個積木塊移動多個體素格。',
    goal: '距離必須是 1 到 12 的整數。執行時，切刀仍會逐格通過整條路徑。',
    concepts: [
      'Distance 表示體素格數，不是公尺、秒或舵機角度。',
      '一個 Move N 在 V4 中仍是一個可見動作，但邏輯指令成本是 N 格。',
      '可接受的距離是 1–12。零、小數或更大的數值都無法編譯。',
      '較長的 Move 不會跳過起點與終點之間的接觸。',
    ],
    activities: [
      '比較 Left 3 與三個相連的 Left 1。',
      '把距離從 3 改成 4，執行前先預測新的終點。',
      '修正超出 1–12 範圍的距離欄位。',
      '只用兩個 Move 積木塊到達座標（−3, 2, 0）。',
    ],
  },
  'cutter-grid-repeat': {
    name: 'Grid 3 · 重複路徑',
    description: '使用 Repeat 建立簡單的軸向圖案。',
    goal: '重複執行移動積木塊，同時把展開後的動作數控制在 500 以內。',
    concepts: [
      'Repeat 會依序展開內容，其中可以包含 Move、Wait 或另一個 Repeat。',
      'Repeat 本身不計入執行指令；展開後的每個葉節點才計入原本的成本。',
      '展開後最多可有 500 條邏輯指令，而 Repeat 次數必須介於 1–20。',
      '重複單向 Move 會持續累積位移，不會在每輪自動回到迴圈起點。',
    ],
    activities: [
      '預測 Repeat 3 × [Up 1] 的終點。',
      '加入反向移動，讓每一輪都回到原本的路點。',
      '修正內容為空、因此無法編譯的 Repeat。',
      '建立一個四邊迴圈並重複兩次，最後仍停在相同座標。',
    ],
  },
  'cutter-grid-overcut': {
    name: 'Grid 4 · 留意掃掠路徑',
    description: '切刀會一直運作，一段移動可能切除多個體素。',
    goal: '選擇只會切除目標頭髮的路徑。規劃器不會主動繞開頭髮。',
    concepts: [
      '切刀在所有程式終點之間移動時都保持運作。',
      '頭髮是否被切除取決於刀具實際掃過的體積，不只取決於畫面上的終點座標。',
      '規劃器會尋找安全的機械臂動作，但不會把非目標頭髮當成需要避開的障礙物。',
      '即使終點相同，兩個程式仍可能因掃掠路徑不同而產生不同切割結果。',
    ],
    activities: [
      '預測一條雙軸 L 形路徑會經過哪些體素。',
      '顛倒兩個 Move 的順序，然後比較「測試」結果。',
      '找出第一段穿過非目標頭髮的路徑，解釋意外切除的原因。',
      '到達相同終點，但避開已觀察到的額外切除。',
    ],
  },
  'cutter-grid-blocked': {
    name: 'Grid 5 · 封鎖節點',
    description: '部分網格座標超出機械臂已認證的關節空間。',
    goal: '利用疊加層避開封鎖節點。無法到達的 Move 會在執行前失敗。',
    concepts: [
      '某個座標即使位於顯示範圍內，也可能沒有經認證的安全逆向運動學解。',
      '橙色節點表示找不到安全逆解；青色節點有已知候選解，但仍需要規劃完整路徑。',
      '系統會在執行前規劃整個程式，並在第一個不連通的動作關閉執行。',
      '遇到封鎖節點時，不應放寬關節限制、碰撞間距或 Challenge 初始姿勢。',
    ],
    activities: [
      '根據疊加層圖例，找出一個可到達和一個被封鎖的座標。',
      '先判斷再多走一格會靠近還是遠離安全區域。',
      '執行一條刻意經過封鎖節點的路徑，查看系統標示的來源積木塊。',
      '只替換失敗的路段，其餘路徑保持不變。',
    ],
  },
  'cutter-grid-opposites': {
    name: 'Grid 6 · 相反方向',
    description: '用相反方向抵消位移。',
    goal: 'Right 配對 Left、Up 配對 Down、Forward 配對 Backward，讓切刀返回指定路點。',
    concepts: [
      'Right/Left、Up/Down、Forward/Backward 分別是三組互相抵消的位移。',
      '要反向走完整條路徑，必須反轉積木塊順序，再把每個方向換成相反方向。',
      '回到原座標不會復原已切除的頭髮；同一次執行中的切割不可逆。',
      '只替換方向但不反轉順序，無法正確沿原路返回。',
    ],
    activities: [
      '寫出 Left 2 → Up 1 的反向路徑。',
      '執行範例前先預測最終座標。',
      '修正仍沿用原本積木塊順序的反向路徑。',
      '建立一條涵蓋三條軸的去程，再建立完全相反的回程。',
    ],
  },
  'cutter-grid-wait': {
    name: 'Grid 7 · 在路點暫停',
    description: '保持目前規劃姿勢，不改變網格座標。',
    goal: '在 Move 之間插入 Wait。Wait 只影響時間，不會移動切刀或將它關閉。',
    concepts: [
      'Wait 會保持目前規劃的關節姿勢，邏輯網格座標不會改變。',
      'Wait 可設定為 0–5000 ms，並計為一條邏輯執行指令。',
      'Wait 期間切刀仍會運作，因此暫停不會復原或保護已接觸的頭髮。',
      'Wait 適合用來觀察路點，不能修復不連通或會碰撞的路徑。',
    ],
    activities: [
      '比較有無 Wait 時的終點，並先作出預測。',
      '在同一路點比較 250 ms 與 1000 ms 的暫停。',
      '修正超出允許範圍的 Wait 時間。',
      '在三段 Move 之間加入兩個不同的 Wait，然後檢查事件順序。',
    ],
  },
  'cutter-grid-route-order': {
    name: 'Grid 8 · 路徑順序',
    description: '用不同掃掠路徑到達相同終點。',
    goal: '調整軸向 Move 的順序並比較切割結果。終點相同，不代表切除的頭髮相同。',
    concepts: [
      '軸向移動在代數上可以交換順序，但實際掃掠路徑不一定相同。',
      '即使最終座標相同，程式順序仍會固定每個中間路點。',
      '規劃器會依照既定順序驗證一個凍結程式，而不是處理一組沒有順序的終點。',
      '只比較最終座標，會忽略中間切割和安全失敗。',
    ],
    activities: [
      '計算 Left 3 → Up 2 與 Up 2 → Left 3 共同的終點。',
      '測試兩種順序，並比較預計切除數量與分數。',
      '找出造成結果不同的第一段路徑。',
      '建立兩條終點相同的三積木塊路徑，再比較它們的掃掠路徑。',
    ],
  },
  'cutter-grid-compress': {
    name: 'Grid 9 · 精簡程式',
    description: '用一個距離欄位表示一段直線移動。',
    goal: '把相鄰且同方向的 Move 合併成一個積木塊，並了解合併在哪裡不再免費：端點相同，端點之間的動作卻不同。',
    concepts: [
      '相鄰且同方向的 Move 可以合併，但總距離不能超過 12。',
      '精簡會減少來源積木塊，邏輯距離、指令成本與每個端點都不變。',
      '如果 Move 之間有 Wait、另一個方向或 Repeat 邊界，就不能直接合併。',
      '規劃器會把每個可見積木塊當成一段連續動作，所以合併後的路徑會比原本分開的 Move 更偏離那條格線；大約超過六格之後，這個差距就會開始切到旁邊的體素。',
    ],
    activities: [
      '把四個 Forward 1 合併成一個等效 Move。',
      '解釋為何 Up 2 → Wait → Up 2 應保留中間路點。',
      '修正意外改變方向順序的精簡結果。',
      '在不改變安全路徑的前提下，用最少積木塊重寫一條七積木塊路徑。',
    ],
  },
  'cutter-grid-certified-cut': {
    name: 'Grid 10 · 認證理髮路徑',
    description: '結合三條座標軸，完成整個目標切割。',
    goal: '建立認證路徑，按「測試」，在不額外切除頭髮的情況下達到 100 完成度。',
    concepts: [
      '認證路徑結合 X、Y、Z 移動，準確切除十一個目標體素。',
      '「執行」、「測試」與「單步執行」會重用同一個凍結 V4 計畫，因此最終切割結果必須一致。',
      '要達到 100 完成度，必須切除所有目標頭髮，而且不能改變安全契約。',
      'Challenge 的安全初始姿勢與連接硬體時使用的全 90° Home 姿勢並不相同。',
    ],
    activities: [
      '逐一追蹤九積木塊參考路徑的所有路點。',
      '從空白 Cutter Grid 工作區建立完整路徑。',
      '把一個被改動的距離與認證序列比較，找出錯誤。',
      '按「測試」確認完成度為 100，再用「執行」或「單步執行」重播同一個計畫。',
    ],
  },
};

const SECTION_TITLES_ZH_TW = [
  '為何重要',
  '學習目標',
  '核心概念',
  '執行規則',
  '安全規則',
  '常見錯誤',
  '閱讀範例',
  '在紙上追蹤',
  '執行前預測',
  '建立範例',
  '檢查疊加層',
  '使用「單步執行」',
  '使用「測試」',
  '第一個變化',
  '第二個變化',
  '除錯練習',
  '獨立挑戰',
  '用自己的話解釋',
  '遷移應用',
  '課程檢查點',
] as const;

const SIMPLIFIED_PHRASES: readonly (readonly [string, string])[] = [
  ['伺服馬達', '舵机'],
  ['韌體', '固件'],
  ['遙測', '遥测'],
  ['儲存', '保存'],
  ['認識', '认识'],
  ['重複', '重复'],
  ['路徑', '路径'],
  ['簡單', '简单'],
  ['圖案', '图案'],
  ['一直運作', '持续运行'],
  ['目前', '当前'],
  ['姿勢', '姿势'],
  ['直線', '直线'],
  ['理髮', '理发'],
  ['距離欄位', '距离字段'],
  ['逆向運動學', '逆向运动学'],
  ['單步執行', '单步执行'],
  ['積木塊', '积木块'],
  ['疊加層', '叠加层'],
  ['程式', '程序'],
  ['路點', '路径点'],
  ['體素', '体素'],
  ['頭髮', '头发'],
  ['機械臂', '机械臂'],
  ['座標', '坐标'],
  ['舵機', '舵机'],
  ['認證', '认证'],
  ['執行', '运行'],
  ['規劃', '规划'],
  ['畫面', '画面'],
  ['相機', '相机'],
];

const SIMPLIFIED_CHARACTERS: Readonly<Record<string, string>> = {
  '學': '学', '習': '习', '識': '识', '個': '个', '軸': '轴', '會': '会',
  '隨': '随', '轉': '转', '動': '动', '變': '变', '網': '网', '屬': '属',
  '於': '于', '終': '终', '點': '点', '須': '须', '內': '内', '連': '连',
  '過': '过', '劃': '划', '顯': '显', '橙': '橙', '還': '还', '進': '进',
  '關': '关', '閉': '闭', '間': '间', '應': '应', '節': '节', '這': '这',
  '條': '条', '換': '换', '預': '预', '測': '测', '負': '负', '號': '号',
  '確': '确', '認': '认', '錯': '错', '誤': '误', '經': '经', '蓋': '盖',
  '讓': '让', '離': '离', '簡': '简', '數': '数', '欄': '栏', '較': '较',
  '長': '长', '觸': '触', '圍': '围', '無': '无', '編': '编', '譯': '译',
  '與': '与', '為': '为', '後': '后', '邏': '逻', '輯': '辑', '葉': '叶',
  '迴': '回', '圈': '圈', '開': '开', '實': '实', '際': '际', '掃': '扫',
  '體': '体', '積': '积', '僅': '仅', '尋': '寻', '將': '将', '標': '标',
  '當': '当', '顛': '颠', '導': '导', '額': '额', '封': '封', '鎖': '锁',
  '疊': '叠', '層': '层', '達': '达', '敗': '败', '並': '并',
  '區': '区', '替': '替', '餘': '余', '復': '复', '寫': '写',
  '暫': '暂', '態': '态', '觀': '观', '調': '调', '順': '顺',
  '凍': '冻', '結': '结', '組': '组', '壓': '压', '縮': '缩',
  '鄰': '邻', '總': '总', '來': '来', '閱': '阅', '讀': '读', '準': '准',
  '課': '课', '獨': '独', '說': '说', '話': '话', '紙': '纸',
  '檢': '检', '查': '查', '種': '种',
  '從': '从', '時': '时', '稱': '称', '該': '该',
  '複': '复', '徑': '径', '單': '单', '圖': '图', '運': '运', '勢': '势',
  '線': '线', '髮': '发', '礙': '碍', '處': '处', '擇': '择', '則': '则',
  '護': '护', '繼': '继', '續': '续', '產': '产', '見': '见',
  // Found by converting every zh-TW string in this file and looking for
  // characters that came through unchanged: the panel was rendering lines like
  // 「憑記憶…再用測試驗證」 to zh-CN readers, simplified frame around
  // traditional words.
  '論': '论', '樣': '样', '斷': '断', '範': '范', '兩': '两', '計': '计',
  '輪': '轮', '邊': '边', '選': '选', '繞': '绕', '決': '决', '雙': '双',
  '試': '试', '釋': '释', '沒': '没', '統': '统', '寬': '宽', '據': '据',
  '遠': '远', '對': '对', '別': '别', '響': '响', '設': '设', '適': '适',
  '許': '许', '驗': '验', '證': '证', '們': '们', '併': '并', '裡': '里',
  '費': '费', '卻': '却', '減': '减', '況': '况', '畫': '画', '蹤': '踪',
  '參': '参', '規': '规', '練': '练', '戰': '战', '遷': '迁', '剛': '刚',
  '舉': '举', '憑': '凭', '記': '记', '憶': '忆', '夠': '够', '項': '项',
  '敘': '叙',
};

export function toSimplifiedChinese(value: string): string {
  let result = value;
  for (const [traditional, simplified] of SIMPLIFIED_PHRASES) {
    result = result.replaceAll(traditional, simplified);
  }
  return [...result]
    .map((character) => SIMPLIFIED_CHARACTERS[character] ?? character)
    .join('');
}

function localizeSection(
  section: CutterGridLessonSection,
  index: number,
  seed: LocalizedGridSeed,
  example: string,
): CutterGridLessonSection {
  const bodies = [
    seed.description,
    seed.goal,
    ...seed.concepts,
    example,
    `從（0, 0, 0）開始，在紙上追蹤：${example}`,
    '寫下你預測的終點，以及切刀會掃過的每一段路徑。',
    `在 Blockly 中建立這個程式：${example}`,
    '開啟 Grid 和規劃路徑，將每個程式路點與世界座標軸疊加層逐一對照。',
    '重設後按一次「單步執行」，確認剛完成的可見動作，以及目前座標移到了哪裡。',
    '按「測試」，將分數、預計切除數量和最終座標與你的預測比較。',
    ...seed.activities,
    `用一句話解釋這條規則為何成立：${seed.concepts[1]}`,
    '舉出一個例子，說明這條規則會如何改變較長理髮路徑的設計。',
    '憑記憶重新建立本課的程式，先作出預測，再用「測試」驗證。',
  ];
  return {
    ...section,
    title: SECTION_TITLES_ZH_TW[index] ?? section.title,
    body: bodies[index] ?? section.body,
  };
}

/**
 * Localizes display copy only. Lesson ids, activities, examples and execution
 * semantics stay unchanged so localization cannot affect scoring or progress.
 */
export function localizeCutterGridLesson(
  lesson: CutterGridLesson,
  locale: AppLocale,
): CutterGridLesson {
  if (locale === 'en') return lesson;
  if (isCourseLocale(locale)) return localizeInternationalGridLesson(lesson, locale);
  const seed = ZH_TW_GRID_SEEDS[lesson.id];
  if (!seed) return lesson;

  const localized: CutterGridLesson = {
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
            '移動方向由相機畫面決定，所以轉動相機會改變程式的結果。',
            '程式只要能夠編譯，就一定會沿安全路徑完成預期切割。',
          ],
        ),
        question: `關於「${seed.name}」，下列哪項敘述正確？`,
      },
      practicalPrompt: seed.activities[3],
    },
    sections: lesson.sections.map((section, index) =>
      localizeSection(section, index, seed, lesson.example),
    ),
  };
  if (locale !== 'zh-CN') return localized;

  return {
    ...localized,
    name: toSimplifiedChinese(localized.name),
    description: toSimplifiedChinese(localized.description),
    goal: toSimplifiedChinese(localized.goal),
    assessments: {
      multipleChoice: {
        ...localized.assessments.multipleChoice,
        question: toSimplifiedChinese(localized.assessments.multipleChoice.question),
        options: localized.assessments.multipleChoice.options.map(toSimplifiedChinese) as [string, string, string],
      },
      practicalPrompt: toSimplifiedChinese(localized.assessments.practicalPrompt),
    },
    sections: localized.sections.map((section) => ({
      ...section,
      title: toSimplifiedChinese(section.title),
      body: toSimplifiedChinese(section.body),
    })),
  };
}

export function localizeCutterGridLessons(
  lessons: readonly CutterGridLesson[],
  locale: AppLocale,
): readonly CutterGridLesson[] {
  return lessons.map((lesson) => localizeCutterGridLesson(lesson, locale));
}
