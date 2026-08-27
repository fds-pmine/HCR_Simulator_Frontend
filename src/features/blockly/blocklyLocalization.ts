import * as en from 'blockly/msg/en';
import * as zhHans from 'blockly/msg/zh-hans';
import * as zhHant from 'blockly/msg/zh-hant';
import * as ja from 'blockly/msg/ja';
import * as ko from 'blockly/msg/ko';
import * as es from 'blockly/msg/es';
import * as fr from 'blockly/msg/fr';
import * as ru from 'blockly/msg/ru';
import * as de from 'blockly/msg/de';
import type { AppLocale } from '../preferences/localization';
import type { CutterGridDirection } from '../cutter-grid/types';

export interface HcrBlockCopy {
  set: string;
  to: string;
  wait: string;
  repeat: string;
  times: string;
  do: string;
  servoCategory: string;
  controlCategory: string;
  cutterGridCategory: string;
  voxelUnit: string;
  moveDirection: Readonly<Record<CutterGridDirection, string>>;
  setTooltip: string;
  waitTooltip: string;
  repeatTooltip: string;
  moveTooltip: (direction: string) => string;
}

const EN_COPY: HcrBlockCopy = {
  set: 'Set', to: 'to', wait: 'Wait', repeat: 'Repeat', times: 'times', do: 'Do',
  servoCategory: 'Servo', controlCategory: 'Control', cutterGridCategory: 'Cutter Grid',
  voxelUnit: 'voxels',
  moveDirection: { right: 'Move right', left: 'Move left', up: 'Move up', down: 'Move down', forward: 'Move forward', backward: 'Move backward' },
  setTooltip: 'Move a joint to the specified absolute angle',
  waitTooltip: 'Hold the current pose for the specified duration',
  repeatTooltip: 'Run the nested commands repeatedly in order',
  moveTooltip: (direction) => `Move the cutter ${direction} on the fixed world grid`,
};

const COPY: Record<AppLocale, HcrBlockCopy> = {
  en: EN_COPY,
  'zh-CN': {
    set: '设置', to: '为', wait: '等待', repeat: '重复', times: '次', do: '执行',
    servoCategory: '舵机', controlCategory: '控制', cutterGridCategory: '切刀网格', voxelUnit: '个体素',
    moveDirection: { right: '向右移动', left: '向左移动', up: '向上移动', down: '向下移动', forward: '向前移动', backward: '向后移动' },
    setTooltip: '将关节移动到指定的绝对角度', waitTooltip: '在指定时长内保持当前姿势', repeatTooltip: '按顺序重复执行内部命令',
    moveTooltip: (direction) => `在固定世界网格中让切刀${direction}`,
  },
  'zh-TW': {
    set: '設定', to: '為', wait: '等待', repeat: '重複', times: '次', do: '執行',
    servoCategory: '伺服馬達', controlCategory: '控制', cutterGridCategory: '切刀網格', voxelUnit: '個體素',
    moveDirection: { right: '向右移動', left: '向左移動', up: '向上移動', down: '向下移動', forward: '向前移動', backward: '向後移動' },
    setTooltip: '將關節移動到指定的絕對角度', waitTooltip: '在指定時間內保持目前姿勢', repeatTooltip: '依序重複執行內部指令',
    moveTooltip: (direction) => `在固定世界網格中讓切刀${direction}`,
  },
  'zh-HK': {
    set: '設定', to: '為', wait: '等待', repeat: '重複', times: '次', do: '執行',
    servoCategory: '舵機', controlCategory: '控制', cutterGridCategory: '切刀網格', voxelUnit: '個體素',
    moveDirection: { right: '向右移動', left: '向左移動', up: '向上移動', down: '向下移動', forward: '向前移動', backward: '向後移動' },
    setTooltip: '將關節移到指定嘅絕對角度', waitTooltip: '喺指定時間內保持目前姿勢', repeatTooltip: '按順序重複執行內部指令',
    moveTooltip: (direction) => `喺固定世界網格入面令切刀${direction}`,
  },
  ja: {
    set: '設定', to: 'を', wait: '待機', repeat: '繰り返す', times: '回', do: '実行',
    servoCategory: 'サーボ', controlCategory: '制御', cutterGridCategory: 'カッターグリッド', voxelUnit: 'ボクセル',
    moveDirection: { right: '右へ移動', left: '左へ移動', up: '上へ移動', down: '下へ移動', forward: '前へ移動', backward: '後ろへ移動' },
    setTooltip: '関節を指定した絶対角度へ移動します', waitTooltip: '指定時間、現在の姿勢を保ちます', repeatTooltip: '内側の命令を順番に繰り返します',
    moveTooltip: (direction) => `固定ワールドグリッド上でカッターを${direction}`,
  },
  ko: {
    set: '설정', to: '각도', wait: '대기', repeat: '반복', times: '회', do: '실행',
    servoCategory: '서보', controlCategory: '제어', cutterGridCategory: '커터 그리드', voxelUnit: '복셀',
    moveDirection: { right: '오른쪽으로 이동', left: '왼쪽으로 이동', up: '위로 이동', down: '아래로 이동', forward: '앞으로 이동', backward: '뒤로 이동' },
    setTooltip: '관절을 지정한 절대 각도로 이동합니다', waitTooltip: '지정한 시간 동안 현재 자세를 유지합니다', repeatTooltip: '내부 명령을 순서대로 반복 실행합니다',
    moveTooltip: (direction) => `고정 월드 그리드에서 커터를 ${direction}`,
  },
  es: {
    set: 'Fijar', to: 'en', wait: 'Esperar', repeat: 'Repetir', times: 'veces', do: 'Ejecutar',
    servoCategory: 'Servos', controlCategory: 'Control', cutterGridCategory: 'Cuadrícula del cortador', voxelUnit: 'vóxeles',
    moveDirection: { right: 'Mover a la derecha', left: 'Mover a la izquierda', up: 'Mover arriba', down: 'Mover abajo', forward: 'Mover adelante', backward: 'Mover atrás' },
    setTooltip: 'Mueve una articulación al ángulo absoluto indicado', waitTooltip: 'Mantiene la postura actual durante el tiempo indicado', repeatTooltip: 'Repite en orden las instrucciones internas',
    moveTooltip: (direction) => `Mueve el cortador en la cuadrícula fija del mundo: ${direction.toLowerCase()}`,
  },
  fr: {
    set: 'Régler', to: 'sur', wait: 'Attendre', repeat: 'Répéter', times: 'fois', do: 'Exécuter',
    servoCategory: 'Servomoteurs', controlCategory: 'Contrôle', cutterGridCategory: 'Grille de coupe', voxelUnit: 'voxels',
    moveDirection: { right: 'Déplacer à droite', left: 'Déplacer à gauche', up: 'Déplacer vers le haut', down: 'Déplacer vers le bas', forward: 'Déplacer vers l’avant', backward: 'Déplacer vers l’arrière' },
    setTooltip: 'Déplace une articulation vers l’angle absolu indiqué', waitTooltip: 'Maintient la pose actuelle pendant la durée indiquée', repeatTooltip: 'Répète les instructions internes dans l’ordre',
    moveTooltip: (direction) => `Déplace le couteau dans la grille fixe du monde : ${direction.toLowerCase()}`,
  },
  ru: {
    set: 'Установить', to: 'на', wait: 'Ждать', repeat: 'Повторить', times: 'раз', do: 'Выполнить',
    servoCategory: 'Сервоприводы', controlCategory: 'Управление', cutterGridCategory: 'Сетка резака', voxelUnit: 'вокселей',
    moveDirection: { right: 'Переместить вправо', left: 'Переместить влево', up: 'Переместить вверх', down: 'Переместить вниз', forward: 'Переместить вперёд', backward: 'Переместить назад' },
    setTooltip: 'Перемещает сустав в указанный абсолютный угол', waitTooltip: 'Удерживает текущую позу заданное время', repeatTooltip: 'Повторяет вложенные команды по порядку',
    moveTooltip: (direction) => `Перемещение резака в фиксированной мировой сетке: ${direction.toLowerCase()}`,
  },
  de: {
    set: 'Setze', to: 'auf', wait: 'Warte', repeat: 'Wiederhole', times: 'Mal', do: 'Ausführen',
    servoCategory: 'Servos', controlCategory: 'Steuerung', cutterGridCategory: 'Cutter Grid', voxelUnit: 'Voxel',
    moveDirection: { right: 'Nach rechts', left: 'Nach links', up: 'Nach oben', down: 'Nach unten', forward: 'Vorwärts', backward: 'Rückwärts' },
    setTooltip: 'Bewegt ein Gelenk auf den angegebenen absoluten Winkel', waitTooltip: 'Hält die aktuelle Pose für die angegebene Dauer', repeatTooltip: 'Führt die enthaltenen Befehle wiederholt in ihrer Reihenfolge aus',
    moveTooltip: (direction) => `Bewegt den Cutter im festen Weltkoordinatenraster ${direction.toLowerCase()}`,
  },
};

const MESSAGE_PACKS: Record<AppLocale, Record<string, unknown>> = {
  en, 'zh-CN': zhHans, 'zh-TW': zhHant, 'zh-HK': zhHant, ja, ko, es, fr, ru, de,
};

export function hcrBlockCopy(locale: AppLocale): HcrBlockCopy {
  return COPY[locale];
}

export function blocklyMessagePack(locale: AppLocale): Record<string, string> {
  return Object.fromEntries(
    Object.entries(MESSAGE_PACKS[locale]).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
}
