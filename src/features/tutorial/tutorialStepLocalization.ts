import type { AppLocale } from '../preferences/localization';
import type { Lesson } from './lessons';
import { toSimplifiedChinese } from './cutterGridLessonLocalization';
import { localizeInternationalTutorialStep } from './internationalTutorialLocalization';

type TutorialStep = Pick<Lesson, 'id' | 'title' | 'body' | 'hint'>;

const ZH_TW: Readonly<Record<string, Omit<TutorialStep, 'id'>>> = {
  'grid-welcome': { title: '移動切刀，而不是逐一控制伺服馬達', body: '切刀網格讓你用三維座標描述切刀路徑。規劃器會計算關節角度、同步動作，並從安全的挑戰初始姿勢開始。' },
  'grid-left': { title: '加入第一個移動', body: '開啟切刀網格，把「向左移動」積木塊拖到工作區，並把距離設為 3 個體素。', hint: '向左是固定世界網格的 −X 方向。請在數字欄輸入 3。' },
  'grid-up': { title: '沿第二條軸移動', body: '在第一個積木塊下方連接「向上移動 6 個體素」。相連的積木塊會由上至下執行。', hint: '向上是 +Y 方向。請確認兩個積木塊已連成同一組。' },
  'grid-forward': { title: '用第二個積木塊爬完剩下的高度', body: '接上「向上移動 2 個體素」。要用兩個積木塊，而不是一個「向上移動 8」：規劃器會把每個積木塊當成一段連續動作，距離越長，路徑越會偏離你瞄準的那條格線。', hint: '目前程式應為：向左 3 → 向上 6 → 向上 2。' },
  'grid-overlay': { title: '執行前先讀懂網格', body: '疊加層會顯示可到達、封鎖、已規劃及已執行的座標。封鎖路徑會在機械臂移動前被規劃器拒絕。' },
  'grid-complete-route': { title: '完成認證路徑', body: '加入其餘六個積木塊：向前 1、向上 1、向前 1、向上 1、向前 6、向前 1。這條九積木塊路徑會準確切除十一個目標體素，且不會多切。', hint: '向左 3 → 向上 6 → 向上 2 → 向前 1 → 向上 1 → 向前 1 → 向上 1 → 向前 6 → 向前 1。' },
  'grid-test': { title: '規劃並測試完整路徑', body: '按「測試」。切刀網格會先規劃完整軌跡，再在背景執行並依切刀掃掠路徑評分。', hint: '如果規劃失敗，請逐一檢查方向、距離及積木塊順序。' },
  'grid-done': { title: '可以開始切刀網格課程了', body: '你現在可以組合固定軸移動、閱讀安全疊加層，並測試規劃後的切割。後續課程會涵蓋重複執行、掃掠切割、封鎖節點、路點、閉合路徑及程式精簡。' },

  'bridge-welcome': { title: '同一條機械臂，兩種控制層級', body: '切刀網格描述切刀要去哪裡；伺服角度描述帶動切刀的關節終點。這個教學讓你在同一個挑戰中使用兩者。' },
  'bridge-grid-command': { title: '先表達空間意圖', body: '在切刀網格加入任一「移動」積木塊。你選擇固定世界方向與距離，規劃器負責同步關節動作。', hint: '開啟切刀網格並拖入「向左移動」。這次比較使用距離 1 即可。' },
  'bridge-grid-ui': { title: '查看切刀網格提供的資訊', body: '檢查器會顯示世界座標軸、邏輯座標、安全逆解資訊和規劃路徑。切刀網格負責空間意圖，規劃器負責關節解。' },
  'bridge-switch-servo': { title: '切換到伺服角度', body: '使用 Blockly 上方的模式切換器選擇伺服角度。只有待機時才能切換；切換會重設模擬，但不會刪除已儲存的切刀網格工作區。', hint: '兩個模式按鈕位於「程式」標題正下方。' },
  'bridge-servo-command': { title: '直接指定關節終點', body: '加入一個「設定關節角度」積木塊。在伺服模式中，你直接選擇關節及其絕對目標角度，執行時不會再經過逆向運動學規劃器。', hint: '開啟「伺服馬達」類別，拖入「設定」積木塊，並選擇任一有效關節角度。' },
  'bridge-home-angle': { title: '回零位（Home）是 90°，遙測值會即時更新', body: '新的硬體伺服積木塊會使用韌體回零角度 90°。Electron 也會在執行前把 X、Y、Z、B、E 回零到 90°，並在機械臂面板顯示硬體回報值。檢查器中的 X/Y/Z/B 會跟隨模型即時更新；E 在切刀致動納入模擬前維持 90°。' },
  'bridge-telemetry': { title: '用遙測連接兩種視角', body: '伺服遙測使用 Electron 傳給機械臂的 X/Y/Z/B 名稱與絕對角度；切刀網格座標則顯示切刀的空間終點。兩者合起來可以說明規劃器算出的動作，以及硬體會收到的命令。進入及重設後，五條硬體軸均為 90°。' },
  'bridge-return-grid': { title: '確認兩個工作區互不干擾', body: '切換回切刀網格。先前的「移動」積木塊應仍在原處；兩種語言會為同一個挑戰分別保存工作區。' },
  'bridge-done': { title: '依任務選擇合適的控制層級', body: '教學及設計切刀路徑時使用切刀網格；研究關節行為或控制相容硬體時使用伺服角度。兩種視角都以安全限制及全 90° 回零位（Home）為準。' },

  welcome: { title: '由你寫程式，機械臂負責切割', body: '橙色積木是頭髮，淡色輪廓是目標髮型。你不能用手拖動機械臂；請寫程式，刀具掃過的頭髮都會被切除。' },
  'first-block': { title: '加入第一條命令', body: '開啟左側的「伺服馬達」類別，把「設定關節角度」積木塊拖到工作區。', hint: '類別清單位於程式面板最左側的窄欄。' },
  absolute: { title: '角度是絕對值，不是相對位移', body: '把積木塊設為「底座偏航」和 −55°。意思是「將關節移到 −55°」，不是「再轉 55°」。這種語言的每條命令都使用絕對目標。', hint: '在下拉選單選擇「底座偏航」，再按數字欄並輸入 −55。' },
  test: { title: '「測試」會立即執行', body: '按「測試」後，系統會在數毫秒內評估程式，不會播放即時動畫。嘗試想法的速度不受繪圖效能影響；要觀察動作時再使用「執行」。' },
  head: { title: '頭部會令機械臂停止', body: '把角度改為 0° 後按「測試」。機械臂不會到達該角度，而會停在最後一個安全姿勢，並指出造成問題的積木塊。觀察結果後請改回 −55°。', hint: '留意紅色提示，其中會列出關節及停止位置。' },
  'repeat-noop': { title: '「重複」為何看起來沒有作用', body: '從「控制」拖入「重複」，並把「設定」放入其中。改回 −55° 後按「測試」，分數不會改變：第一輪已把關節移到 −55°，其餘各輪只會重複相同終點。', hint: '把「設定」積木塊放進「重複」的「執行」區域。' },
  'repeat-sweep': { title: '讓「重複」真正形成掃掠', body: '在「重複」內第一個「設定」下方再加入一個「設定」，並使用不同角度，例如 −38°。每輪都會令切刀在頭髮之間來回移動。按「測試」觀察分數變化。', hint: '「執行」區域放兩個積木塊：底座偏航 −55°，再接底座偏航 −38°。' },
  done: { title: '你已掌握完整語言', body: '絕對角度、等待和重複就是全部語言元素。接下來要思考的是切割位置及順序。你可以進入單人練習完成完整挑戰，或與其他玩家對戰。' },
};

export function localizeTutorialStep<T extends TutorialStep>(
  step: T,
  locale: AppLocale,
): T {
  if (locale === 'en') return step;
  if (!locale.startsWith('zh')) return localizeInternationalTutorialStep(step, locale);
  const copy = ZH_TW[step.id];
  if (!copy) return step;
  const localized = { ...step, ...copy };
  if (locale !== 'zh-CN') return localized;
  return {
    ...localized,
    title: toSimplifiedChinese(localized.title),
    body: toSimplifiedChinese(localized.body),
    ...(localized.hint ? { hint: toSimplifiedChinese(localized.hint) } : {}),
  };
}
