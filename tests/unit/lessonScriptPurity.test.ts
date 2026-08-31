import { describe, expect, it } from 'vitest';
import { CUTTER_GRID_LESSONS } from '../../src/features/tutorial/cutterGridLessons';
import { localizeCutterGridLessons } from '../../src/features/tutorial/cutterGridLessonLocalization';
import { LESSONS } from '../../src/data/challenges/lessons';
import { localizeServoLessons } from '../../src/features/tutorial/servoLessonLocalization';

/**
 * Both Chinese variants are produced by converting the other one character by
 * character, so any character missing from a conversion table is displayed in
 * the wrong script — a simplified sentence with traditional words inside it,
 * which is what a reader notices first. These lists are the characters those
 * tables already know about; the invariant is that none of them survive into
 * the variant they do not belong to.
 */
const TRADITIONAL_ONLY = '論樣斷範兩計輪邊選繞決雙試釋沒統寬據遠對別設響適許驗證們併裡費卻減況畫蹤參規練戰遷剛舉憑記憶夠項敘個會隨轉動變網屬於終點須內連過劃顯還進關閉間應節這條換預測負號確認錯誤經蓋讓離簡數欄較長觸圍無編譯與為後邏輯葉迴開實際掃體積僅尋將標當顛導額鎖疊層達敗並區餘復寫暫態觀調順凍結組壓縮鄰總來閱讀準課獨說話紙檢種從時稱該複徑單圖運勢線髮礙處擇則護繼續產見學習識軸';
const SIMPLIFIED_ONLY = '论样断范两计轮边选绕决双试释没统宽据远对别设响适许验证们费却减况画踪参规练战迁刚举凭记忆够项叙个会随转动变网属终点须内连过显还进关闭间应节这条换预测负号确认错误经盖让离简数栏较长触围无编译与为逻辑叶开实际扫体积仅寻将标当颠导额锁叠层达败区余复写暂态观顺冻结组压缩邻总来阅读准课独说话纸检种从时称该复径单图运势线发碍处择则护继续产见学习识轴';

function copyOf(lessons: readonly { name: string; description: string; goal: string; sections: readonly { title: string; body: string }[] }[]): string {
  return lessons
    .flatMap((lesson) => [
      lesson.name,
      lesson.description,
      lesson.goal,
      ...lesson.sections.flatMap((section) => [section.title, section.body]),
    ])
    .join('\n');
}

function charactersFrom(text: string, forbidden: string): string[] {
  const banned = new Set(forbidden);
  return [...new Set([...text].filter((character) => banned.has(character)))];
}

describe('Chinese lesson copy stays in one script', () => {
  it('keeps traditional characters out of the simplified course', () => {
    const text = [
      copyOf(localizeCutterGridLessons(CUTTER_GRID_LESSONS, 'zh-CN')),
      copyOf(localizeServoLessons(LESSONS, 'zh-CN')),
    ].join('\n');

    expect(charactersFrom(text, TRADITIONAL_ONLY)).toEqual([]);
  });

  it('keeps simplified characters out of the traditional course', () => {
    const text = [
      copyOf(localizeCutterGridLessons(CUTTER_GRID_LESSONS, 'zh-TW')),
      copyOf(localizeServoLessons(LESSONS, 'zh-TW')),
    ].join('\n');

    expect(charactersFrom(text, SIMPLIFIED_ONLY)).toEqual([]);
  });
});
